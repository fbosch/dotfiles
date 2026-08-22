const answerRequestProtocolVersion = 1;
const answerRequestPromptBytes = 16 * 1024;
const answerRequestIdBytes = 128;
const answerRequestPathBytes = 4096;
const answerRequestTimeoutMinimumSeconds = 5;
const answerRequestTimeoutMaximumSeconds = 120;
const answerResponseAnswerBytes = 32 * 1024;
const answerResponseErrorBytes = 1024;
export const answerResponseOutputBytes = 256 * 1024;

const encoder = new TextEncoder();
const errorCodes = [
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
] as const;

export type AnswerErrorCode = typeof errorCodes[number];

export interface AnswerRequestInput {
	requestId: string;
	prompt: string;
	attachment: { path: string; sha256: string };
	timeoutSeconds: number;
}

export interface AnswerRequest {
	protocolVersion: 1;
	requestId: string;
	operation: "answer";
	prompt: string;
	attachments: [{ path: string; mimeType: "image/png"; sha256: string }];
	timeoutSeconds: number;
}

export type AnswerClientResult =
	| { kind: "answered"; answer: string; truncated: boolean }
	| { kind: "cancelled" }
	| { kind: "failed"; code: AnswerErrorCode | "invalid_response" | "output_too_large" | "spawn_failed" | "process_failed"; message: string };

export function createAnswerRequest(input: AnswerRequestInput): AnswerRequest | null {
	if (
		isBoundedNonEmptyString(input.requestId, answerRequestIdBytes) === false ||
		isBoundedNonEmptyString(input.prompt, answerRequestPromptBytes) === false ||
		input.prompt.trim().length === 0 ||
		isBoundedNonEmptyString(input.attachment.path, answerRequestPathBytes) === false ||
		isSha256(input.attachment.sha256) === false ||
		Number.isSafeInteger(input.timeoutSeconds) === false ||
		input.timeoutSeconds < answerRequestTimeoutMinimumSeconds ||
		input.timeoutSeconds > answerRequestTimeoutMaximumSeconds
	)
		return null;

	return {
		protocolVersion: answerRequestProtocolVersion,
		requestId: input.requestId,
		operation: "answer",
		prompt: input.prompt,
		attachments: [{ path: input.attachment.path, mimeType: "image/png", sha256: input.attachment.sha256 }],
		timeoutSeconds: input.timeoutSeconds,
	};
}

export function serializeAnswerRequest(request: AnswerRequest): string {
	return `${JSON.stringify(request)}\n`;
}

export function parseAnswerResponse(
	output: Uint8Array,
	expectedRequestId: string,
): AnswerClientResult {
	if (output.byteLength > answerResponseOutputBytes)
		return { kind: "failed", code: "output_too_large", message: "The answer response exceeded its limit." };

	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output));
	} catch {
		return { kind: "failed", code: "invalid_response", message: "The answer response was invalid." };
	}
	if (isRecord(value) === false || value.protocolVersion !== answerRequestProtocolVersion || value.requestId !== expectedRequestId)
		return { kind: "failed", code: "invalid_response", message: "The answer response did not match the request." };

	if (value.ok === true && hasOnlyKeys(value, ["protocolVersion", "requestId", "ok", "answer", "truncated"])) {
		if (
			isBoundedNonEmptyString(value.answer, answerResponseAnswerBytes) &&
			value.answer.trim().length > 0 &&
			typeof value.truncated === "boolean"
		)
			return { kind: "answered", answer: value.answer, truncated: value.truncated };
	}
	if (value.ok === false && hasOnlyKeys(value, ["protocolVersion", "requestId", "ok", "error"]) && isRecord(value.error)) {
		if (
			hasOnlyKeys(value.error, ["code", "message"]) &&
			isAnswerErrorCode(value.error.code) &&
			isBoundedNonEmptyString(value.error.message, answerResponseErrorBytes)
		)
			return value.error.code === "cancelled"
				? { kind: "cancelled" }
				: { kind: "failed", code: value.error.code, message: value.error.message };
	}
	return { kind: "failed", code: "invalid_response", message: "The answer response was invalid." };
}

function isBoundedNonEmptyString(value: unknown, maximumBytes: number): value is string {
	return typeof value === "string" && value.length > 0 && isUnicodeScalarString(value) && encoder.encode(value).byteLength <= maximumBytes;
}

function isUnicodeScalarString(value: string): boolean {
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

function isSha256(value: string): boolean {
	return /^[0-9a-f]{64}$/.test(value);
}

function isAnswerErrorCode(value: unknown): value is AnswerErrorCode {
	return typeof value === "string" && errorCodes.includes(value as AnswerErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
	const actualKeys = Object.keys(value);
	return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
