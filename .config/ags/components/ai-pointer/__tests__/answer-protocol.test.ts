import { describe, expect, test } from "bun:test";
import {
	createAnswerRequest,
	parseAnswerResponse,
	serializeAnswerRequest,
} from "../answer-protocol";

const input = {
	requestId: "run-42",
	prompt: "What does this error mean?",
	attachment: { path: "/run/user/1000/ai-pointer/capture.png", sha256: "a".repeat(64) },
	timeoutSeconds: 30,
};
const answerResponseAnswerBytes = 32 * 1024;

describe("AI Pointer answer protocol", () => {
	test("builds the fixed protocol-v1 answer request with one PNG attachment", () => {
		const request = createAnswerRequest(input);
		expect(request).toEqual({
			protocolVersion: 1,
			requestId: "run-42",
			operation: "answer",
			prompt: "What does this error mean?",
			attachments: [{ path: "/run/user/1000/ai-pointer/capture.png", mimeType: "image/png", sha256: "a".repeat(64) }],
			timeoutSeconds: 30,
		});
		expect(serializeAnswerRequest(request!)).toEndWith("\n");
	});

	test("rejects invalid prompts, digests, and timeouts before spawning", () => {
		expect(createAnswerRequest({ ...input, prompt: "   " })).toBeNull();
		expect(createAnswerRequest({ ...input, attachment: { ...input.attachment, sha256: "invalid" } })).toBeNull();
		expect(createAnswerRequest({ ...input, timeoutSeconds: 4 })).toBeNull();
	});

	test("accepts only a closed matching success response", () => {
		const response = new TextEncoder().encode(JSON.stringify({
			protocolVersion: 1, requestId: "run-42", ok: true, answer: "It is a permissions error.", truncated: false,
		}));
		expect(parseAnswerResponse(response, "run-42")).toEqual({ kind: "answered", answer: "It is a permissions error.", truncated: false });
		expect(parseAnswerResponse(new TextEncoder().encode(`${new TextDecoder().decode(response)} {}`), "run-42")).toMatchObject({ kind: "failed", code: "invalid_response" });
		expect(parseAnswerResponse(new TextEncoder().encode(JSON.stringify({ protocolVersion: 1, requestId: "other", ok: true, answer: "No", truncated: false })), "run-42")).toMatchObject({ kind: "failed", code: "invalid_response" });
	});

	test("bounds response strings and normalizes cancellation", () => {
		const oversized = JSON.stringify({ protocolVersion: 1, requestId: "run-42", ok: true, answer: "a".repeat(answerResponseAnswerBytes + 1), truncated: false });
		expect(parseAnswerResponse(new TextEncoder().encode(oversized), "run-42")).toMatchObject({ kind: "failed", code: "invalid_response" });
		const cancelled = JSON.stringify({ protocolVersion: 1, requestId: "run-42", ok: false, error: { code: "cancelled", message: "The answer request was cancelled." } });
		expect(parseAnswerResponse(new TextEncoder().encode(cancelled), "run-42")).toEqual({ kind: "cancelled" });
	});

	test("accepts a maximally escaped answer within the field limit", () => {
		const answer = "\"".repeat(answerResponseAnswerBytes);
		const response = new TextEncoder().encode(JSON.stringify({
			protocolVersion: 1,
			requestId: "run-42",
			ok: true,
			answer,
			truncated: false,
		}));
		expect(parseAnswerResponse(response, "run-42")).toEqual({
			kind: "answered",
			answer,
			truncated: false,
		});
	});
});
