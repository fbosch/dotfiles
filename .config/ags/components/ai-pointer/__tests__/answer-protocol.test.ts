import { describe, expect, test } from "bun:test";
import {
	createAnswerRequest,
	createAnswerResponseParser,
	serializeAnswerRequest,
} from "../answer-protocol";

const input = {
	requestId: "run-42",
	prompt: "What does this error mean?",
	attachment: { path: "/run/user/1000/ai-pointer/capture.png", sha256: "a".repeat(64) },
	timeoutSeconds: 30,
};

const frame = (event: Record<string, unknown>) => new TextEncoder().encode(`${JSON.stringify({ protocolVersion: 2, requestId: "run-42", ...event })}\n`);

describe("AI Pointer answer protocol", () => {
	test("builds the fixed protocol-v2 answer request with one PNG attachment", () => {
		const request = createAnswerRequest(input);
		expect(request).toEqual({
			protocolVersion: 2,
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

	test("accepts split UTF-8 frames and invokes deltas in order", () => {
		const deltas: string[] = [];
		const parser = createAnswerResponseParser("run-42", (text) => deltas.push(text));
		const output = new Uint8Array([
			...frame({ sequence: 0, event: "start" }),
			...frame({ sequence: 1, event: "delta", text: "Aér" }),
			...frame({ sequence: 2, event: "final", answer: "Aér", truncated: false }),
		]);
		const split = output.indexOf(0xc3) + 1;
		expect(parser.push(output.slice(0, split))).toBeNull();
		expect(parser.push(output.slice(split))).toBeNull();
		expect(deltas).toEqual(["Aér"]);
		expect(parser.finish()).toEqual({ kind: "answered", answer: "Aér", truncated: false });
	});

	test("accepts multiple records in one chunk and treats final as authoritative", () => {
		const deltas: string[] = [];
		const parser = createAnswerResponseParser("run-42", (text) => deltas.push(text));
		parser.push(new Uint8Array([
			...frame({ sequence: 0, event: "start" }),
			...frame({ sequence: 1, event: "delta", text: "draft" }),
			...frame({ sequence: 2, event: "delta", text: " answer" }),
			...frame({ sequence: 3, event: "final", answer: "replacement", truncated: true }),
		]));
		expect(deltas).toEqual(["draft", "draft answer"]);
		expect(parser.finish()).toEqual({ kind: "answered", answer: "replacement", truncated: true });
	});

	test("clears provisional text as soon as a terminal error arrives", () => {
		const snapshots: string[] = [];
		const parser = createAnswerResponseParser("run-42", (text) => snapshots.push(text));
		parser.push(new Uint8Array([
			...frame({ sequence: 0, event: "start" }),
			...frame({ sequence: 1, event: "delta", text: "draft" }),
			...frame({ sequence: 2, event: "error", error: { code: "provider_failed", message: "The answer provider failed." } }),
		]));
		expect(snapshots).toEqual(["draft", ""]);
		expect(parser.finish()).toMatchObject({ kind: "failed", code: "provider_failed" });
	});

	test("rejects a whitespace-only final answer", () => {
		const parser = createAnswerResponseParser("run-42", () => {});
		parser.push(new Uint8Array([
			...frame({ sequence: 0, event: "start" }),
			...frame({ sequence: 1, event: "final", answer: "   ", truncated: false }),
		]));
		expect(parser.finish()).toMatchObject({ kind: "failed", code: "invalid_response" });
	});

	test("rejects mismatched IDs, out-of-order records, unknown fields, and data after terminal", () => {
		for (const records of [
			[frame({ sequence: 0, event: "start" }), new TextEncoder().encode('{"protocolVersion":2,"requestId":"other","sequence":1,"event":"final","answer":"no","truncated":false}\n')],
			[frame({ sequence: 1, event: "start" })],
			[new TextEncoder().encode('{"protocolVersion":2,"requestId":"run-42","sequence":0,"event":"start","extra":true}\n')],
			[frame({ sequence: 0, event: "start" }), frame({ sequence: 1, event: "final", answer: "yes", truncated: false }), frame({ sequence: 2, event: "delta", text: "late" })],
		]) {
			const parser = createAnswerResponseParser("run-42", () => {});
			let result = null;
			for (const record of records) result ??= parser.push(record);
			expect(result).toMatchObject({ kind: "failed", code: "invalid_response" });
		}
	});

	test("requires a newline-terminated terminal record and bounds aggregate deltas", () => {
		const parser = createAnswerResponseParser("run-42", () => {});
		parser.push(frame({ sequence: 0, event: "start" }));
		parser.push(new TextEncoder().encode('{"protocolVersion":2,"requestId":"run-42","sequence":1,"event":"final","answer":"unfinished","truncated":false}'));
		expect(parser.finish()).toMatchObject({ kind: "failed", code: "invalid_response" });

		const oversized = createAnswerResponseParser("run-42", () => {});
		oversized.push(frame({ sequence: 0, event: "start" }));
		expect(oversized.push(frame({ sequence: 1, event: "delta", text: "a".repeat(32 * 1024) }))).toBeNull();
		expect(oversized.push(frame({ sequence: 2, event: "delta", text: "b" }))).toMatchObject({ kind: "failed", code: "output_too_large" });
	});
});
