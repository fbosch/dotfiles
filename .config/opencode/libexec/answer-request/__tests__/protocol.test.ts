import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  answerFailureSchema,
  answerRequestLimits,
  answerRequestLimitsSchema,
  answerSuccessSchema,
  answerToolPolicySchema,
  attachmentDescriptorSchema,
  createAnswerFailure,
  executeAnswerRequest,
  parseAnswerRequest,
  serializeAnswerResult,
  type AnswerBackend,
  type AnswerRequest,
  type AnswerSuccess,
} from "../index.js";
import { runAnswerPreflightCli, runAnswerRequestCli } from "../cli-runtime.js";

const encoder = new TextEncoder();

const validRequest = {
  protocolVersion: 2,
  requestId: "run-123",
  operation: "answer",
  prompt: "What is visible?",
  attachments: [],
  timeoutSeconds: 30,
} satisfies AnswerRequest;

describe("answer request protocol", () => {
  test("accepts a valid version 2 request", () => {
    assert.deepEqual(parseAnswerRequest(jsonBytes(validRequest)), {
      ok: true,
      request: validRequest,
    });
  });

  const invalidRequests = [
    ["malformed JSON", encoder.encode("{"), "invalid_request"],
    ["trailing JSON", encoder.encode(`${JSON.stringify(validRequest)} {}`), "invalid_request"],
    ["invalid UTF-8", Uint8Array.of(0xc3, 0x28), "invalid_request"],
    [
      "unknown fields",
      jsonBytes({ ...validRequest, agent: "desktop-pointer" }),
      "invalid_request",
    ],
    [
      "unsupported versions",
      jsonBytes({ ...validRequest, protocolVersion: 1 }),
      "unsupported_version",
    ],
    ["empty prompts", jsonBytes({ ...validRequest, prompt: " \n " }), "invalid_request"],
    ["short timeouts", jsonBytes({ ...validRequest, timeoutSeconds: 4 }), "invalid_request"],
    ["long timeouts", jsonBytes({ ...validRequest, timeoutSeconds: 121 }), "invalid_request"],
    ["lone high surrogates", jsonBytes({ ...validRequest, prompt: "\ud800" }), "invalid_request"],
    ["lone low surrogates", jsonBytes({ ...validRequest, prompt: "\udc00" }), "invalid_request"],
  ] as const;

  for (const [name, input, expectedCode] of invalidRequests) {
    test(`rejects ${name}`, () => {
      const parsed = parseAnswerRequest(input);
      assert.equal(parsed.ok, false);
      if (parsed.ok === false) assert.equal(parsed.result.error.code, expectedCode);
    });
  }

  test("rejects input larger than 64 KiB", () => {
    const parsed = parseAnswerRequest(
      new Uint8Array(answerRequestLimits.requestBytes + 1).fill(0x20),
    );
    assert.equal(parsed.ok, false);
    if (parsed.ok === false) assert.equal(parsed.result.error.code, "invalid_request");
  });

  test("counts prompt limits in UTF-8 bytes", () => {
    const exactPrompt = "é".repeat(answerRequestLimits.promptBytes / 2);
    assert.equal(parseAnswerRequest(jsonBytes({ ...validRequest, prompt: exactPrompt })).ok, true);

    const oversizedPrompt = `${exactPrompt}é`;
    assert.equal(parseAnswerRequest(jsonBytes({ ...validRequest, prompt: oversizedPrompt })).ok, false);
  });

  test("accepts valid Unicode surrogate pairs", () => {
    assert.equal(parseAnswerRequest(jsonBytes({ ...validRequest, prompt: "What is this? 😀" })).ok, true);
  });

  test("keeps every protocol object schema closed", () => {
    assert.equal(
      attachmentDescriptorSchema.safeParse({
        path: "/capture.png",
        mimeType: "image/png",
        sha256: "a".repeat(64),
        unknown: true,
      }).success,
      false,
    );
    assert.equal(
      answerRequestLimitsSchema.safeParse({ ...answerRequestLimits, unknown: true }).success,
      false,
    );
    assert.equal(
      answerToolPolicySchema.safeParse({ mode: "read_only_web", tools: {}, unknown: true }).success,
      false,
    );
		assert.equal(
			answerToolPolicySchema.safeParse({ mode: "read_only_web", tools: { bash: true } }).success,
			false,
		);
    assert.equal(
      answerSuccessSchema.safeParse({
        protocolVersion: 2,
        requestId: "run",
        ok: true,
        answer: "answer",
        truncated: false,
        unknown: true,
      }).success,
      false,
    );
    assert.equal(
      answerFailureSchema.safeParse({
        protocolVersion: 2,
        requestId: "run",
        ok: false,
        error: { code: "invalid_request", message: "Invalid", unknown: true },
      }).success,
      false,
    );
  });

  test("rejects malformed backend output", async () => {
    const result = await executeAnswerRequest(jsonBytes(validRequest), backend(async () => ({
      protocolVersion: 2,
      requestId: "another-run",
      ok: true,
      answer: "Answer",
      truncated: false,
    }) as never));
    assert.deepEqual(result, createAnswerFailure("internal_error", validRequest.requestId));
  });

  test("canonicalizes failure messages during serialization", () => {
    const serialized = serializeAnswerResult({
      protocolVersion: 2,
      requestId: validRequest.requestId,
      ok: false,
      error: {
        code: "provider_failed",
        message: "SECRET at /private/capture.png",
      },
    });

    assert.equal(
      serialized,
      `${JSON.stringify(createAnswerFailure("provider_failed", validRequest.requestId))}\n`,
    );
  });
});

