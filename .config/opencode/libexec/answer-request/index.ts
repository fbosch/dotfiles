import { TextDecoder } from "node:util";
import {
  answerRequestLimits,
  answerRequestSchema,
  answerResultSchema,
  createAnswerFailure,
  type AnswerFailure,
  type AnswerRequest,
  type AnswerResult,
} from "./protocol.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type AnswerRequestExecutor = (request: AnswerRequest) => Promise<unknown>;

export type ParsedAnswerRequest =
  | { ok: true; request: AnswerRequest }
  | { ok: false; result: AnswerFailure };

export function parseAnswerRequest(input: Uint8Array): ParsedAnswerRequest {
  if (input.byteLength > answerRequestLimits.requestBytes) {
    return { ok: false, result: createAnswerFailure("invalid_request") };
  }

  let rawText: string;
  try {
    rawText = utf8Decoder.decode(input);
  } catch {
    return { ok: false, result: createAnswerFailure("invalid_request") };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, result: createAnswerFailure("invalid_request") };
  }

  const requestId = extractRequestId(raw);
  if (hasUnsupportedVersion(raw)) {
    return {
      ok: false,
      result: createAnswerFailure("unsupported_version", requestId),
    };
  }

  const parsed = answerRequestSchema.safeParse(raw);
  if (parsed.success === false) {
    return {
      ok: false,
      result: createAnswerFailure("invalid_request", requestId),
    };
  }

  return { ok: true, request: parsed.data };
}

export async function executeAnswerRequest(
  input: Uint8Array,
  execute: AnswerRequestExecutor,
): Promise<AnswerResult> {
  const parsed = parseAnswerRequest(input);
  if (parsed.ok === false) return parsed.result;

  try {
    const result = answerResultSchema.safeParse(await execute(parsed.request));
    if (result.success === false || result.data.requestId !== parsed.request.requestId) {
      return createAnswerFailure("internal_error", parsed.request.requestId);
    }
    return result.data;
  } catch {
    return createAnswerFailure("internal_error", parsed.request.requestId);
  }
}

export function serializeAnswerResult(result: AnswerResult): string {
  return `${JSON.stringify(answerResultSchema.parse(result))}\n`;
}

export * from "./protocol.js";

function extractRequestId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || !("requestId" in raw)) return null;
  const requestId = Reflect.get(raw, "requestId");
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (new TextEncoder().encode(requestId).byteLength > answerRequestLimits.requestIdBytes) {
    return null;
  }
  return requestId;
}

function hasUnsupportedVersion(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || !("protocolVersion" in raw)) return false;
  const protocolVersion = Reflect.get(raw, "protocolVersion");
  return typeof protocolVersion === "number" && protocolVersion !== 1;
}
