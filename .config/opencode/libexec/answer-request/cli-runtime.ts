import { TextDecoder } from "node:util";
import { writeSync } from "node:fs";
import {
  answerRequestLimits,
  createAnswerFailure,
  executeAnswerRequest,
  serializeAnswerResult,
  type AnswerBackend,
  type AnswerResult,
} from "./index.js";

type InputChunk = string | Uint8Array;

export interface AnswerRequestCliOptions {
  input: AsyncIterable<InputChunk>;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  backend: AnswerBackend;
  signal?: AbortSignal;
  inputTimeoutMilliseconds?: number;
}

export async function runAnswerRequestCli(options: AnswerRequestCliOptions): Promise<number> {
  const input = await readBoundedInput(
    options.input,
    options.inputTimeoutMilliseconds ?? answerRequestLimits.inputTimeoutMilliseconds,
  );
  const result =
    input === null
      ? createAnswerFailure("invalid_request")
      : await executeAnswerRequest(input, options.backend, options.signal);

  options.stdout.write(serializeAnswerResult(result));
  if (result.ok === false) options.stderr.write(boundedDiagnostic(result));
  return result.ok ? 0 : 1;
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
    writeSync(1, serializeAnswerResult(result));
    writeSync(2, boundedDiagnostic(result));
    exitCode = 1;
  }

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
