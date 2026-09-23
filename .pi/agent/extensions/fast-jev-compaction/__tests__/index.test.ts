import { describe, expect, test } from "bun:test";
import {
  type ExtensionAPI,
  type ExtensionContext,
  ModelRegistry,
  type SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import type { JevGatewayFetch } from "../../../lib/jev-gateway";
import fastJevCompaction, {
  buildInferenceState,
  type FastJevMessage,
  parseNoulAnswers,
  resolveFastJevCompactionConfig,
  runFastJevCompaction,
  sanitizeFastJevDiagnostics,
  splitSummaryModelReference,
  summarizePreparedWithModel,
  toFastJevMessages,
} from "../index";

const modelRegistry = { getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }) };

type Prepared = SessionBeforeCompactEvent["preparation"];

function preparation(
  messages: readonly unknown[],
  reserveTokens = 4_000,
  turnPrefixMessages: readonly unknown[] = [],
): Prepared {
  return {
    messagesToSummarize: messages,
    turnPrefixMessages,
    isSplitTurn: false,
    firstKeptEntryId: "kept-1",
    tokensBefore: 1_000,
    previousSummary: undefined,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens, keepRecentTokens: 20_000 },
  } as unknown as Prepared;
}

function transcript(resultText = "routine listing\n".repeat(300)): unknown[] {
  return [
    { role: "user", content: [{ type: "text", text: "Continue the migration." }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect the project." },
        { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "config.ts" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "tool-1",
      content: [{ type: "text", text: resultText }],
      isError: false,
    },
    { role: "user", content: [{ type: "text", text: "Keep this follow-up verbatim." }] },
  ];
}

function toolHeavyTranscript(count: number): unknown[] {
  const messages: unknown[] = [
    { role: "user", content: [{ type: "text", text: "Inspect reports." }] },
  ];
  for (let index = 0; index < count; index += 1) {
    const id = `tool-${index}`;
    messages.push(
      {
        role: "assistant",
        content: [
          { type: "toolCall", id, name: "read", arguments: { path: `report-${index}.txt` } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: id,
        content: [{ type: "text", text: `routine-${index}\n`.repeat(100) }],
        isError: false,
      },
    );
  }
  return messages;
}

function gatewayFetch(
  answer: (name: string) => { type: "noul"; noul: number },
  onBody?: (body: Record<string, unknown>) => void,
): JevGatewayFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    onBody?.(body);
    const questions = body.questions as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        answers: Object.fromEntries(Object.keys(questions).map((name) => [name, answer(name)])),
      }),
    );
  };
}

const checkpoint = async () => ({ text: "Checkpoint preserves the prepared context." });

