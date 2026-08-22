import { TextDecoder } from "node:util";
import { writeSync } from "node:fs";
import {
  answerRequestLimits,
  answerStreamEventSchema,
  createAnswerFailure,
  executeAnswerRequest,
  parseAnswerRequest,
  type AnswerBackend,
  type AnswerResult,
  type AnswerStreamEvent,
} from "./index.js";
import type { AnswerPreflightResult } from "./opencode-backend.js";

type InputChunk = string | Uint8Array;

export interface AnswerRequestCliOptions {
  input: AsyncIterable<InputChunk>;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  backend: AnswerBackend;
  signal?: AbortSignal;
  inputTimeoutMilliseconds?: number;
}

export interface AnswerPreflightCliOptions {
  preflight: (signal?: AbortSignal) => Promise<AnswerPreflightResult>;
  stdout: { write(value: string): unknown };
  signal?: AbortSignal;
}

export async function runAnswerRequestCli(options: AnswerRequestCliOptions): Promise<number> {
  const input = await readBoundedInput(
    options.input,
    options.inputTimeoutMilliseconds ?? answerRequestLimits.inputTimeoutMilliseconds,
  );
  const parsed = input === null
    ? { ok: false as const, result: createAnswerFailure("invalid_request") }
    : parseAnswerRequest(input);
  if (parsed.ok === false) {
    emit(options.stdout, { protocolVersion: 2, requestId: parsed.result.requestId, sequence: 0, event: "error", error: parsed.result.error });
    options.stderr.write(boundedDiagnostic(parsed.result));
    return 1;
  }

  let sequence = 0;
  let bytes = emit(options.stdout, { protocolVersion: 2, requestId: parsed.request.requestId, sequence: 0, event: "start" });
  let sourceDeltaBytes = 0;
  let acceptingDeltas = true;
  const onDelta = (text: string) => {
    if (acceptingDeltas === false) return;
    sourceDeltaBytes += Buffer.byteLength(text);
    if (sourceDeltaBytes > answerRequestLimits.responseBytes) return;
    const event = { protocolVersion: 2 as const, requestId: parsed.request.requestId, sequence: sequence + 1, event: "delta" as const, text };
    const encoded = serialize(event);
    const encodedBytes = Buffer.byteLength(encoded);
    if (encodedBytes > 64 * 1024 || bytes + encodedBytes + 64 * 1024 > 256 * 1024) return;
    options.stdout.write(encoded);
    bytes += encodedBytes;
    sequence += 1;
  };
  const result = await executeAnswerRequest(input as Uint8Array, options.backend, options.signal, onDelta);
  acceptingDeltas = false;
  const event: AnswerStreamEvent = result.ok
    ? { protocolVersion: 2, requestId: result.requestId, sequence: sequence + 1, event: "final", answer: result.answer, truncated: result.truncated }
    : { protocolVersion: 2, requestId: result.requestId, sequence: sequence + 1, event: "error", error: result.error };
  emit(options.stdout, fitTerminal(event));
  if (result.ok === false) options.stderr.write(boundedDiagnostic(result));
  return result.ok ? 0 : 1;
}

export async function runAnswerPreflightCli(options: AnswerPreflightCliOptions): Promise<number> {
  let result: AnswerPreflightResult;
  try {
    result = await options.preflight(options.signal);
  } catch {
    result = { ready: false, code: "backend_unavailable" };
  }
  options.stdout.write(`${JSON.stringify(result)}\n`);
  return result.ready ? 0 : 1;
}

export async function runAnswerRequestProcess(backend: AnswerBackend): Promise<never> {
  // Reserve process output for the machine protocol, including while SDK code runs.
  Object.defineProperty(process.stdout, "write", { value: () => true });
  Object.defineProperty(process.stderr, "write", { value: () => true });

  let exitCode: number;
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    exitCode = await runAnswerRequestCli({
      input: process.stdin,
      stdout: { write: (value) => writeSync(1, value) },
      stderr: { write: (value) => writeSync(2, value) },
      backend,
      signal: controller.signal,
    });
  } catch {
    const result = createAnswerFailure("internal_error");
    writeSync(1, serialize({ protocolVersion: 2, requestId: null, sequence: 0, event: "error", error: result.error }));
    writeSync(2, boundedDiagnostic(result));
    exitCode = 1;
  }

  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);

  process.exit(exitCode);
}

function emit(stdout: { write(value: string): unknown }, event: AnswerStreamEvent): number {
  const value = serialize(event);
  stdout.write(value);
  return Buffer.byteLength(value);
}

function serialize(event: AnswerStreamEvent): string {
  return `${JSON.stringify(answerStreamEventSchema.parse(event))}\n`;
}

function fitTerminal(event: AnswerStreamEvent): AnswerStreamEvent {
  if (event.event !== "final") return event;
  if (Buffer.byteLength(serialize(event)) <= 64 * 1024) return event;
  const codePoints = Array.from(event.answer);
  let lower = 1;
  let upper = codePoints.length;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    const candidate = codePoints.slice(0, middle).join("");
    if (Buffer.byteLength(serialize({ ...event, answer: candidate, truncated: true })) <= 64 * 1024) lower = middle;
    else upper = middle - 1;
  }
  const answer = codePoints.slice(0, lower).join("");
  return { ...event, answer, truncated: event.truncated || answer !== event.answer };
}

export async function runAnswerPreflightProcess(preflight: (signal?: AbortSignal) => Promise<AnswerPreflightResult>): Promise<never> {
  Object.defineProperty(process.stdout, "write", { value: () => true });
  Object.defineProperty(process.stderr, "write", { value: () => true });

  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const exitCode = await runAnswerPreflightCli({
    preflight,
    stdout: { write: (value) => writeSync(1, value) },
    signal: controller.signal,
  });
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
  process.exit(exitCode);
}

async function readBoundedInput(
  input: AsyncIterable<InputChunk>,
  timeoutMilliseconds: number,
): Promise<Uint8Array | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMilliseconds);
  });

  try {
    return await Promise.race([collectBoundedInput(input), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function collectBoundedInput(input: AsyncIterable<InputChunk>): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for await (const chunk of input) {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += bytes.byteLength;
      if (totalBytes > answerRequestLimits.requestBytes) return null;
      chunks.push(bytes);
    }
  } catch {
    return null;
  }

  return Buffer.concat(chunks, totalBytes);
}

function boundedDiagnostic(result: Extract<AnswerResult, { ok: false }>): string {
  const diagnostic = `answer-request: ${result.error.code}\n`;
  const bytes = Buffer.from(diagnostic);
  if (bytes.byteLength <= answerRequestLimits.diagnosticBytes) return diagnostic;
  return `${new TextDecoder().decode(bytes.subarray(0, answerRequestLimits.diagnosticBytes - 1))}\n`;
}
