import { TextDecoder, TextEncoder } from "node:util";
import { z } from "zod";
import { answerRequestLimits, isUnicodeScalarString } from "./protocol.js";

export type NormalizedAnswer =
  | { ok: true; answer: string; truncated: boolean }
  | { ok: false; code: "empty_response" | "provider_failed" };

const textPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
});

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function normalizeAssistantResponse(parts: unknown): NormalizedAnswer {
  if (Array.isArray(parts) === false) return { ok: false, code: "provider_failed" };
  if (parts.length > answerRequestLimits.responseParts) {
    return { ok: false, code: "provider_failed" };
  }

  let text = "";
  let processedCodeUnits = 0;
  let processingTruncated = false;
  for (const part of parts) {
    if (typeof part !== "object" || part === null || Reflect.get(part, "type") !== "text") {
      continue;
    }

    const parsed = textPartSchema.safeParse(part);
    if (parsed.success === false) return { ok: false, code: "provider_failed" };
    if (parsed.data.synthetic === true || parsed.data.ignored === true) continue;
    if (text.length > 0) text += "\n";

    const remainingCodeUnits =
      answerRequestLimits.responseProcessingCodeUnits - processedCodeUnits;
    if (remainingCodeUnits <= 0) {
      processingTruncated = true;
      break;
    }
    let retainedCodeUnits = Math.min(parsed.data.text.length, remainingCodeUnits);
    if (
      retainedCodeUnits < parsed.data.text.length &&
      retainedCodeUnits > 0 &&
      isHighSurrogate(parsed.data.text.charCodeAt(retainedCodeUnits - 1)) &&
      isLowSurrogate(parsed.data.text.charCodeAt(retainedCodeUnits))
    ) {
      retainedCodeUnits -= 1;
    }
    const retained = parsed.data.text.slice(0, retainedCodeUnits);
    text += retained;
    processedCodeUnits += retained.length;
    if (retained.length < parsed.data.text.length) {
      processingTruncated = true;
      break;
    }
  }

  const answer = text.trim();
  if (answer.length === 0) return { ok: false, code: "empty_response" };
  if (isUnicodeScalarString(answer) === false) return { ok: false, code: "provider_failed" };

  const bytes = encoder.encode(answer);
  if (bytes.byteLength <= answerRequestLimits.responseBytes) {
    return { ok: true, answer, truncated: processingTruncated };
  }

  return {
    ok: true,
    answer: truncateUtf8(bytes, answerRequestLimits.responseBytes),
    truncated: true,
  };
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function truncateUtf8(bytes: Uint8Array, maximumBytes: number): string {
  let end = maximumBytes;
  while (end > 0) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      end -= 1;
    }
  }
  return "";
}
