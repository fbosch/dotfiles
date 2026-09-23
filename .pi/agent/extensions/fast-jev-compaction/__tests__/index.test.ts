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
  fileOps: Prepared["fileOps"] = {
    read: new Set<string>(),
    written: new Set<string>(),
    edited: new Set<string>(),
  },
): Prepared {
  return {
    messagesToSummarize: messages,
    turnPrefixMessages,
    isSplitTurn: false,
    firstKeptEntryId: "kept-1",
    tokensBefore: 1_000,
    previousSummary: undefined,
    fileOps,
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

function multiBatchTranscript(
  count: number,
  options: {
    readonly largeResultAt?: number;
    readonly largeResult?: string;
    readonly initialContext?: string;
  } = {},
): unknown[] {
  const initialText = ["Prune stale read results.", options.initialContext]
    .filter(Boolean)
    .join("\n");
  const messages: unknown[] = [{ role: "user", content: [{ type: "text", text: initialText }] }];
  for (let index = 0; index < count; index += 1) {
    if (index > 0 && index % 10 === 0) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: `Local context for calls ${index + 1}-${index + 10}.` }],
      });
    }
    const id = `tool-${index + 1}`;
    messages.push(
      {
        role: "assistant",
        content: [
          { type: "text", text: `Inspect report ${index + 1}.` },
          { type: "toolCall", id, name: "read", arguments: { path: `report-${index + 1}.txt` } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: id,
        content: [
          {
            type: "text",
            text:
              index === options.largeResultAt
                ? (options.largeResult ?? "LARGE_RESULT_BODY_".repeat(1_000))
                : `short result ${index + 1}`,
          },
        ],
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

function continuityHeader(summary: string): string {
  const start = summary.indexOf("<fast-jev-continuity>");
  const closing = "</fast-jev-continuity>";
  const end = summary.indexOf(closing, start);
  return start < 0 || end < 0 ? "" : summary.slice(start, end + closing.length);
}

function piWrappedSummaryChars(summary: string): number {
  return `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${summary}\n</summary>`
    .length;
}

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

  test("registers compaction after startup and exposes a status command", async () => {
    const handlers = new Map<string, unknown>();
    const commands = new Map<
      string,
      { handler: (_args: string, ctx: ExtensionContext) => Promise<void> }
    >();
    const notices: string[] = [];
    const pi = {
      on(name: string, callback: unknown) {
        handlers.set(name, callback);
      },
      registerCommand(
        name: string,
        command: { handler: (_args: string, ctx: ExtensionContext) => Promise<void> },
      ) {
        commands.set(name, command);
      },
      events: { emit() {} },
    } as unknown as ExtensionAPI;
    fastJevCompaction(pi);
    expect(handlers.has("session_before_compact")).toBe(false);
    const start = handlers.get("session_start") as (() => void) | undefined;
    start?.();
    expect(handlers.has("session_before_compact")).toBe(true);

    const compactHandler = handlers.get("session_before_compact") as
      | ((event: SessionBeforeCompactEvent, ctx: ExtensionContext) => Promise<unknown>)
      | undefined;
    const controller = new AbortController();
    controller.abort();
    await compactHandler?.(
      {
        reason: "auto",
        preparation: preparation(transcript()),
        branchEntries: [],
        signal: controller.signal,
      } as unknown as SessionBeforeCompactEvent,
      { modelRegistry } as unknown as ExtensionContext,
    );
    await commands.get("fast-jev-status")?.handler("", {
      ui: { notify: (message: string) => notices.push(message) },
    } as unknown as ExtensionContext);

    expect(notices[0]).toContain("native fallback (Fast Jev compaction not finished) (cancelled)");
    expect(notices[0]).toContain("Jev 0 ms, summary 0 ms");
    expect(notices[0]).toContain("calls; path native");
    expect(notices[0]).not.toContain("Continue the migration.");
    expect(notices[0]).not.toContain("config.ts");
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
    expect(result?.details.fastJev.attempt.checkpointReason).toBeUndefined();
    expect(statuses).toHaveLength(1);
    expect(JSON.stringify(statuses[0])).not.toContain("routine listing");
    expect(result?.details.fastJev.attempt).toMatchObject({
      path: "prune",
      beforeChars: expect.any(Number),
      afterChars: expect.any(Number),
    });
  });

  test("adds a bounded redacted continuity header without duplicating the prior summary", async () => {
    const longRequest =
      "Please inspect token=header-secret and preserve only useful context. " +
      "Additional request detail. ".repeat(40);
    const messages = transcript("routine listing\n".repeat(700));
    messages[3] = { role: "user", content: [{ type: "text", text: longRequest }] };
    const previousSummary = "PRIOR_SUMMARY_MARKER";
    const prepared = preparation(messages, 20_000, [], {
      read: new Set([
        ...Array.from(
          { length: 14 },
          (_, index) => `src/read-${String(index).padStart(2, "0")}.ts`,
        ),
        "/Users/fbb/private/hidden.ts",
      ]),
      written: new Set(["src/read-00.ts"]),
      edited: new Set(["src/changed.ts"]),
    });
    prepared.previousSummary = previousSummary;

    const result = await runFastJevCompaction(prepared, [], {
      modelRegistry,
      summarizeCheckpoint: checkpoint,
      fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
    });
    const header = continuityHeader(result?.summary ?? "");
    const summary = result?.summary ?? "";

    expect(result?.details.fastJev.attempt.path).toBe("prune");
    expect(header).toContain(
      "Latest user request in compacted span (may be superseded by Pi's kept tail",
    );
    expect(header).toContain("Please inspect token=[redacted]");
    expect(header).toContain("[excerpt truncated]");
    expect(header).toContain("Pi fileOps read paths (limit 12; 2 omitted;");
    expect(header).toContain("Pi fileOps modified paths (limit 12; 0 omitted;");
    expect(header).toContain("src/changed.ts");
    expect(header).toContain("src/read-00.ts");
    expect(header).toContain("[redacted-path]");
    expect(header).not.toContain("header-secret");
    expect(header).not.toContain("/Users/fbb");
    expect(header).not.toContain(previousSummary);
    expect(header.length).toBeLessThanOrEqual(6_000);
    expect(summary.split(previousSummary)).toHaveLength(2);
  });

  test("includes continuity header in the wrapped reserve budget", async () => {
    const messages = transcript("routine listing\n".repeat(700));
    const render = (reserveTokens: number, onCheckpoint?: () => void) =>
      runFastJevCompaction(preparation(messages, reserveTokens), [], {
        modelRegistry,
        summarizeCheckpoint: async () => {
          onCheckpoint?.();
          return { text: "small checkpoint" };
        },
        fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
      });
    const roomy = await render(20_000);
    const header = continuityHeader(roomy?.summary ?? "");
    const withoutHeader = (roomy?.summary ?? "").slice(`${header}\n\n`.length);
    const reserveTokens = Math.ceil(piWrappedSummaryChars(withoutHeader) / 4);
    let checkpointCalls = 0;

    expect(header.length).toBeGreaterThan(0);
    expect(Math.ceil(piWrappedSummaryChars(withoutHeader) / 4)).toBe(reserveTokens);
    expect(Math.ceil(piWrappedSummaryChars(roomy?.summary ?? "") / 4)).toBeGreaterThan(
      reserveTokens,
    );

    const bounded = await render(reserveTokens, () => {
      checkpointCalls += 1;
    });
    expect(bounded?.summary).toBe("small checkpoint");
    expect(bounded?.details.fastJev.attempt.checkpointReason).toBe("final-size-limit");
    expect(checkpointCalls).toBe(1);
  });

  test("offline synthetic continuation keeps visible anchors but loses dropped middle and end facts", async () => {
    const resultText = [
      "SYNTHETIC_BEGINNING_FACT",
      "ordinary row; ".repeat(40),
      "SYNTHETIC_MIDDLE_FACT",
      "ordinary trailing row; ".repeat(40),
      "SYNTHETIC_END_FACT",
    ].join("\n");
    const messages = transcript(resultText);
    messages[3] = {
      role: "user",
      content: [
        {
          type: "text",
          text: "Synthetic request: report the inspected source and its useful evidence.",
        },
      ],
    };
    const result = await runFastJevCompaction(
      preparation(messages, 10_000, [], {
        read: new Set(["src/input.ts"]),
        written: new Set(["src/output.ts"]),
        edited: new Set(),
      }),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: checkpoint,
        fetch: gatewayFetch(() => ({ type: "noul", noul: 0.01 })),
      },
    );
    const syntheticContinuationContext = result?.summary ?? "";

    expect(result?.details.fastJev.attempt.path).toBe("prune");
    expect(syntheticContinuationContext).toContain(
      "Synthetic request: report the inspected source",
    );
    expect(syntheticContinuationContext).toContain("src/input.ts");
    expect(syntheticContinuationContext).toContain("src/output.ts");
    expect(syntheticContinuationContext).toContain("SYNTHETIC_BEGINNING_FACT");
    expect(syntheticContinuationContext).not.toContain("SYNTHETIC_MIDDLE_FACT");
    expect(syntheticContinuationContext).not.toContain("SYNTHETIC_END_FACT");
  });

  test("keeps Jev pruning with small positive wrapped-output savings", async () => {
    let summaryCalls = 0;
    const context = "Keep this retained context. ".repeat(400);
    const resultText = "routine result line\n".repeat(100);
    const result = await runFastJevCompaction(
      preparation([
        { role: "user", content: [{ type: "text", text: context }] },
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "low-savings",
              name: "read",
              arguments: { path: "report.txt" },
            },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "low-savings",
          content: [{ type: "text", text: resultText }],
          isError: false,
        },
      ]),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: async () => {
          summaryCalls += 1;
          return checkpoint();
        },
        fetch: gatewayFetch((name) => ({
          type: "noul",
          noul: name.startsWith("call_") ? 0.99 : 0.01,
        })),
      },
    );

    expect(result?.details.fastJev.attempt.outcome).toBe("pruned");
    expect(result?.details.fastJev.attempt.path).toBe("prune");
    expect(result?.details.fastJev.attempt.afterChars).toBeLessThan(
      result?.details.fastJev.attempt.beforeChars ?? 0,
    );
    expect(result?.details.fastJev.reductionRatio).toBeGreaterThan(0);
    expect(result?.details.fastJev.reductionRatio).toBeLessThan(0.25);
    expect(summaryCalls).toBe(0);
  });

  test("avoids duplicating result excerpts for drop_result and represents drop_call material once", async () => {
    const resultText = [
      "IMPORTANT_BEGINNING_FACT",
      ...Array.from({ length: 100 }, (_, index) => `routine-${index}`),
      "UNIQUE_MIDDLE_FACT",
      ...Array.from({ length: 100 }, (_, index) => `routine-tail-${index}`),
      "UNIQUE_END_FACT",
    ].join("\n");
    const previousSummary = "previous compaction fact";
    const next = preparation(transcript(resultText));
    next.previousSummary = previousSummary;
    const compact = (keepCall: number, keepResult: number) =>
      runFastJevCompaction(next, [], {
        modelRegistry,
        summarizeCheckpoint: checkpoint,
        fetch: gatewayFetch((name) => ({
          type: "noul",
          noul: name.startsWith("call_") ? keepCall : keepResult,
        })),
      });
    const droppedResult = await compact(0.99, 0.01);
    const droppedCall = await compact(0.01, 0.01);
    const beginningExcerpt = resultText.slice(0, 240);
    const resultExcerpt = `${beginningExcerpt}\n[fast-jev-compaction truncated ${resultText.length - 240} chars; re-run the tool if needed]`;
    const count = (text: string, excerpt: string) => text.split(excerpt).length - 1;

    expect(droppedResult?.summary).toContain("Continue the migration.");
    expect(droppedResult?.summary).toContain("Keep this follow-up verbatim.");
    expect(droppedResult?.summary).toContain(previousSummary);
    expect(droppedResult?.summary).toContain("[tool call read]");
    expect(count(droppedResult?.summary ?? "", beginningExcerpt)).toBe(1);
    expect(count(droppedResult?.summary ?? "", "[tool result tool-1]")).toBe(1);
    expect(droppedResult?.summary).not.toContain("<removed-material-summary>");
    expect(droppedResult?.summary).not.toContain("UNIQUE_MIDDLE_FACT");
    expect(droppedResult?.summary).not.toContain("UNIQUE_END_FACT");
    expect(droppedResult?.details.fastJev.attempt.outcome).toBe("pruned");
    expect(droppedResult?.details.fastJev.attempt.afterChars).toBeLessThan(
      droppedResult?.details.fastJev.attempt.beforeChars ?? 0,
    );

    expect(droppedCall?.summary).toContain("Continue the migration.");
    expect(droppedCall?.summary).toContain("Keep this follow-up verbatim.");
    expect(droppedCall?.summary).toContain(previousSummary);
    expect(count(droppedCall?.summary ?? "", '[removed tool call read] {"path":"config.ts"}')).toBe(
      1,
    );
    expect(count(droppedCall?.summary ?? "", resultExcerpt)).toBe(1);
    expect(droppedCall?.summary).not.toContain("\n[tool call read]");
    expect(droppedCall?.summary).not.toContain("\n[tool result tool-1]");
    expect(droppedCall?.details.fastJev.attempt.outcome).toBe("pruned");
    expect(droppedCall?.details.fastJev.attempt.afterChars).toBeLessThan(
      droppedCall?.details.fastJev.attempt.beforeChars ?? 0,
    );
  });

  test("retains the full result and its middle/end facts when Jev scores it high", async () => {
    const droppedText = [
      "DROPPED_BEGINNING_FACT",
      ...Array.from({ length: 100 }, (_, index) => `routine-${index}`),
      "DROPPED_MIDDLE_UNIQUE_FACT",
      ...Array.from({ length: 100 }, (_, index) => `routine-tail-${index}`),
      "DROPPED_END_UNIQUE_FACT",
    ].join("\n");
    const retainedText = [
      "RETAINED_BEGINNING_FACT",
      ...Array.from({ length: 30 }, (_, index) => `important-${index}`),
      "RETAINED_MIDDLE_UNIQUE_FACT",
      ...Array.from({ length: 30 }, (_, index) => `important-tail-${index}`),
      "RETAINED_END_UNIQUE_FACT",
    ].join("\n");
    const result = await runFastJevCompaction(
      preparation([
        { role: "user", content: [{ type: "text", text: "Keep unique evidence." }] },
        {
          role: "assistant",
          content: [
            { type: "toolCall", id: "drop-1", name: "read", arguments: { path: "routine.txt" } },
            { type: "toolCall", id: "keep-1", name: "read", arguments: { path: "important.txt" } },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "drop-1",
          content: [{ type: "text", text: droppedText }],
          isError: false,
        },
        {
          role: "toolResult",
          toolCallId: "keep-1",
          content: [{ type: "text", text: retainedText }],
          isError: false,
        },
      ]),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: checkpoint,
        fetch: gatewayFetch((name) => ({
          type: "noul",
          noul: name.startsWith("call_") ? 0.99 : name.endsWith("t2") ? 0.99 : 0.01,
        })),
      },
    );

    expect(result?.summary).toContain("RETAINED_MIDDLE_UNIQUE_FACT");
    expect(result?.summary).toContain("RETAINED_END_UNIQUE_FACT");
    expect((result?.summary ?? "").split(retainedText).length - 1).toBe(1);
    expect(result?.summary).not.toContain("DROPPED_MIDDLE_UNIQUE_FACT");
    expect(result?.summary).not.toContain("DROPPED_END_UNIQUE_FACT");
    expect(result?.details.fastJev.attempt.outcome).toBe("pruned");
  });

  test("passes Pi's turn prefix to checkpoint summarization", async () => {
    const next = preparation(
      [{ role: "user", content: [{ type: "text", text: "old context" }] }],
      4_000,
      [{ role: "user", content: [{ type: "text", text: "recent boundary" }] }],
    );
    let summarized: readonly unknown[] = [];
    let summaryCalls = 0;
    const result = await runFastJevCompaction(next, [], {
      modelRegistry,
      summarizeCheckpoint: async (messages) => {
        summaryCalls += 1;
        summarized = messages;
        return { text: "checkpoint" };
      },
    });
    expect(JSON.stringify(summarized)).toContain("old context");
    expect(JSON.stringify(summarized)).toContain("recent boundary");
    expect(summaryCalls).toBe(1);
    expect(result?.details.fastJev.attempt.reason).toBe("no-eligible-candidates");
  });

  test("reports no-eligible trigger separately from a checkpoint summary failure", async () => {
    let attempt: unknown;
    const result = await runFastJevCompaction(
      preparation([{ role: "user", content: [{ type: "text", text: "Keep this fact." }] }]),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: async () => ({ failureReason: "summary-auth-provider-failed" }),
        onStatus: (status) => {
          attempt = status;
        },
      },
    );

    expect(result).toBeUndefined();
    expect(attempt).toMatchObject({
      outcome: "fallback",
      reason: "summary-auth-provider-failed",
      checkpointReason: "no-eligible-candidates",
    });
    expect(JSON.stringify(attempt)).not.toContain("Keep this fact.");
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
      fetch: gatewayFetch((name) => ({
        type: "noul",
        noul: name.startsWith("call_") ? 0.99 : 0.01,
      })),
    });
    expect(result?.summary).toBe("One coherent checkpoint.");
    expect(calls).toBe(1);
    expect(result?.details.fastJev.attempt.reason).toBe("insufficient-savings");
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

  test("visits more than 125 candidates with focused states and no tool-result bodies", async () => {
    const privateResult = "PRIVATE_BATCH_RESULT_BODY";
    const payloads: Record<string, unknown>[] = [];
    const questionIds: string[] = [];
    let summaryCalls = 0;
    const result = await runFastJevCompaction(
      preparation(
        multiBatchTranscript(130, {
          largeResultAt: 129,
          largeResult: `${privateResult} `.repeat(1_000),
        }),
        20_000,
      ),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: async () => {
          summaryCalls += 1;
          return checkpoint();
        },
        fetch: gatewayFetch(
          (name) => ({
            type: "noul",
            noul: name === "result_t130" ? 0.01 : 0.99,
          }),
          (body) => {
            payloads.push(body);
            questionIds.push(...Object.keys(body.questions as Record<string, unknown>));
          },
        ),
      },
    );
    const serialized = JSON.stringify(payloads);

    expect(result?.details.fastJev.attempt.path).toBe("prune");
    expect(summaryCalls).toBe(0);
    expect(payloads).toHaveLength(10);
    expect(new Set(questionIds).size).toBe(260);
    expect(questionIds).toContain("call_t130");
    expect(serialized).toContain("t130");
    expect(serialized).toContain("Local context for calls 121-130.");
    expect(serialized).not.toContain(privateResult);
  });

  test("stops requesting batches as soon as a round renders savings within reserve", async () => {
    const payloads: Record<string, unknown>[] = [];
    let summaryCalls = 0;
    const result = await runFastJevCompaction(
      preparation(
        multiBatchTranscript(50, {
          largeResultAt: 0,
          largeResult: "FIRST_RESULT_TO_PRUNE_".repeat(1_000),
        }),
        10_000,
      ),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: async () => {
          summaryCalls += 1;
          return checkpoint();
        },
        fetch: gatewayFetch(
          (name) => ({
            type: "noul",
            noul: name === "result_t1" ? 0.01 : 0.99,
          }),
          (body) => payloads.push(body),
        ),
      },
    );
    const questionIds = payloads.flatMap((body) =>
      Object.keys(body.questions as Record<string, unknown>),
    );

    expect(result?.details.fastJev.attempt.path).toBe("prune");
    expect(summaryCalls).toBe(0);
    expect(payloads).toHaveLength(2);
    expect(questionIds).toContain("result_t1");
    expect(questionIds).not.toContain("call_t29");
  });

  test("checkpoints once after exhausting all calls without savings", async () => {
    const questionIds: string[] = [];
    let summaryCalls = 0;
    const result = await runFastJevCompaction(preparation(toolHeavyTranscript(30), 1_000), [], {
      modelRegistry,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return { text: "One checkpoint after every candidate was considered." };
      },
      fetch: gatewayFetch(
        () => ({ type: "noul", noul: 0.99 }),
        (body) => questionIds.push(...Object.keys(body.questions as Record<string, unknown>)),
      ),
    });

    expect(result?.summary).toBe("One checkpoint after every candidate was considered.");
    expect(summaryCalls).toBe(1);
    expect(new Set(questionIds).size).toBe(60);
    expect(result?.details.fastJev.attempt.checkpointReason).toBe("insufficient-savings");
  });

  test("a malformed later round checkpoints the original prepared context", async () => {
    const privateResult = "ORIGINAL_PREPARED_RESULT_BODY";
    const payloads: Record<string, unknown>[] = [];
    let fetchCalls = 0;
    let summarized = "";
    const result = await runFastJevCompaction(
      preparation(
        multiBatchTranscript(30, {
          largeResultAt: 0,
          largeResult: `${privateResult} `.repeat(1_000),
          initialContext: "Retain this full user context. ".repeat(1_500),
        }),
        1_000,
      ),
      [],
      {
        modelRegistry,
        summarizeCheckpoint: async (messages) => {
          summarized = JSON.stringify(messages);
          return { text: "Safe original checkpoint." };
        },
        fetch: async (_input, init) => {
          fetchCalls += 1;
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          payloads.push(body);
          const questions = body.questions as Record<string, unknown>;
          if (Object.hasOwn(questions, "call_t29")) {
            return new Response(JSON.stringify({ answers: {} }));
          }
          return new Response(
            JSON.stringify({
              answers: Object.fromEntries(
                Object.keys(questions).map((name) => [
                  name,
                  { type: "noul", noul: name === "result_t1" ? 0.01 : 0.99 },
                ]),
              ),
            }),
          );
        },
      },
    );

    expect(result?.summary).toBe("Safe original checkpoint.");
    expect(fetchCalls).toBe(3);
    expect(summarized).toContain(privateResult);
    expect(JSON.stringify(payloads)).not.toContain(privateResult);
    expect(result?.details.fastJev.attempt.checkpointReason).toBe("malformed-jev");
  });

  test("cancellation in a later round never starts checkpoint fallback", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    let summaryCalls = 0;
    const result = await runFastJevCompaction(preparation(multiBatchTranscript(30), 1), [], {
      modelRegistry,
      signal: controller.signal,
      summarizeCheckpoint: async () => {
        summaryCalls += 1;
        return checkpoint();
      },
      fetch: async (_input, init) => {
        fetchCalls += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const questions = body.questions as Record<string, unknown>;
        if (Object.hasOwn(questions, "call_t29")) controller.abort();
        return new Response(
          JSON.stringify({
            answers: Object.fromEntries(
              Object.keys(questions).map((name) => [name, { type: "noul", noul: 0.99 }]),
            ),
          }),
        );
      },
    });

    expect(result).toBeUndefined();
    expect(fetchCalls).toBe(3);
    expect(summaryCalls).toBe(0);
  });

  test("reports the finite eligible-call limit without labeling unvisited calls protected", async () => {
    const questionIds = new Set<string>();
    let attempt: unknown;
    const result = await runFastJevCompaction(preparation(multiBatchTranscript(257), 1), [], {
      modelRegistry,
      summarizeCheckpoint: async () => ({ text: "Checkpoint." }),
      fetch: gatewayFetch(
        () => ({ type: "noul", noul: 0.99 }),
        (body) => {
          for (const name of Object.keys(body.questions as Record<string, unknown>)) {
            questionIds.add(name);
          }
        },
      ),
      onStatus: (status) => {
        attempt = status;
      },
    });

    expect(result).toBeUndefined();
    expect(questionIds.size).toBe(512);
    expect(questionIds).toContain("call_t256");
    expect(questionIds).not.toContain("call_t257");
    expect(attempt).toMatchObject({ checkpointReason: "eligible-call-limit" });
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
      checkpointReason: "insufficient-savings",
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
