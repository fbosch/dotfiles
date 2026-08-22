import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	answerResponseOutputBytes,
	createAnswerResponseParser,
	createAnswerRequest,
	serializeAnswerRequest,
	type AnswerClientResult,
	type AnswerRequestInput,
} from "./answer-protocol";
import { ownProcess, type ProcessObserver } from "./owned-process";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.OutputStream.prototype, "write_all_async", "write_all_finish");
Gio._promisify(Gio.OutputStream.prototype, "close_async", "close_finish");

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

type StreamRead = { kind: "complete"; bytes: Uint8Array } | { kind: "too-large" } | { kind: "failed" };
type AnswerStreamRead = { kind: "complete" } | { kind: "failed"; result: AnswerClientResult };
interface AnswerClientOptions {
	executable?: string;
	hardTimeoutMs?: number;
	cancellationGraceMs?: number;
}

export type AnswerPreflightResult =
	| { kind: "ready" }
	| {
		kind: "failed";
		code: "capture_unavailable" | "backend_unavailable" | "backend_policy_invalid" | "incompatible_version" | "cancelled" | "timeout" | "cleanup_failed" | "invalid_response";
		message: string;
	};

type PreflightResponse =
	| { ready: true }
	| { ready: false; code: Exclude<AnswerPreflightResult, { kind: "ready" }>["code"] };

export { type AnswerClientResult, type AnswerRequestInput } from "./answer-protocol";

export async function requestAnswer(
	input: AnswerRequestInput,
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	onDelta?: (text: string) => void,
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

	const owned = ownProcess(process, {
		cancellationGraceMs: options.cancellationGraceMs ?? cancellationGraceMs,
		onProcess,
		parentCancellable: cancellable,
		timeoutMs: options.hardTimeoutMs ?? input.timeoutSeconds * 1000 + requestCleanupBudgetMs,
	});

	try {
		const parser = createAnswerResponseParser(input.requestId, onDelta ?? (() => {}));
		const stdout = readAnswerStream(process.get_stdout_pipe(), parser, owned.terminate);
		const stderr = readBoundedStream(process.get_stderr_pipe(), maximumStderrBytes, owned.terminate);
		let inputFailed = false;
		try {
			await writeRequest(
				process.get_stdin_pipe(),
				cancellable.is_cancelled() ? null : serializedRequest,
			);
		} catch {
			inputFailed = true;
			owned.terminate();
		}
		const [stdoutResult, _stderr, waited] = await Promise.all([
			stdout,
			stderr,
			owned.wait(),
		]);
		if (cancellable.is_cancelled()) return { kind: "cancelled" };
		if (owned.timedOut)
			return { kind: "failed", code: "timeout", message: "The answer request timed out." };
		if (inputFailed)
			return { kind: "failed", code: "process_failed", message: "The answer helper did not accept the request." };
		if (stdoutResult.kind === "failed")
			return stdoutResult.result;
		const response = parser.finish();
		if (response.kind === "answered" && (waited === false || process.get_successful() === false))
			return { kind: "failed", code: "process_failed", message: "The answer helper exited unsuccessfully." };
		return response;
	} catch {
		return cancellable.is_cancelled()
			? { kind: "cancelled" }
			: { kind: "failed", code: "process_failed", message: "The answer helper did not complete." };
	} finally {
		await owned.dispose();
	}
}

export async function preflightAnswer(
	cancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	options: AnswerClientOptions = {},
): Promise<AnswerPreflightResult> {
	let process: Gio.Subprocess;
	try {
		process = Gio.Subprocess.new(
			[options.executable ?? answerRequestScript, "--preflight"],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
		);
	} catch {
		return preflightFailure("backend_unavailable");
	}

	const owned = ownProcess(process, {
		cancellationGraceMs: options.cancellationGraceMs ?? cancellationGraceMs,
		onProcess,
		parentCancellable: cancellable,
		timeoutMs: options.hardTimeoutMs ?? 10_000,
	});

	try {
		const [stdout, _stderr, waited] = await Promise.all([
			readBoundedStream(process.get_stdout_pipe(), 256, owned.terminate),
			readBoundedStream(process.get_stderr_pipe(), maximumStderrBytes, owned.terminate),
			owned.wait(),
		]);
		if (cancellable.is_cancelled()) return preflightFailure("cancelled");
		if (owned.timedOut) return preflightFailure("timeout");
		if (waited === false || stdout.kind !== "complete") return preflightFailure("invalid_response");
		const response = parsePreflightResponse(stdout.bytes);
		if (!response) return preflightFailure("invalid_response");
		if (response.ready) {
			return process.get_successful() ? { kind: "ready" } : preflightFailure("invalid_response");
		}
		return preflightFailure(response.code);
	} catch {
		return cancellable.is_cancelled()
			? preflightFailure("cancelled")
			: preflightFailure("backend_unavailable");
	} finally {
		await owned.dispose();
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

async function readAnswerStream(
	stream: Gio.InputStream | null,
	parser: ReturnType<typeof createAnswerResponseParser>,
	onInvalid: () => void,
): Promise<AnswerStreamRead> {
	if (!stream) return { kind: "failed", result: { kind: "failed", code: "invalid_response", message: "The answer response could not be read." } };
	let invalid = false;
	let invalidResult: AnswerClientResult | null = null;
	try {
		while (true) {
			const bytes = await stream.read_bytes_async(readChunkBytes, GLib.PRIORITY_DEFAULT, null);
			const data = bytes.get_data();
			if (!data || data.length === 0) break;
			const result = invalid === false ? parser.push(data.slice()) : null;
			if (result) {
				invalid = true;
				invalidResult = result;
				onInvalid();
			}
		}
	} catch {
		return { kind: "failed", result: { kind: "failed", code: "invalid_response", message: "The answer response could not be read." } };
	}
	return invalid ? { kind: "failed", result: invalidResult! } : { kind: "complete" };
}

function parsePreflightResponse(bytes: Uint8Array): PreflightResponse | null {
	if (bytes.byteLength === 0) return null;
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const keys = Object.keys(value);
	if (Reflect.get(value, "ready") === true)
		return keys.length === 1 && keys[0] === "ready" ? { ready: true } : null;
	if (Reflect.get(value, "ready") !== false || keys.length !== 2 || keys.includes("code") === false)
		return null;
	const code = Reflect.get(value, "code");
	if (
		code !== "backend_unavailable" &&
		code !== "backend_policy_invalid" &&
		code !== "incompatible_version" &&
		code !== "cancelled" &&
		code !== "timeout" &&
		code !== "cleanup_failed"
	)
		return null;
	return { ready: false, code };
}

function preflightFailure(
	code: Exclude<AnswerPreflightResult, { kind: "ready" }>["code"],
): Exclude<AnswerPreflightResult, { kind: "ready" }> {
	let message = "The configured answer service is unavailable.";
	if (code === "incompatible_version")
		message = "The configured answer service version is incompatible.";
	if (code === "timeout") message = "The answer service readiness check timed out.";
	if (code === "cleanup_failed") message = "The answer service could not finish readiness cleanup.";
	if (code === "cancelled") message = "The answer service readiness check was cancelled.";
	return { kind: "failed", code, message };
}
