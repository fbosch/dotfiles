import { TextEncoder } from "node:util";
import { z } from "zod";

const utf8Encoder = new TextEncoder();

export const answerRequestLimitsSchema = z
  .object({
    requestBytes: z.number().int().positive(),
    requestIdBytes: z.number().int().positive(),
    promptBytes: z.number().int().positive(),
    attachmentCount: z.number().int().positive(),
    attachmentPathBytes: z.number().int().positive(),
    attachmentBytes: z.number().int().positive(),
    aggregateAttachmentBytes: z.number().int().positive(),
    imageDimensionPixels: z.number().int().positive(),
    imagePixels: z.number().int().positive(),
    minimumTimeoutSeconds: z.number().int().positive(),
    maximumTimeoutSeconds: z.number().int().positive(),
    responseBytes: z.number().int().positive(),
    responseParts: z.number().int().positive(),
    responseProcessingCodeUnits: z.number().int().positive(),
    diagnosticBytes: z.number().int().positive(),
    inputTimeoutMilliseconds: z.number().int().positive(),
  })
  .strict();

export const answerRequestLimits = Object.freeze(
  answerRequestLimitsSchema.parse({
    requestBytes: 64 * 1024,
    requestIdBytes: 128,
    promptBytes: 16 * 1024,
    attachmentCount: 4,
    attachmentPathBytes: 4096,
    attachmentBytes: 12 * 1024 * 1024,
    aggregateAttachmentBytes: 20 * 1024 * 1024,
    imageDimensionPixels: 8192,
    imagePixels: 16_000_000,
    minimumTimeoutSeconds: 5,
    maximumTimeoutSeconds: 120,
    responseBytes: 32 * 1024,
    responseParts: 256,
    responseProcessingCodeUnits: 64 * 1024,
    diagnosticBytes: 1024,
    inputTimeoutMilliseconds: 5000,
  }),
);

const boundedUtf8String = (maximumBytes: number) =>
  z
    .string()
    .refine(isUnicodeScalarString)
    .refine((value) => utf8Encoder.encode(value).byteLength <= maximumBytes);

const requestIdSchema = boundedUtf8String(answerRequestLimits.requestIdBytes).refine(
  (value) => value.length > 0,
);

