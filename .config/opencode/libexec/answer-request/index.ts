import { TextDecoder } from "node:util";
import { z } from "zod";
import { validateAttachments } from "./attachment.js";
import type { AnswerBackend } from "./backend.js";
import { normalizeAssistantResponse } from "./response.js";
import {
  answerErrorCodeSchema,
  answerRequestLimits,
  answerRequestSchema,
  answerResultSchema,
  createAnswerFailure,
  type AnswerFailure,
  type AnswerRequest,
  type AnswerResult,
  isUnicodeScalarString,
} from "./protocol.js";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const backendAnswerResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), parts: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), code: answerErrorCodeSchema }).strict(),
]);

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
  backend: AnswerBackend,
  signal?: AbortSignal,
): Promise<AnswerResult> {
  const parsed = parseAnswerRequest(input);
  if (parsed.ok === false) return parsed.result;

  let loadedAttachments: ReturnType<typeof validateAttachments> | undefined;
  const loadAttachments = () => {
    loadedAttachments ??= validateAttachments(parsed.request.attachments);
    return loadedAttachments;
  };

  try {
    const result = backendAnswerResultSchema.safeParse(
      await backend.execute({
        prompt: parsed.request.prompt,
        timeoutSeconds: parsed.request.timeoutSeconds,
        signal,
        loadAttachments,
      }),
    );
    if (result.success === false) {
      return createAnswerFailure("internal_error", parsed.request.requestId);
    }
    if (result.data.ok === false) {
      return createAnswerFailure(result.data.code, parsed.request.requestId);
    }

    const normalized = normalizeAssistantResponse(result.data.parts);
    if (normalized.ok === false) {
      return createAnswerFailure(normalized.code, parsed.request.requestId);
    }
    return {
      protocolVersion: 1,
      requestId: parsed.request.requestId,
      ok: true,
      answer: normalized.answer,
      truncated: normalized.truncated,
    };
  } catch {
    return createAnswerFailure("internal_error", parsed.request.requestId);
  }
}

export function serializeAnswerResult(result: AnswerResult): string {
  const parsed = answerResultSchema.parse(result);
  const safeResult = parsed.ok
    ? parsed
    : createAnswerFailure(parsed.error.code, parsed.requestId);
  return `${JSON.stringify(safeResult)}\n`;
}

export * from "./protocol.js";
export * from "./attachment.js";
export * from "./response.js";
export * from "./backend.js";
export * from "./opencode-backend.js";

function extractRequestId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || !("requestId" in raw)) return null;
  const requestId = Reflect.get(raw, "requestId");
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  if (isUnicodeScalarString(requestId) === false) return null;
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