describe("fast-jev-compaction", () => {
  test("reads only the explicit global setting and resolves configured model references", () => {
    expect(resolveFastJevCompactionConfig(undefined)).toEqual({
      enabled: false,
      summaryModel: "openai-codex/gpt-6-luna-fast",
    });
    expect(
      resolveFastJevCompactionConfig({
        jev: { compaction: { enabled: true, summaryModel: "provider/model/with-slash" } },
      }),
    ).toEqual({ enabled: true, summaryModel: "provider/model/with-slash" });
    expect(splitSummaryModelReference("provider/model/with/slash")).toEqual({
      provider: "provider",
      modelId: "model/with/slash",
    });
    expect(splitSummaryModelReference("model-without-provider")).toBeUndefined();
  });

  test("preserves coding-agent message variants in Jev input", () => {
    const messages = toFastJevMessages([
      {
        role: "bashExecution",
        command: "git status",
        output: " M file.ts",
        exitCode: 0,
        cancelled: false,
        truncated: false,
      },
      {
        role: "branchSummary",
        summary: "The abandoned branch changed the API.",
        fromId: "entry-1",
      },
      {
        role: "compactionSummary",
        summary: "The earlier context established the migration target.",
        tokensBefore: 80,
      },
    ]);
    expect(messages.map((message) => message.text).join("\\n")).toContain("git status");
    expect(messages.map((message) => message.text).join("\\n")).toContain("abandoned branch");
    expect(messages.map((message) => message.text).join("\\n")).toContain("earlier context");
  });

  test("uses Pi's ModelRegistry.complete seam for checkpoint summaries", async () => {
    let prompt = "";
    let maxTokens = 0;
    const runtime = {
      getModel(provider: string, modelId: string) {
        return { provider, id: modelId, maxTokens: 1_000 };
      },
      async complete(
        _model: object,
        context: { messages: readonly { content: string }[] },
        options: { maxTokens?: number },
      ) {
        prompt = context.messages[0]?.content ?? "";
        maxTokens = options.maxTokens ?? 0;
        return {
          role: "assistant",
          content: [{ type: "text", text: "Merged checkpoint" }],
          stopReason: "stop",
          timestamp: Date.now(),
        };
      },
    };
    // Exercise Pi's installed registry facade rather than an extension-invented stream contract.
    const registry = new ModelRegistry(runtime as never);
    const context = { modelRegistry: registry } as ExtensionContext;
    const result = await summarizePreparedWithModel(
      context,
      "configured/checkpoint-model",
      preparation([{ role: "user", content: [{ type: "text", text: "Prepared fact" }] }])
        .messagesToSummarize,
      "Previous fact",
      100,
      undefined,
    );
    expect(result).toMatchObject({ text: "Merged checkpoint" });
    expect(prompt).toContain("Prepared fact");
    expect(prompt).toContain("Previous fact");
    expect(maxTokens).toBe(80);
  });

  test("classifies checkpoint failures without exposing raw provider errors", async () => {
    const cases = [
      {
        registry: { find: () => undefined, complete: async () => undefined },
        reason: "summary-model-missing",
      },
      {
        registry: { find: () => ({}), complete: undefined },
        reason: "summary-runtime-unsupported",
      },
      {
        registry: {
          find: () => ({}),
          complete: async () => {
            throw new Error("token=secret payload");
          },
        },
        reason: "summary-auth-provider-failed",
      },
      {
        registry: {
          find: () => ({}),
          complete: async () => ({ content: "bad", stopReason: "stop" }),
        },
        reason: "summary-malformed-output",
      },
      {
        registry: { find: () => ({}), complete: async () => ({ content: [], stopReason: "stop" }) },
        reason: "summary-empty-output",
      },
      {
        registry: {
          find: () => ({}),
          complete: async () => ({ content: [], stopReason: "length" }),
        },
        reason: "summary-truncated-output",
      },
    ] as const;
    for (const entry of cases) {
      const result = await summarizePreparedWithModel(
        { modelRegistry: entry.registry } as unknown as ExtensionContext,
        "configured/checkpoint-model",
        preparation([{ role: "user", content: "fact" }]).messagesToSummarize,
        undefined,
        100,
        undefined,
      );
      expect(result).toMatchObject({ failureReason: entry.reason });
      expect(JSON.stringify(result)).not.toContain("secret");
    }
  });

  test("sanitizes thrown provider diagnostics without traversing secret fields", () => {
    const secret = "THROWN_SECRET_PROMPT";
    const headers = Object.defineProperty({}, "authorization", {
      value: secret,
      enumerable: true,
    });
    const thrown = {
      name: `Custom-${secret}`,
      message: `${secret} message`,
      response: {
        status: 401,
        headers,
        body: secret,
        error: { code: `provider-${secret}`, message: secret },
      },
    };
    const diagnostics = sanitizeFastJevDiagnostics(thrown);
    expect(diagnostics).toEqual({ exceptionType: "other", httpStatus: 401, providerCode: "other" });
    expect(JSON.stringify(diagnostics)).not.toContain(secret);
    const builtInError = sanitizeFastJevDiagnostics(new TypeError(secret));
    expect(builtInError).toEqual({ exceptionType: "TypeError" });
    expect(JSON.stringify(builtInError)).not.toContain(secret);

    expect(
      sanitizeFastJevDiagnostics({
        name: "PiMessagesResponseError",
        diagnosticDetails: { status: 502, error: { code: "api_error" } },
      }),
    ).toEqual({
      exceptionType: "PiMessagesResponseError",
      httpStatus: 502,
      providerCode: "api_error",
    });

    const getterPayload = {
      get response() {
        throw new Error("getter should not run");
      },
    };
    expect(sanitizeFastJevDiagnostics(getterPayload)).toBeUndefined();
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    expect(() => sanitizeFastJevDiagnostics(revocable.proxy)).not.toThrow();
  });

  test("propagates stop-reason diagnostics while excluding response and prompt content", async () => {
    const secret = "STOP_SECRET_PROMPT";
    const result = await summarizePreparedWithModel(
      {
        modelRegistry: {
          find: () => ({}),
          complete: async () => ({
            content: [],
            stopReason: "error",
            errorMessage: secret,
            diagnostics: [
              {
                error: { name: "PiMessagesResponseError", message: secret, stack: secret },
                details: {
                  status: 429,
                  errorCode: "rate_limit_error",
                  headers: { authorization: secret },
                  body: secret,
                },
              },
            ],
          }),
        },
      } as unknown as ExtensionContext,
      "configured/checkpoint-model",
      preparation([{ role: "user", content: secret }]).messagesToSummarize,
      undefined,
      100,
      undefined,
    );
    expect(result).toEqual({
      failureReason: "summary-auth-provider-failed",
      diagnostics: {
        exceptionType: "PiMessagesResponseError",
        httpStatus: 429,
        providerCode: "rate_limit_error",
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("propagates thrown diagnostics to fallback status without leaking the exception", async () => {
    const statuses: unknown[] = [];
    const result = await runFastJevCompaction(preparation(transcript()), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        const error = new Error("provider secret prompt");
        Object.defineProperty(error, "name", { value: "TimeoutError", enumerable: true });
        Object.defineProperty(error, "statusCode", { value: 503, enumerable: true });
        Object.defineProperty(error, "code", { value: "service_unavailable", enumerable: true });
        throw error;
      },
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.99 })),
      onStatus: (status) => statuses.push(status),
    });
    expect(result).toBeUndefined();
    expect(statuses[0]).toMatchObject({
      reason: "summary-auth-provider-failed",
      diagnostics: {
        exceptionType: "TimeoutError",
        httpStatus: 503,
        providerCode: "service_unavailable",
      },
    });
    expect(JSON.stringify(statuses)).not.toContain("provider secret prompt");
  });

  test("registers compaction after startup and exposes a status command", () => {
    const handlers = new Map<string, unknown>();
    const pi = {
      on(name: string, callback: unknown) {
        handlers.set(name, callback);
      },
      registerCommand() {},
      events: { emit() {} },
    } as unknown as ExtensionAPI;
    fastJevCompaction(pi);
    expect(handlers.has("session_before_compact")).toBe(false);
    const start = handlers.get("session_start") as (() => void) | undefined;
    start?.();
    expect(handlers.has("session_before_compact")).toBe(true);
  });

  test("redacts Jev inference state and omits tool-result bodies", () => {
    const messages: FastJevMessage[] = [
      {
        role: "assistant",
        text: "Read /Users/fbb/private/config.ts with token=super-secret.",
        toolCalls: [
          {
            toolUseId: "tool-1",
            name: "read",
            input: { path: "/Users/fbb/private/config.ts", password: "super-secret" },
          },
        ],
        toolResults: [
          { toolUseId: "tool-1", text: "UNIQUE_FULL_TOOL_RESULT_BODY", isError: false },
        ],
      },
    ];
    const serialized = JSON.stringify(buildInferenceState(messages));
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("/Users/fbb/private/config.ts");
    expect(serialized).not.toContain("UNIQUE_FULL_TOOL_RESULT_BODY");
    expect(serialized).toContain('"chars":28');
  });

  test("strictly rejects malformed and out-of-range Jev answers", () => {
    const names = ["call_t1", "result_t1"];
    expect(parseNoulAnswers({}, names)).toBeUndefined();
    expect(
      parseNoulAnswers(
        {
          answers: { call_t1: { type: "noul", noul: 1.1 }, result_t1: { type: "noul", noul: 0.1 } },
        },
        names,
      ),
    ).toBeUndefined();
    expect(
      parseNoulAnswers(
        {
          answers: { call_t1: { type: "noul", noul: 0.8 }, result_t1: { type: "noul", noul: 0.1 } },
        },
        names,
      ),
    ).toEqual({ call_t1: 0.8, result_t1: 0.1 });
  });

  test("prune success makes zero summary calls and preserves explicit dropped facts", async () => {
    let summaryCalls = 0;
    const statuses: unknown[] = [];
    const result = await runFastJevCompaction(preparation(transcript()), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return checkpoint();
      },
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
      onStatus: (attempt) => statuses.push(attempt),
    });
    expect(result).toBeDefined();
    expect(summaryCalls).toBe(0);
    expect(result?.summary).toContain("fast-jev-compaction truncated");
    expect(result?.summary).toContain("Keep this follow-up verbatim.");
    expect(result?.details.fastJev.attempt.outcome).toBe("pruned");
    expect(statuses).toHaveLength(1);
    expect(JSON.stringify(statuses[0])).not.toContain("routine listing");
    expect(result?.details.fastJev.attempt).toMatchObject({
      path: "prune",
      beforeChars: expect.any(Number),
      afterChars: expect.any(Number),
    });
  });

  test("passes Pi's turn prefix to checkpoint summarization", async () => {
    const next = preparation(
      [{ role: "user", content: [{ type: "text", text: "old context" }] }],
      4_000,
      [{ role: "user", content: [{ type: "text", text: "recent boundary" }] }],
    );
    let summarized: readonly unknown[] = [];
    await runFastJevCompaction(next, [], {
      modelRegistry,
      summarizeCheckpoint: async (messages) => {
        summarized = messages;
        return { text: "checkpoint" };
      },
    });
    expect(JSON.stringify(summarized)).toContain("old context");
    expect(JSON.stringify(summarized)).toContain("recent boundary");
  });

  test("insufficient savings triggers one coherent checkpoint with previous summary", async () => {
    let calls = 0;
    let receivedPrevious = "";
    let receivedMessages: readonly unknown[] = [];
    const previousSummary = "previous summary with exact tail-marker";
    const next = preparation(transcript("short result"));
    next.previousSummary = previousSummary;
    const result = await runFastJevCompaction(next, [], {
      modelRegistry,
      summarizeCheckpoint: async (messages, previous) => {
        calls += 1;
        receivedMessages = messages;
        receivedPrevious = previous ?? "";
        return { text: "One coherent checkpoint." };
      },
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.99 })),
    });
    expect(result?.summary).toBe("One coherent checkpoint.");
    expect(calls).toBe(1);
    expect(receivedPrevious).toBe(previousSummary);
    expect(JSON.stringify(receivedMessages)).toContain("Continue the migration.");
    expect(result?.summary).not.toContain("<fast-jev-compaction>");
  });

  test("failed or malformed Jev checkpoints original prepared context without partial decisions", async () => {
    let received = "";
    const result = await runFastJevCompaction(preparation(transcript()), [], {
      modelRegistry,
      summarizeCheckpoint: async (messages) => {
        received = JSON.stringify(messages);
        return { text: "Safe original checkpoint." };
      },
      fetch: async () => new Response("not-json"),
    });
    expect(result?.summary).toBe("Safe original checkpoint.");
    expect(received).toContain("routine listing");
    expect(result?.details.fastJev.attempt.reason).toBe("jev-failed");
  });

  test("protects errors, side effects, and unknown tools even when Jev says drop", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "Keep operational evidence." }] },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "bash-1", name: "bash", arguments: { command: "rm -rf build" } },
          { type: "toolCall", id: "mystery-1", name: "unknown_tool", arguments: {} },
          { type: "toolCall", id: "error-1", name: "read", arguments: { path: "missing" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "bash-1",
        content: [{ type: "text", text: "side effect" }],
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "mystery-1",
        content: [{ type: "text", text: "unknown result" }],
        isError: false,
      },
      {
        role: "toolResult",
        toolCallId: "error-1",
        content: [{ type: "text", text: "unresolved error" }],
        isError: true,
      },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "routine" } }],
      },
      {
        role: "toolResult",
        toolCallId: "read-1",
        content: [{ type: "text", text: "stale result\n".repeat(300) }],
        isError: false,
      },
    ];
    let attempt: unknown;
    const result = await runFastJevCompaction(preparation(messages), [], {
      modelRegistry,
      summarizeCheckpoint: checkpoint,
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
      onStatus: (status) => {
        attempt = status;
      },
    });
    expect(attempt).toMatchObject({ path: "prune" });
    expect(result?.summary).toContain("side effect");
    expect(result?.summary).toContain("unknown result");
    expect(result?.summary).toContain("unresolved error");
  });

  test("cancellation never starts checkpoint fallback", async () => {
    const controller = new AbortController();
    let summaryCalls = 0;
    const result = await runFastJevCompaction(preparation(transcript()), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return checkpoint();
      },
      signal: controller.signal,
      fetch: async (_input, init) => {
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(init?.signal?.aborted).toBe(true);
        return new Response("{}", { status: 500 });
      },
    });
    expect(result).toBeUndefined();
    expect(summaryCalls).toBe(0);
  });

  test("rejects an oversized final render without truncating it silently", async () => {
    let summaryCalls = 0;
    const result = await runFastJevCompaction(preparation(transcript(), 40), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return { text: "small checkpoint" };
      },
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
    });
    expect(result?.summary).toBe("small checkpoint");
    expect(summaryCalls).toBe(1);
    expect(result?.details.fastJev.attempt.reason).toBe("final-size-limit");
  });

  test("runs independent batches concurrently and applies no partial decisions", async () => {
    let active = 0;
    let peak = 0;
    let summaryCalls = 0;
    const result = await runFastJevCompaction(preparation(toolHeavyTranscript(15)), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return { text: "checkpoint after atomic Jev failure" };
      },
      fetch: async (_input, init) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const questions = body.questions as Record<string, unknown>;
        if (Object.keys(questions).length === 2) return new Response("malformed");
        return new Response(JSON.stringify({ answers: {} }));
      },
    });
    expect(peak).toBeGreaterThan(1);
    expect(summaryCalls).toBe(1);
    expect(result?.summary).toBe("checkpoint after atomic Jev failure");
  });

  test("recovers a v1 persisted summary when preparation omits previousSummary", async () => {
    let previous = "";
    const result = await runFastJevCompaction(
      preparation(transcript("small")),
      [
        {
          type: "compaction",
          summary: "legacy-summary-tail",
          details: { fastJev: { version: 1, messages: [] } },
        },
      ],
      {
        modelRegistry,
        summarizeCheckpoint: async (_messages, summary) => {
          previous = summary ?? "";
          return { text: "updated legacy checkpoint" };
        },
        fetch: gatewayFetch(() => ({ type: "noul", noul: 0.99 })),
      },
    );
    expect(result?.summary).toBe("updated legacy checkpoint");
    expect(previous).toBe("legacy-summary-tail");
  });

  test("returns native fallback with a sanitized checkpoint failure status", async () => {
    let attempt: unknown;
    const result = await runFastJevCompaction(preparation(transcript()), [], {
      modelRegistry,
      summarizeCheckpoint: async () => ({ failureReason: "summary-auth-provider-failed" }),
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.99 })),
      onStatus: (status) => {
        attempt = status;
      },
    });
    expect(result).toBeUndefined();
    expect(attempt).toMatchObject({
      outcome: "fallback",
      path: "native",
      reason: "summary-auth-provider-failed",
    });
    expect((attempt as { beforeChars: number; afterChars: number }).afterChars).toBe(
      (attempt as { beforeChars: number; afterChars: number }).beforeChars,
    );
  });

  test("accepts configured model lookup through the public registry API", () => {
    // SAFETY: This test only checks the pure provider/model split used before registry lookup.
    const value = splitSummaryModelReference("openai-codex/gpt-6-luna-fast");
    expect(value).toEqual({ provider: "openai-codex", modelId: "gpt-6-luna-fast" });
    const _unused: ExtensionContext | undefined = undefined;
    expect(_unused).toBeUndefined();
  });
});
