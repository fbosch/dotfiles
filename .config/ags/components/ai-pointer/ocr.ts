import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

export const maximumOcrPixels = 6_000_000;
export const maximumOcrOutputBytes = 65_536;
const ocrTimeoutMs = 10_000;

export interface OcrInput {
	path: string;
	pixelHeight: number;
	pixelWidth: number;
}

export type OcrUnavailableReason =
	| "executable-missing"
	| "image-too-large"
	| "invalid-output"
	| "invalid-source"
	| "process-failed"
	| "read-failed"
	| "spawn-failed"
	| "timeout";

export type OcrResult =
	| { kind: "cancelled" }
	| { kind: "no-text" }
	| { kind: "text"; text: string }
	| { kind: "truncated"; text: string }
	| { kind: "unavailable"; reason: OcrUnavailableReason };

type ProcessObserver = (process: Gio.Subprocess | null) => void;

interface OcrOptions {
	executable?: string;
	timeoutMs?: number;
}

export async function recognizeCapture(
	input: OcrInput,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	options: OcrOptions = {},
): Promise<OcrResult> {
	if (
		input.path.length === 0 ||
		Number.isSafeInteger(input.pixelWidth) === false ||
		Number.isSafeInteger(input.pixelHeight) === false ||
		input.pixelWidth <= 0 ||
		input.pixelHeight <= 0
	)
		return { kind: "unavailable", reason: "invalid-source" };
	if (input.pixelWidth * input.pixelHeight > maximumOcrPixels)
		return { kind: "unavailable", reason: "image-too-large" };
	const executable = options.executable ?? GLib.find_program_in_path("tesseract");
	if (!executable) return { kind: "unavailable", reason: "executable-missing" };

	let process: Gio.Subprocess;
	try {
		const launcher = new Gio.SubprocessLauncher({
			flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		});
		launcher.setenv("OMP_THREAD_LIMIT", "1", true);
		process = launcher.spawnv([
			executable,
			input.path,
			"stdout",
			"--psm",
			"3",
			"--oem",
			"1",
			"--dpi",
			"300",
			"-l",
			"eng",
		]);
	} catch {
		return { kind: "unavailable", reason: "spawn-failed" };
	}

	onProcess(process);
	let timedOut = false;
	let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.timeoutMs ?? ocrTimeoutMs, () => {
		timeoutId = 0;
		timedOut = true;
		cancellable.cancel();
		process.force_exit();
		return GLib.SOURCE_REMOVE;
	});
	try {
		const output = await readBoundedOcrOutput(process, cancellable);
		if (timedOut) return { kind: "unavailable", reason: "timeout" };
		if (cancellable.is_cancelled()) {
			process.force_exit();
			try {
				await process.wait_async(null);
			} catch {
				// Cancellation owns process termination; a concurrent exit is already settled.
			}
			return { kind: "cancelled" };
		}
		if (output.kind === "read-failed") {
			process.force_exit();
			try {
				await process.wait_async(null);
			} catch {
				// The process may already have exited after the stream failure.
			}
			return { kind: "unavailable", reason: "read-failed" };
		}
		if (output.kind === "invalid-output")
			return { kind: "unavailable", reason: "invalid-output" };
		if (output.kind === "truncated") return output;
		if (process.get_successful() === false)
			return { kind: "unavailable", reason: "process-failed" };
		if (output.text.length === 0) return { kind: "no-text" };
		return { kind: "text", text: output.text };
	} catch {
		if (timedOut) return { kind: "unavailable", reason: "timeout" };
		return cancellable.is_cancelled()
			? { kind: "cancelled" }
			: { kind: "unavailable", reason: "read-failed" };
	} finally {
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		onProcess(null);
	}
}

type OcrOutput =
	| { kind: "complete"; text: string }
	| { kind: "invalid-output" }
	| { kind: "read-failed" }
	| { kind: "truncated"; text: string };

export async function readBoundedOcrOutput(
	process: Gio.Subprocess,
	cancellable: Gio.Cancellable,
): Promise<OcrOutput> {
	const stream = process.get_stdout_pipe();
	if (!stream) return { kind: "read-failed" };
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	while (true) {
		let bytes: GLib.Bytes;
		try {
			bytes = await stream.read_bytes_async(4_096, GLib.PRIORITY_DEFAULT, cancellable);
		} catch {
			return { kind: "read-failed" };
		}
		const data = bytes.get_data();
		if (!data || data.length === 0) break;
		const remaining = maximumOcrOutputBytes - byteCount;
		if (data.length > remaining) {
			if (remaining > 0) chunks.push(data.slice(0, remaining));
			process.force_exit();
			try {
				await process.wait_async(null);
			} catch {
				// The process may exit between overflow detection and termination.
			}
			return { kind: "truncated", text: decodeTruncated(joinChunks(chunks)) };
		}
		chunks.push(data.slice());
		byteCount += data.length;
	}
	try {
		await process.wait_async(cancellable);
		return { kind: "complete", text: normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(joinChunks(chunks))) };
	} catch {
		return { kind: "read-failed" };
	}
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function decodeTruncated(bytes: Uint8Array): string {
	for (let length = bytes.length; length >= Math.max(0, bytes.length - 3); length -= 1) {
		try {
			return normalizeText(new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, length)));
		} catch {
			// A truncation boundary may split one UTF-8 code point.
		}
	}
	return "";
}

function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
		.trim();
}