describe("answer request CLI", () => {
  test("emits one bounded newline-terminated readiness result without reading a request", async () => {
    const stdout: string[] = [];
    let called = 0;
    const exitCode = await runAnswerPreflightCli({
      preflight: async () => {
        called += 1;
        return { ready: false, code: "backend_policy_invalid" };
      },
      stdout: { write: (value) => stdout.push(value) },
    });

    assert.equal(exitCode, 1);
    assert.equal(called, 1);
    assert.deepEqual(stdout, ["{\"ready\":false,\"code\":\"backend_policy_invalid\"}\n"]);
    assert.ok(Buffer.byteLength(stdout[0] ?? "") <= answerRequestLimits.diagnosticBytes);
  });

  test("emits bounded start, delta, and final records without stdout contamination", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const success: AnswerSuccess = {
      protocolVersion: 2,
      requestId: validRequest.requestId,
      ok: true,
      answer: "A bounded answer.",
      truncated: false,
    };

    const exitCode = await runAnswerRequestCli({
      input: chunks(jsonBytes(validRequest)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
      backend: backend(async (request) => {
        request.onDelta?.("A bounded ");
        request.onDelta?.("answer.");
        return { ok: true, parts: [{ type: "text", text: success.answer }] };
      }),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(records(stdout), [
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 0, event: "start" },
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 1, event: "delta", text: "A bounded " },
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 2, event: "delta", text: "answer." },
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 3, event: "final", answer: success.answer, truncated: false },
    ]);
    assert.deepEqual(stderr, []);
  });

  test("redacts thrown diagnostics and still emits one failure result", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const secretPrompt = validRequest.prompt;

    const exitCode = await runAnswerRequestCli({
      input: chunks(jsonBytes(validRequest)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
      backend: backend(async () => {
        throw new Error(`provider rejected ${secretPrompt} at /private/capture.png`);
      }),
    });

    assert.equal(exitCode, 1);
    assert.equal(records(stdout).length, 2);
    assert.equal(records(stdout)[1]?.error?.code, "internal_error");
    assert.equal(`${stdout.join("")} ${stderr.join("")}`.includes(secretPrompt), false);
    assert.equal(
      `${stdout.join("")} ${stderr.join("")}`.includes("/private/capture.png"),
      false,
    );
  });

  test("canonicalizes backend failures without accepting backend messages", async () => {
    const secret = "SECRET at /private/capture.png";
    const result = await executeAnswerRequest(jsonBytes(validRequest), backend(async () => ({
      ok: false,
      code: "provider_failed",
      message: secret,
    })));

    assert.deepEqual(result, createAnswerFailure("internal_error", validRequest.requestId));
    assert.equal(JSON.stringify(result).includes(secret), false);
  });

  test("returns attachment failures from the lazy backend loader", async () => {
    let executed = false;
    const result = await executeAnswerRequest(
      jsonBytes({
        ...validRequest,
        attachments: [
          {
            path: "/does/not/exist.png",
            mimeType: "image/png",
            sha256: "0".repeat(64),
          },
        ],
      }),
      backend(async (request) => {
        executed = true;
        const attachments = await request.loadAttachments();
        if (attachments.isErr()) return { ok: false, code: attachments.error.code };
        return { ok: true, parts: [{ type: "text", text: "should not execute" }] };
      }),
    );

    assert.equal(executed, true);
    assert.deepEqual(result, createAnswerFailure("attachment_invalid", validRequest.requestId));
  });

  test("returns one invalid request result for a non-scalar request ID", async () => {
    const stdout: string[] = [];
    const exitCode = await runAnswerRequestCli({
      input: chunks(jsonBytes({ ...validRequest, requestId: "\ud800" })),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => undefined },
      backend: backend(async () => ({ ok: true, parts: [] })),
    });

    assert.equal(exitCode, 1);
    assert.equal(stdout.length, 1);
    assert.deepEqual(JSON.parse(stdout[0] ?? ""), {
      protocolVersion: 2,
      requestId: null,
      sequence: 0,
      event: "error",
      error: createAnswerFailure("invalid_request").error,
    });
  });

  test("bounds stdin before execution", async () => {
    let executed = false;
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runAnswerRequestCli({
      input: chunks(new Uint8Array(answerRequestLimits.requestBytes + 1)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: (value) => stderr.push(value) },
      backend: backend(async () => {
        executed = true;
        return { ok: false, code: "provider_failed" };
      }),
    });

    assert.equal(exitCode, 1);
    assert.equal(executed, false);
    assert.equal(JSON.parse(stdout[0] ?? "").error.code, "invalid_request");
    assert.ok(Buffer.byteLength(stderr.join("")) <= answerRequestLimits.diagnosticBytes);
  });

  test("bounds stalled stdin before execution", async () => {
    let executed = false;
    const stdout: string[] = [];

    const exitCode = await runAnswerRequestCli({
      input: stalledInput(),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => undefined },
      backend: backend(async () => {
        executed = true;
        return { ok: false, code: "provider_failed" };
      }),
      inputTimeoutMilliseconds: 10,
    });

    assert.equal(exitCode, 1);
    assert.equal(executed, false);
    assert.equal(JSON.parse(stdout[0] ?? "").error.code, "invalid_request");
  });

  test("isolates process stdout and stderr from a noisy executor", () => {
    const fixture = fileURLToPath(new URL("./fixtures/noisy-cli.ts", import.meta.url));
    const result = spawnSync(process.execPath, ["run", "--no-install", fixture], {
      input: JSON.stringify(validRequest),
      encoding: "utf8",
    });
    assert.equal(result.status, 0);
    assert.deepEqual(records([result.stdout]), [
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 0, event: "start" },
      { protocolVersion: 2, requestId: validRequest.requestId, sequence: 1, event: "final", answer: "A bounded answer.", truncated: false },
    ]);
    assert.equal(result.stderr, "");
  });

  test("suppresses deltas beyond the answer budget and keeps a terminal record", async () => {
    const stdout: string[] = [];
    const exitCode = await runAnswerRequestCli({
      input: chunks(jsonBytes(validRequest)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => undefined },
      backend: backend(async (request) => {
        request.onDelta?.("a".repeat(answerRequestLimits.responseBytes));
        request.onDelta?.("ignored");
        return { ok: true, parts: [{ type: "text", text: "final" }] };
      }),
    });

    const output = records(stdout);
    assert.equal(exitCode, 0);
    assert.deepEqual(output.map((record) => record.event), ["start", "delta", "final"]);
    assert.equal(output[2]?.sequence, 2);
    assert.ok(Buffer.byteLength(stdout.join("")) <= 256 * 1024);
  });

  test("fits heavily escaped final text in one bounded frame", async () => {
    const stdout: string[] = [];
    await runAnswerRequestCli({
      input: chunks(jsonBytes(validRequest)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => undefined },
      backend: backend(async () => ({ ok: true, parts: [{ type: "text", text: "\u0000".repeat(answerRequestLimits.responseBytes) }] })),
    });

    const final = records(stdout).at(-1);
    assert.equal(final?.event, "final");
    assert.equal(final?.truncated, true);
    assert.ok(Buffer.byteLength(stdout.at(-1) ?? "") <= 64 * 1024);
  });

  test("ignores a retained delta callback after backend settlement", async () => {
    const stdout: string[] = [];
    let emitLateDelta: ((text: string) => void) | undefined;
    await runAnswerRequestCli({
      input: chunks(jsonBytes(validRequest)),
      stdout: { write: (value) => stdout.push(value) },
      stderr: { write: () => undefined },
      backend: backend(async (request) => {
        emitLateDelta = request.onDelta;
        return { ok: true, parts: [{ type: "text", text: "final" }] };
      }),
    });

    emitLateDelta?.("late");
    assert.deepEqual(records(stdout).map((record) => record.event), ["start", "final"]);
  });
});

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function backend(execute: AnswerBackend["execute"]): AnswerBackend {
  return { execute };
}

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* values;
}

async function* stalledInput(): AsyncGenerator<Uint8Array> {
  yield jsonBytes(validRequest);
  await new Promise<never>(() => undefined);
}

type StreamRecord = Record<string, unknown> & {
  error?: { code?: unknown };
  event?: unknown;
  sequence?: unknown;
  truncated?: unknown;
};

function records(chunks: string[]): StreamRecord[] {
  return chunks.join("").trimEnd().split("\n").map((line) => JSON.parse(line) as StreamRecord);
}
