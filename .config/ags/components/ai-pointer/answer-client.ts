import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	answerResponseOutputBytes,
	createAnswerRequest,
	parseAnswerResponse,
	serializeAnswerRequest,
	type AnswerClientResult,
	type AnswerRequestInput,
} from "./answer-protocol";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async", "write_all_finish");
Gio._promisify(Gio.OutputStream.prototype, "close_async", "close_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

const answerRequestScript = GLib.build_filenamev([
	GLib.get_home_dir(),
	".config",
	"opencode",
	"scripts",
	"answer-request.sh",
]);
const maximumStdoutBytes = answerResponseOutputBytes;
const maximumStderrBytes = 4 * 1024;
const readChunkBytes = 4096;
const cancellationGraceMs = 7_000;
const requestCleanupBudgetMs = 8_000;

type ProcessObserver = (process: Gio.Subprocess | null) => void;
type StreamRead = { kind: "complete"; bytes: Uint8Array } | { kind: "too-large" } | { kind: "failed" };
interface AnswerClientOptions {
	executable?: string;
	hardTimeoutMs?: number;
	cancellationGraceMs?: number;
}

export { type AnswerClientResult, type AnswerRequestInput } from "./answer-protocol";

export async function requestAnswer(
	input: AnswerRequestInput,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	options: AnswerClientOptions = {},
): Promise<AnswerClientResult> {
	const request = createAnswerRequest(input);
	if (!request)
		return { kind: "failed", code: "invalid_request", message: "The answer request is invalid." };

	const serializedRequest = serializeAnswerRequest(request);
	if (new TextEncoder().encode(serializedRequest).byteLength > 64 * 1024)
		return { kind: "failed", code: "invalid_request", message: "The answer request exceeds its limit." };

	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			[options.executable ?? answerRequestScript],
			Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
		);
	} catch {
		return { kind: "failed", code: "spawn_failed", message: "The answer helper is unavailable." };
	}

	onProcess(process);
	let forceExitId = 0;
	let timedOut = false;
	const terminate = () => {
		requestCancellation(process);
		if (forceExitId === 0)
			forceExitId = scheduleForceExit(
				process,
				options.cancellationGraceMs ?? cancellationGraceMs,
				() => { forceExitId = 0; },
			);
	};
	let timeoutId = GLib.timeout_add(
		GLib.PRIORITY_DEFAULT,
		options.hardTimeoutMs ?? input.timeoutSeconds * 1000 + requestCleanupBudgetMs,
		() => {
		timeoutId = 0;
		timedOut = true;
		terminate();
		return GLib.SOURCE_REMOVE;
	});
	const cancellationId = cancellable.connect(terminate);

	try {
		if (cancellable.is_cancelled()) {
			terminate();
		}
		const stdout = readBoundedStream(process.get_stdout_pipe(), maximumStdoutBytes, terminate);
		const stderr = readBoundedStream(process.get_stderr_pipe(), maximumStderrBytes, terminate);
		let inputFailed = false;
		try {
			await writeRequest(
				process.get_stdin_pipe(),
				cancellable.is_cancelled() ? null : serializedRequest,
			);
		} catch {
			inputFailed = true;
			terminate();
		}
		const [stdoutResult, _stderr, waited] = await Promise.all([
			stdout,
			stderr,
			process.wait_async(null).then(() => true).catch(() => false),
		]);
		if (cancellable.is_cancelled()) return { kind: "cancelled" };
		if (timedOut)
			return { kind: "failed", code: "timeout", message: "The answer request timed out." };
		if (inputFailed)
			return { kind: "failed", code: "process_failed", message: "The answer helper did not accept the request." };
		if (stdoutResult.kind === "too-large")
			return { kind: "failed", code: "output_too_large", message: "The answer response exceeded its limit." };
		if (stdoutResult.kind === "failed")
			return { kind: "failed", code: "invalid_response", message: "The answer response could not be read." };
		const response = parseAnswerResponse(stdoutResult.bytes, input.requestId);
		if (response.kind === "answered" && (waited === false || process.get_successful() === false))
			return { kind: "failed", code: "process_failed", message: "The answer helper exited unsuccessfully." };
		return response;
	} catch {
		return cancellable.is_cancelled()
			? { kind: "cancelled" }
			: { kind: "failed", code: "process_failed", message: "The answer helper did not complete." };
	} finally {
		if (timeoutId !== 0) GLib.source_remove(timeoutId);
		if (forceExitId !== 0) GLib.source_remove(forceExitId);
		try {
			cancellable.disconnect(cancellationId);
		} catch {
			// Cancellation may disconnect handlers while the request unwinds.
		}
		onProcess(null);
	}
}

async function writeRequest(stream: Gio.OutputStream | null, request: string | null): Promise<void> {
	if (!stream) throw new Error("The answer helper has no standard input.");
	try {
		if (request !== null) {
			const bytes = new TextEncoder().encode(request);
			await stream.write_all_async(bytes, GLib.PRIORITY_DEFAULT, null);
		}
	} finally {
		await stream.close_async(GLib.PRIORITY_DEFAULT, null);
	}
}

async function readBoundedStream(
	stream: Gio.InputStream | null,
	maximumBytes: number,
	onLimit: () => void,
): Promise<StreamRead> {
	if (!stream) return { kind: "failed" };
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	let exceeded = false;
	try {
		while (true) {
			const bytes = await stream.read_bytes_async(readChunkBytes, GLib.PRIORITY_DEFAULT, null);
			const data = bytes.get_data();
			if (!data || data.length === 0) break;
			byteCount += data.length;
			if (byteCount > maximumBytes || exceeded) {
				if (exceeded === false) onLimit();
				exceeded = true;
				continue;
			}
			chunks.push(data.slice());
		}
	} catch {
		return { kind: "failed" };
	}
	if (exceeded) return { kind: "too-large" };
	const output = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return { kind: "complete", bytes: output };
}

function requestCancellation(process: Gio.Subprocess): void {
	try {
		process.send_signal(2);
	} catch {
		process.force_exit();
	}
}

function scheduleForceExit(process: Gio.Subprocess, delayMs: number, onForceExit: () => void): number {
	return GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
		onForceExit();
		process.force_exit();
		return GLib.SOURCE_REMOVE;
	});
}