export const attachmentDescriptorSchema = z
  .object({
    path: boundedUtf8String(answerRequestLimits.attachmentPathBytes).refine(
      (value) => value.length > 0,
    ),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const answerRequestSchema = z
  .object({
    protocolVersion: z.literal(2),
    requestId: requestIdSchema,
    operation: z.literal("answer"),
    prompt: boundedUtf8String(answerRequestLimits.promptBytes).refine(
      (value) => value.trim().length > 0,
    ),
    attachments: z.array(attachmentDescriptorSchema).max(answerRequestLimits.attachmentCount),
    timeoutSeconds: z
      .number()
      .int()
      .min(answerRequestLimits.minimumTimeoutSeconds)
      .max(answerRequestLimits.maximumTimeoutSeconds),
  })
  .strict();

export const answerToolPolicySchema = z
  .object({
    mode: z.literal("deny_all"),
    tools: z.record(z.string().min(1), z.literal(false)),
  })
  .strict();

export const answerErrorCodeSchema = z.enum([
  "invalid_request",
  "unsupported_version",
  "attachment_invalid",
  "attachment_too_large",
  "attachment_changed",
  "backend_unavailable",
  "backend_policy_invalid",
  "incompatible_version",
  "provider_failed",
  "empty_response",
  "timeout",
  "cancelled",
  "cleanup_failed",
  "internal_error",
]);

export const answerSuccessSchema = z
  .object({
    protocolVersion: z.literal(2),
    requestId: requestIdSchema,
    ok: z.literal(true),
    answer: boundedUtf8String(answerRequestLimits.responseBytes).refine(
      (value) => value.trim().length > 0,
    ),
    truncated: z.boolean(),
  })
  .strict();

export const answerFailureSchema = z
  .object({
    protocolVersion: z.literal(2),
    requestId: requestIdSchema.nullable(),
    ok: z.literal(false),
    error: z
      .object({
        code: answerErrorCodeSchema,
        message: boundedUtf8String(answerRequestLimits.diagnosticBytes).refine(
          (value) => value.length > 0,
        ),
      })
      .strict(),
  })
  .strict();

export const answerResultSchema = z.discriminatedUnion("ok", [
  answerSuccessSchema,
  answerFailureSchema,
]);

const streamTextSchema = boundedUtf8String(64 * 1024).refine((value) => value.length > 0);

export const answerStreamStartSchema = z.object({ protocolVersion: z.literal(2), requestId: requestIdSchema, sequence: z.literal(0), event: z.literal("start") }).strict();
export const answerStreamDeltaSchema = z.object({ protocolVersion: z.literal(2), requestId: requestIdSchema, sequence: z.number().int().positive(), event: z.literal("delta"), text: streamTextSchema }).strict();
export const answerStreamFinalSchema = z.object({ protocolVersion: z.literal(2), requestId: requestIdSchema, sequence: z.number().int().positive(), event: z.literal("final"), answer: boundedUtf8String(answerRequestLimits.responseBytes).refine((value) => value.trim().length > 0), truncated: z.boolean() }).strict();
export const answerStreamErrorSchema = z.object({ protocolVersion: z.literal(2), requestId: requestIdSchema.nullable(), sequence: z.number().int().nonnegative(), event: z.literal("error"), error: z.object({ code: answerErrorCodeSchema, message: boundedUtf8String(answerRequestLimits.diagnosticBytes).refine((value) => value.length > 0) }).strict() }).strict();
export const answerStreamEventSchema = z.discriminatedUnion("event", [answerStreamStartSchema, answerStreamDeltaSchema, answerStreamFinalSchema, answerStreamErrorSchema]);

export type AnswerRequest = z.infer<typeof answerRequestSchema>;
export type AttachmentDescriptor = z.infer<typeof attachmentDescriptorSchema>;
export type AnswerToolPolicy = z.infer<typeof answerToolPolicySchema>;
export type AnswerErrorCode = z.infer<typeof answerErrorCodeSchema>;
export type AnswerResult = z.infer<typeof answerResultSchema>;
export type AnswerSuccess = z.infer<typeof answerSuccessSchema>;
export type AnswerFailure = z.infer<typeof answerFailureSchema>;
export type AnswerStreamEvent = z.infer<typeof answerStreamEventSchema>;

const errorMessages = {
  invalid_request: "The request is invalid.",
  unsupported_version: "The protocol version is unsupported.",
  attachment_invalid: "An attachment is invalid.",
  attachment_too_large: "An attachment exceeds the allowed limits.",
  attachment_changed: "An attachment changed after it was selected.",
  backend_unavailable: "The answer backend is unavailable.",
  backend_policy_invalid: "The answer backend policy could not be verified.",
  incompatible_version: "The answer backend version is incompatible.",
  provider_failed: "The answer provider failed.",
  empty_response: "The answer provider returned no final text.",
  timeout: "The answer request timed out.",
  cancelled: "The answer request was cancelled.",
  cleanup_failed: "The answer request cleanup failed.",
  internal_error: "The answer request failed unexpectedly.",
} satisfies Record<AnswerErrorCode, string>;

export function createAnswerFailure(
  code: AnswerErrorCode,
  requestId: string | null = null,
): AnswerFailure {
  return {
    protocolVersion: 2,
    requestId,
    ok: false,
    error: { code, message: errorMessages[code] },
  };
}

export function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) continue;
    if (codeUnit > 0xdbff || index + 1 >= value.length) return false;

    const nextCodeUnit = value.charCodeAt(index + 1);
    if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) return false;
    index += 1;
  }
  return true;
}
