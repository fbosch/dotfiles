const answerRequestProtocolVersion = 2;
const answerRequestPromptBytes = 16 * 1024;
const answerRequestIdBytes = 128;
const answerRequestPathBytes = 4096;
const answerRequestTimeoutMinimumSeconds = 5;
const answerRequestTimeoutMaximumSeconds = 120;
const answerResponseFrameBytes = 64 * 1024;
const answerResponseTextBytes = 32 * 1024;
const answerResponseErrorBytes = 1024;
export const answerResponseOutputBytes = 256 * 1024;

const encoder = new TextEncoder();
const errorCodes = [
	"invalid_request", "unsupported_version", "attachment_invalid", "attachment_too_large",
	"attachment_changed", "backend_unavailable", "backend_policy_invalid", "incompatible_version",
	"provider_failed", "empty_response", "timeout", "cancelled", "cleanup_failed", "internal_error",
] as const;

export type AnswerErrorCode = typeof errorCodes[number];

export interface AnswerRequestInput {
	requestId: string;
	prompt: string;
	attachment: { path: string; sha256: string };
	timeoutSeconds: number;
}

export interface AnswerRequest {
	protocolVersion: 2;
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

export interface AnswerResponseParser {
	push(chunk: Uint8Array): AnswerClientResult | null;
	finish(): AnswerClientResult;
}

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
	) return null;

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

export function createAnswerResponseParser(
	expectedRequestId: string,
	onDelta: (text: string) => void,
): AnswerResponseParser {
	let buffered = new Uint8Array();
	let outputBytes = 0;
	let nextSequence = 0;
	let started = false;
	let terminal: AnswerClientResult | null = null;
	let failure: AnswerClientResult | null = null;
	let deltaBytes = 0;
	let partialAnswer = "";

	const invalidate = (code: "invalid_response" | "output_too_large", message: string) => {
		if (failure === null) {
			failure = { kind: "failed", code, message };
			onDelta("");
		}
		return failure;
	};

	const parseFrame = (frame: Uint8Array): AnswerClientResult | null => {
		if (frame.byteLength > answerResponseFrameBytes)
			return invalidate("output_too_large", "The answer response exceeded its frame limit.");
		let value: unknown;
		try {
			value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(frame));
		} catch {
			return invalidate("invalid_response", "The answer response was invalid.");
		}
		if (isRecord(value) === false || terminal !== null)
			return invalidate("invalid_response", "The answer response was invalid.");
		if (value.protocolVersion !== answerRequestProtocolVersion || value.requestId !== expectedRequestId || value.sequence !== nextSequence)
			return invalidate("invalid_response", "The answer response did not match the request.");
		if (value.event === "start" && hasOnlyKeys(value, ["protocolVersion", "requestId", "sequence", "event"])) {
			if (started || nextSequence !== 0)
				return invalidate("invalid_response", "The answer response was out of order.");
			started = true;
			nextSequence += 1;
			return null;
		}
		if (value.event === "delta" && hasOnlyKeys(value, ["protocolVersion", "requestId", "sequence", "event", "text"])) {
			if (started === false || isBoundedNonEmptyString(value.text, answerResponseTextBytes) === false)
				return invalidate("invalid_response", "The answer response was invalid.");
			deltaBytes += encoder.encode(value.text).byteLength;
			if (deltaBytes > answerResponseTextBytes)
				return invalidate("output_too_large", "The answer response exceeded its text limit.");
			nextSequence += 1;
			partialAnswer += value.text;
			onDelta(partialAnswer);
			return null;
		}
		if (value.event === "final" && hasOnlyKeys(value, ["protocolVersion", "requestId", "sequence", "event", "answer", "truncated"])) {
			if (started === false || isBoundedNonEmptyString(value.answer, answerResponseTextBytes) === false || value.answer.trim().length === 0 || typeof value.truncated !== "boolean")
				return invalidate("invalid_response", "The answer response was invalid.");
			nextSequence += 1;
			terminal = { kind: "answered", answer: value.answer, truncated: value.truncated };
			return null;
		}
		if (value.event === "error" && hasOnlyKeys(value, ["protocolVersion", "requestId", "sequence", "event", "error"]) && isRecord(value.error)) {
			if (started === false || hasOnlyKeys(value.error, ["code", "message"]) === false || isAnswerErrorCode(value.error.code) === false || isBoundedNonEmptyString(value.error.message, answerResponseErrorBytes) === false)
				return invalidate("invalid_response", "The answer response was invalid.");
			nextSequence += 1;
			onDelta("");
			terminal = value.error.code === "cancelled"
				? { kind: "cancelled" }
				: { kind: "failed", code: value.error.code, message: value.error.message };
			return null;
		}
		return invalidate("invalid_response", "The answer response was invalid.");
	};

	return {
		push(chunk) {
			if (failure) return failure;
			outputBytes += chunk.byteLength;
			if (outputBytes > answerResponseOutputBytes)
				return invalidate("output_too_large", "The answer response exceeded its limit.");
			const combined = new Uint8Array(buffered.byteLength + chunk.byteLength);
			combined.set(buffered);
			combined.set(chunk, buffered.byteLength);
			let offset = 0;
			while (offset < combined.byteLength) {
				const newline = combined.indexOf(0x0a, offset);
				if (newline === -1) break;
				let frame = combined.slice(offset, newline);
				if (frame.byteLength > answerResponseFrameBytes)
					return invalidate("output_too_large", "The answer response exceeded its frame limit.");
				if (frame.at(-1) === 0x0d) frame = frame.slice(0, -1);
				const result = parseFrame(frame);
				if (result) return result;
				offset = newline + 1;
			}
			buffered = combined.slice(offset);
			if (buffered.byteLength > answerResponseFrameBytes)
				return invalidate("output_too_large", "The answer response exceeded its frame limit.");
			return null;
		},
		finish() {
			if (failure) return failure;
			if (buffered.byteLength !== 0 || terminal === null)
				return invalidate("invalid_response", "The answer response ended before a terminal record.");
			return terminal;
		},
	};
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

function isSha256(value: string): boolean { return /^[0-9a-f]{64}$/.test(value); }
function isAnswerErrorCode(value: unknown): value is AnswerErrorCode { return typeof value === "string" && errorCodes.includes(value as AnswerErrorCode); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && Array.isArray(value) === false; }
function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
	const actualKeys = Object.keys(value);
	return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
