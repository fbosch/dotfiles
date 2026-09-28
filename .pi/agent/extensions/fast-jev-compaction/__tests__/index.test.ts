import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import type { JevGatewayFetch } from "../../../lib/jev-gateway";
import fastJevCompaction, {
  type FastJevAttemptStatus,
  type FastJevResult,
  type FastJevRunOptions,
  type FastJevRunOutcome,
  notifyFastJevRefusal,
  parseNoulAnswers,
  resolveFastJevCompactionConfig,
  runFastJevCompaction,
  toFastJevMessages,
  toPiCompactionResponse,
} from "../index";

const modelRegistry = {
  getProviderAuth: async () => ({ auth: { apiKey: "test-key" } }),
} as unknown as FastJevRunOptions["modelRegistry"];
const missingCredentialsRegistry = {
  getProviderAuth: async () => undefined,
} as unknown as FastJevRunOptions["modelRegistry"];

type Prepared = SessionBeforeCompactEvent["preparation"];
type Candidate = {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly source_range: readonly number[];
  readonly text: string;
};

function preparation(
  messages: readonly unknown[],
  reserveTokens = 5_000,
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
    isSplitTurn: turnPrefixMessages.length > 0,
    firstKeptEntryId: "kept-entry",
    tokensBefore: 50_000,
    previousSummary: undefined,
    fileOps,
    settings: { enabled: true, reserveTokens, keepRecentTokens: 20_000 },
  } as unknown as Prepared;
}

function toolTranscript(result: string, id = "read-1"): unknown[] {
  return [
    { role: "user", content: [{ type: "text", text: "Retain the migration requirements." }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect the source." },
        { type: "toolCall", id, name: "read", arguments: { path: "src/input.ts" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: id,
      content: [{ type: "text", text: result }],
      isError: false,
    },
  ];
}

function gatewayFetch(
  retain: (candidate: Candidate) => number,
  onBody?: (body: Record<string, unknown>) => void,
): JevGatewayFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    onBody?.(body);
    const questions = body.questions as Record<string, unknown>;
    const state = body.state as { readonly candidates: readonly Candidate[] };
    const byId = new Map(
      state.candidates.map((candidate) => [`retain_${candidate.id}`, candidate]),
    );
    const answers = Object.fromEntries(
      Object.keys(questions).map((name) => [
        name,
        { type: "noul", noul: byId.has(name) ? retain(byId.get(name)!) : 0.01 },
      ]),
    );
    return new Response(JSON.stringify({ answers }));
  };
}

const fastOptions = (
  fetch: JevGatewayFetch,
  onStatus?: (status: unknown) => void,
  registry: FastJevRunOptions["modelRegistry"] = modelRegistry,
): FastJevRunOptions => ({
  modelRegistry: registry,
  fetch,
  ...(onStatus === undefined ? {} : { onStatus }),
});

function compacted(outcome: FastJevRunOutcome): FastJevResult {
  if (outcome.kind !== "success")
    throw new Error(`expected compaction success, got ${outcome.kind}`);
  return outcome.result;
}

function expectNativeFallback(outcome: FastJevRunOutcome, reason: string): void {
  expect(outcome.kind).toBe("unavailable");
  if (outcome.kind !== "unavailable")
    throw new Error(`expected native fallback, got ${outcome.kind}`);
  expect(outcome.status).toMatchObject({
    version: 3,
    outcome: "native-fallback",
    path: "native",
    reason,
  });
  expect(toPiCompactionResponse(outcome)).toBeUndefined();
}

function expectRefused(outcome: FastJevRunOutcome, reason: string): void {
  expect(outcome.kind).toBe("refused");
  if (outcome.kind !== "refused") throw new Error(`expected refusal, got ${outcome.kind}`);
  expect(outcome.status).toMatchObject({
    version: 3,
    outcome: "native-fallback",
    path: "native",
    reason,
  });
  expect(toPiCompactionResponse(outcome)).toBeUndefined();
}

function expectCancelled(outcome: FastJevRunOutcome, reason: string): void {
  expect(outcome.kind).toBe("cancelled");
  if (outcome.kind !== "cancelled") throw new Error(`expected cancellation, got ${outcome.kind}`);
  expect(outcome.status).toMatchObject({ version: 3, outcome: "cancelled", path: "none", reason });
  expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
}

describe("fast-jev-compaction", () => {
  test("reads only global enablement and ignores the obsolete summaryModel setting", () => {
    expect(resolveFastJevCompactionConfig(undefined)).toEqual({ enabled: false });
    expect(resolveFastJevCompactionConfig({ compaction: { enabled: true } })).toEqual({
      enabled: false,
    });
    expect(
      resolveFastJevCompactionConfig({
        jev: { compaction: { enabled: true, summaryModel: "openai-codex/old-model" } },
      }),
    ).toEqual({ enabled: true });
    expect(resolveFastJevCompactionConfig({ jev: { compaction: { enabled: false } } })).toEqual({
      enabled: false,
    });
  });

  test("copies Pi message variants without mutating the transcript", () => {
    const source = [
      { role: "bashExecution", command: "git status", output: " M file.ts", exitCode: 0 },
      { role: "branchSummary", summary: "The abandoned branch changed the API." },
      { role: "compactionSummary", summary: "The earlier context established the target." },
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } }],
      },
      { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "result" }] },
    ];
    const before = structuredClone(source);
    const copied = toFastJevMessages(source);
    expect(copied.map((message) => message.text).join("\n")).toContain("git status");
    expect(copied.map((message) => message.text).join("\n")).toContain("abandoned branch");
    expect(copied.map((message) => message.text).join("\n")).toContain("earlier context");
    expect(copied.flatMap((message) => message.toolCalls)).toHaveLength(1);
    expect(copied.flatMap((message) => message.toolResults)[0]?.text).toBe("result");
    expect(source).toEqual(before);
  });

  test("validates typed Jev answers exactly and keeps the threshold boundary", () => {
    expect(parseNoulAnswers({}, ["retain_s1"])).toBeUndefined();
    expect(
      parseNoulAnswers({ answers: { retain_s1: { type: "noul", noul: 1.01 } } }, ["retain_s1"]),
    ).toBeUndefined();
    expect(
      parseNoulAnswers(
        {
          answers: {
            retain_s1: { type: "noul", noul: 0.7 },
            extra: { type: "noul", noul: 0.1 },
          },
        },
        ["retain_s1"],
      ),
    ).toBeUndefined();
    expect(
      parseNoulAnswers({ answers: { retain_s1: { type: "noul", noul: 0.7 } } }, ["retain_s1"]),
    ).toEqual({ retain_s1: 0.7 });
  });

  test("flattens repeated v3 summaries without nesting prior source spans", async () => {
    const removableNoise = "REMOVABLE_NOISE ".repeat(700);
    const compact = (fact: string) =>
      runFastJevCompaction(
        preparation(toolTranscript(`${removableNoise}\n${fact}`)),
        [],
        fastOptions(gatewayFetch((candidate) => (candidate.text.includes(fact) ? 0.99 : 0.01))),
      );
    const first = compacted(await compact("FIRST_COMPACTION_SOURCE_FACT"));

    const secondPrepared = {
      ...preparation(toolTranscript(`${removableNoise}\nSECOND_COMPACTION_SOURCE_FACT`)),
      previousSummary: first.summary,
    };
    const second = compacted(
      await runFastJevCompaction(
        secondPrepared,
        [],
        fastOptions(
          gatewayFetch((candidate) =>
            candidate.text.includes("SECOND_COMPACTION_SOURCE_FACT") ? 0.99 : 0.01,
          ),
        ),
      ),
    );

    const thirdPrepared = {
      ...preparation(toolTranscript(`${removableNoise}\nTHIRD_COMPACTION_SOURCE_FACT`)),
      previousSummary: second.summary,
    };
    const third = compacted(
      await runFastJevCompaction(
        thirdPrepared,
        [],
        fastOptions(
          gatewayFetch((candidate) =>
            candidate.text.includes("THIRD_COMPACTION_SOURCE_FACT") ? 0.99 : 0.01,
          ),
        ),
      ),
    );

    for (const fact of [
      "FIRST_COMPACTION_SOURCE_FACT",
      "SECOND_COMPACTION_SOURCE_FACT",
      "THIRD_COMPACTION_SOURCE_FACT",
    ]) {
      expect(third.summary.split(fact)).toHaveLength(2);
    }
    expect(first.summary).not.toContain("REMOVABLE_NOISE");
    expect(second.summary).not.toContain("REMOVABLE_NOISE");
    expect(third.summary).not.toContain("REMOVABLE_NOISE");
    expect(third.summary).not.toContain('origin "prior compaction summary"');
    expect(third.summary.match(/<fast-jev-compaction>/gu)).toHaveLength(1);
    expect(third.summary.match(/<selected-source-spans>/gu)).toHaveLength(1);
    expect(third.summary.match(/\[source s\d+;/gu)).toHaveLength(
      new Set(third.summary.match(/\[source s\d+;/gu)).size,
    );
  });

  test("renders Jev-selected source with prior summary, user constraints, action outcomes, and provenance", async () => {
    const noisyRows = Array.from(
      { length: 250 },
      (_, index) => `row-${String(index).padStart(4, "0")}: ${"routine output ".repeat(5)}`,
    ).join("\n");
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "HARD_USER_CONSTRAINT: preserve the migration API." }],
      },
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will write the change and inspect the source." },
          { type: "toolCall", id: "write-1", name: "write", arguments: { path: "src/output.ts" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "write-1",
        content: [{ type: "text", text: "WRITE_ACTION_OUTCOME: src/output.ts was updated." }],
        isError: false,
      },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "read-1",
            name: "read",
            arguments: { path: "/Users/fbb/private/config.ts", token: "tool-secret" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "read-1",
        content: [{ type: "text", text: `token=jev-secret\n${noisyRows}` }],
        isError: false,
      },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "failed-1", name: "read", arguments: { path: "missing" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "failed-1",
        content: [{ type: "text", text: "ERROR_ACTION_OUTCOME: source file was missing." }],
        isError: true,
      },
    ];
    const observedBodies: Record<string, unknown>[] = [];
    const previousSummary = "PRIOR_SUMMARY_MARKER: keep the established interface.";
    const prepared = preparation(
      messages,
      5_000,
      [{ role: "user", content: [{ type: "text", text: "SPLIT_TURN_PREFIX_MARKER" }] }],
      {
        read: new Set(["src/input.ts"]),
        written: new Set(["src/output.ts"]),
        edited: new Set<string>(),
      },
    );
    const result = compacted(
      await runFastJevCompaction(
        prepared,
        [
          {
            type: "compaction",
            summary: previousSummary,
            details: { fastJev: { version: 1, messages: [] } },
          },
        ],
        fastOptions(
          gatewayFetch(
            (candidate) =>
              candidate.kind === "tool-result" &&
              candidate.source.includes("read-1") &&
              candidate.source_range[0] === 0
                ? 0.99
                : 0.01,
            (body) => observedBodies.push(body),
          ),
        ),
      ),
    );
    const summary = result.summary;
    const serializedRequests = JSON.stringify(observedBodies);

    expect(result.firstKeptEntryId).toBe("kept-entry");
    expect(result.details.fastJev.version).toBe(3);
    expect(summary).toContain("kind prior-summary");
    expect(summary.split("PRIOR_SUMMARY_MARKER")).toHaveLength(2);
    expect(summary).toContain("HARD_USER_CONSTRAINT");
    expect(summary).toContain("SPLIT_TURN_PREFIX_MARKER");
    expect(summary).toContain("WRITE_ACTION_OUTCOME");
    expect(summary).toContain("ERROR_ACTION_OUTCOME");
    expect(summary).toContain("call from prepared message");
    expect(summary).toContain('tool call "read-1"');
    expect(result.details.fastJev.selectedSpans).toContainEqual(
      expect.objectContaining({ toolCallId: "read-1", toolCallPart: "call" }),
    );
    expect(result.details.fastJev.selectedSpans).toContainEqual(
      expect.objectContaining({ toolCallId: "failed-1", toolCallPart: "call" }),
    );
    expect(summary).toContain('"src/input.ts"');
    expect(summary).toContain('"src/output.ts"');
    expect(summary).toContain("row-0000");
    expect(summary).not.toContain("row-0249");
    expect(summary).not.toContain("TAIL_NOT_IN_PREPARATION");
    expect(summary).not.toContain("jev-secret");
    expect(summary).not.toContain("tool-secret");
    expect(summary).not.toContain("/Users/fbb");
    expect(serializedRequests).not.toContain("jev-secret");
    expect(serializedRequests).not.toContain("tool-secret");
    expect(serializedRequests).not.toContain("/Users/fbb");
    expect(observedBodies.length).toBeGreaterThan(0);
    expect(result.details.fastJev.attempt.outcome).toBe("compacted");
  });

  test("redacts escaped JSON credentials in calls and results without dropping sibling fields", async () => {
    const escapedCredential = 'prefix"SECRET_SUFFIX';
    const output = JSON.stringify({
      token: escapedCredential,
      unrelated: "OUTPUT_SIBLING",
      padding: "routine output ".repeat(350),
    });
    const messages = [
      { role: "user", content: [{ type: "text", text: "Keep useful sibling data." }] },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "escaped-token-call",
            name: "read",
            arguments: { token: escapedCredential, unrelated: "ARGUMENT_SIBLING" },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "escaped-token-call",
        content: [{ type: "text", text: output }],
        isError: false,
      },
      { role: "assistant", content: [{ type: "text", text: "discarded noise ".repeat(1_500) }] },
    ];
    const bodies: Record<string, unknown>[] = [];
    const result = compacted(
      await runFastJevCompaction(
        preparation(messages),
        [],
        fastOptions(
          gatewayFetch(
            (candidate) =>
              candidate.kind === "tool-call" || candidate.kind === "tool-result" ? 0.99 : 0.01,
            (body) => bodies.push(body),
          ),
        ),
      ),
    );
    const requests = JSON.stringify(bodies);
    const summary = result.summary;

    expect(requests).not.toContain("SECRET_SUFFIX");
    expect(summary).not.toContain("SECRET_SUFFIX");
    expect(JSON.stringify(result.details)).not.toContain("SECRET_SUFFIX");
    expect(requests).toContain("ARGUMENT_SIBLING");
    expect(summary).toContain("OUTPUT_SIBLING");
  });

  test("keeps constraints from prior summaries with tampered headers or footers", async () => {
    const priorFact = "PRIOR_CANONICAL_FACT";
    const validPrior = [
      "<fast-jev-compaction>",
      "Selection-only continuation record. Source text is copied, not summarized or inferred.",
      "<selected-source-spans>",
      `[source s1; kind assistant; origin "prepared message 1 (assistant)"; range (sanitized UTF-16 code units after redaction and whitespace normalization) 0:${priorFact.length}]`,
      JSON.stringify(priorFact),
      "</selected-source-spans>",
      "Pi file operations (source: CompactionPreparation.fileOps):",
      "read: none",
      "modified: none",
      "</fast-jev-compaction>",
    ].join("\n");
    const tamperedSummaries = [
      validPrior.replace(
        "<fast-jev-compaction>\n",
        "<fast-jev-compaction>\nTAMPERED_HEADER_CONSTRAINT\n",
      ),
      validPrior.replace("modified: none", "modified: none\nTAMPERED_FOOTER_CONSTRAINT"),
    ];

    for (const [index, previousSummary] of tamperedSummaries.entries()) {
      const result = compacted(
        await runFastJevCompaction(
          {
            ...preparation([
              {
                role: "assistant",
                content: [{ type: "text", text: "routine output ".repeat(1_600) }],
              },
            ]),
            previousSummary,
          },
          [],
          fastOptions(gatewayFetch(() => 0.01)),
        ),
      );
      expect(result.summary).toContain(
        index === 0 ? "TAMPERED_HEADER_CONSTRAINT" : "TAMPERED_FOOTER_CONSTRAINT",
      );
      expect(result.summary).toContain(priorFact);
    }
  });

  test("redacts the full source before splitting and reports sanitized UTF-16 offsets", async () => {
    const rawResult = `${"x".repeat(696)} token=BOUNDARY_SECRET;${" detail".repeat(500)} END_MARK`;
    const sanitizedResult = `${"x".repeat(696)} token=[redacted];${" detail".repeat(500)} END_MARK`;
    const bodies: Record<string, unknown>[] = [];
    const result = compacted(
      await runFastJevCompaction(
        preparation(toolTranscript(rawResult)),
        [],
        fastOptions(
          gatewayFetch(
            (candidate) =>
              candidate.kind === "tool-result" && candidate.text.endsWith("END_MARK") ? 0.99 : 0.01,
            (body) => bodies.push(body),
          ),
        ),
      ),
    );
    const candidates = bodies.flatMap((body) => {
      const state = body.state as {
        readonly source_range_offset_basis: string;
        readonly candidates: Candidate[];
      };
      expect(state.source_range_offset_basis).toBe(
        "sanitized UTF-16 code units after redaction and whitespace normalization",
      );
      return state.candidates.filter(
        (candidate) => candidate.kind === "tool-result" && candidate.source.includes("read-1"),
      );
    });
    const ordered = candidates.sort(
      (left, right) => left.source_range[0]! - right.source_range[0]!,
    );
    let offset = 0;
    for (const candidate of ordered) {
      expect(candidate.source_range).toEqual([offset, offset + candidate.text.length]);
      expect(candidate.text.length).toBeLessThanOrEqual(700);
      offset += candidate.text.length;
    }
    expect(ordered.map((candidate) => candidate.text).join("")).toBe(sanitizedResult);
    expect(offset).toBe(sanitizedResult.length);
    expect(result.summary).toContain("END_MARK");
    expect(JSON.stringify(bodies)).not.toContain("BOUNDARY_SECRET");
    expect(result.summary).not.toContain("BOUNDARY_SECRET");
  });

  test("renders a selected sanitized span without slicing away its END_MARK", async () => {
    const rawResult = `token=x;${"a".repeat(683)}END_MARK`;
    const messages = [
      ...toolTranscript(rawResult),
      { role: "assistant", content: [{ type: "text", text: "discarded output ".repeat(600) }] },
    ];
    const bodies: Record<string, unknown>[] = [];
    const result = compacted(
      await runFastJevCompaction(
        preparation(messages),
        [],
        fastOptions(
          gatewayFetch(
            (candidate) =>
              candidate.kind === "tool-result" && candidate.source_range[0] === 700 ? 0.99 : 0.01,
            (body) => bodies.push(body),
          ),
        ),
      ),
    );
    const candidates = bodies.flatMap((body) => {
      const state = body.state as { readonly candidates: Candidate[] };
      return state.candidates;
    });
    expect(candidates.some((candidate) => candidate.text === "END_MARK")).toBe(true);
    expect(result.summary).toContain("END_MARK");
    expect(result.details.fastJev.selectedSpans).toContainEqual(
      expect.objectContaining({ toolCallId: "read-1", toolCallPart: "call" }),
    );
  });

  test("refuses atomically when a later Jev batch is malformed", async () => {
    const hugeResult = Array.from(
      { length: 40 },
      (_, index) => `line-${index};${" detail".repeat(90)}`,
    ).join(" ");
    const bodies: Record<string, unknown>[] = [];
    const statuses: unknown[] = [];
    let requests = 0;
    const fetch: JevGatewayFetch = async (_input, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (requests === 2) return new Response(JSON.stringify({ answers: {} }));
      const questions = body.questions as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          answers: Object.fromEntries(
            Object.keys(questions).map((name) => [name, { type: "noul", noul: 0.99 }]),
          ),
        }),
      );
    };
    const result = await runFastJevCompaction(
      preparation(toolTranscript(hugeResult)),
      [],
      fastOptions(fetch, (status) => statuses.push(status)),
    );
    expect(requests).toBe(2);
    expect(bodies).toHaveLength(2);
    expectRefused(result, "malformed-jev");
    expect(statuses[0]).toMatchObject({
      outcome: "native-fallback",
      path: "native",
      reason: "malformed-jev",
    });
    expect(toPiCompactionResponse(result)).toBeUndefined();
  });

  test("processes all windows beyond the former 256-span limit", async () => {
    const largeResult = Array.from({ length: 330 }, (_, index) => {
      if (index === 157) return "MID_WINDOW_FACT".padEnd(700, ".");
      if (index === 293) return "END_WINDOW_FACT".padEnd(700, ".");
      return `routine output ${index};`.padEnd(700, "x");
    }).join("");
    const sanitizedResult = largeResult;
    const bodies: Record<string, unknown>[] = [];
    const result = await runFastJevCompaction(
      preparation(toolTranscript(largeResult)),
      [],
      fastOptions(
        gatewayFetch(
          (candidate) =>
            candidate.text.includes("MID_WINDOW_FACT") || candidate.text.includes("END_WINDOW_FACT")
              ? 0.99
              : 0.01,
          (body) => bodies.push(body),
        ),
      ),
    );

    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    const spans = bodies
      .flatMap((body) => (body.state as { readonly candidates: Candidate[] }).candidates)
      .filter(
        (candidate) => candidate.kind === "tool-result" && candidate.source.includes("read-1"),
      )
      .sort((left, right) => left.source_range[0]! - right.source_range[0]!);
    expect(spans.length).toBeGreaterThan(256);
    let offset = 0;
    for (const span of spans) {
      expect(span.source_range).toEqual([offset, offset + span.text.length]);
      expect(span.text.length).toBeLessThanOrEqual(700);
      offset += span.text.length;
    }
    expect(offset).toBe(sanitizedResult.length);
    expect(spans.map((span) => span.text).join("")).toBe(sanitizedResult);
    expect(result.result.summary).toContain("MID_WINDOW_FACT");
    expect(result.result.summary).toContain("END_WINDOW_FACT");
    expect(result.result.summary).not.toContain("routine output");
    expect(result.result.details.fastJev.attempt.spans).toBeGreaterThan(256);
    expect(result.result.details.fastJev.attempt.requests).toBeGreaterThan(19);
    expect(result.result.details.fastJev.attempt.requests).toBeLessThanOrEqual(74);
  });

  test("refuses source beyond the hard span cap before making a Jev request", async () => {
    let requests = 0;
    const status: unknown[] = [];
    const result = await runFastJevCompaction(
      preparation([{ role: "user", content: [{ type: "text", text: "x".repeat(700 * 1_025) }] }]),
      [],
      fastOptions(
        async () => {
          requests += 1;
          return new Response("{}");
        },
        (attempt) => status.push(attempt),
      ),
    );
    expectRefused(result, "source-span-limit");
    expect(requests).toBe(0);
    expect(status[0]).toMatchObject({
      outcome: "native-fallback",
      path: "native",
      reason: "source-span-limit",
      spans: 1_024,
      requests: 0,
    });
  });

  test("refuses outputs that do not save enough or exceed the reserve estimate", async () => {
    const small = await runFastJevCompaction(
      preparation(toolTranscript("short result")),
      [],
      fastOptions(gatewayFetch(() => 0.01)),
    );
    expectRefused(small, "insufficient-savings");

    const large = await runFastJevCompaction(
      preparation(toolTranscript("routine line\n".repeat(1_000)), 10),
      [],
      fastOptions(gatewayFetch(() => 0.01)),
    );
    expectRefused(large, "final-size-limit");
  });

  test("uses native compaction when gateway credentials are missing", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(
        async () => {
          requests += 1;
          return new Response("{}");
        },
        undefined,
        missingCredentialsRegistry,
      ),
    );
    expectNativeFallback(outcome, "missing-credentials");
    expect(requests).toBe(0);
    if (outcome.kind === "unavailable") {
      expect(outcome.status.diagnostic).toMatchObject({
        stage: "auth",
        reason: "missing-credentials",
      });
    }
  });

  test("uses native compaction after gateway network failures", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(async () => {
        requests += 1;
        throw new Error("mock network failure");
      }),
    );
    expectNativeFallback(outcome, "request-failure");
    expect(requests).toBe(2);
    if (outcome.kind === "unavailable") {
      expect(outcome.status.diagnostic).toMatchObject({
        stage: "request",
        reason: "request-failure",
      });
    }
  });

  test("uses native compaction for gateway 503 responses", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(async () => {
        requests += 1;
        return new Response("service unavailable", { status: 503 });
      }),
    );
    expectNativeFallback(outcome, "http-status");
    expect(requests).toBe(2);
    if (outcome.kind === "unavailable") {
      expect(outcome.status.diagnostic).toMatchObject({
        stage: "request",
        reason: "http-status",
        httpStatus: 503,
      });
    }
  });

  test("uses native compaction when gateway requests time out", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions((_input, init) => {
        requests += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const abort = () => reject(new Error("mock request aborted"));
          if (signal == null || signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }),
    );
    expectNativeFallback(outcome, "timeout");
    expect(requests).toBe(2);
    if (outcome.kind === "unavailable") {
      expect(outcome.status.diagnostic).toMatchObject({ stage: "request", reason: "timeout" });
    }
  });

  test("uses native compaction after invalid JSON responses", async () => {
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(async () => new Response("not-json")),
    );
    expectRefused(outcome, "invalid-json");
    if (outcome.kind === "refused") {
      expect(outcome.status.diagnostic).toMatchObject({ stage: "body", reason: "invalid-json" });
    }
  });

  test("uses native compaction after oversized gateway bodies", async () => {
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(async () => new Response("x".repeat(256_001))),
    );
    expectRefused(outcome, "oversized-body");
    if (outcome.kind === "refused") {
      expect(outcome.status.diagnostic).toMatchObject({ stage: "body", reason: "oversized-body" });
    }
  });

  test("uses native compaction after HTTP 400", async () => {
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript("gateway failure fixture")),
      [],
      fastOptions(async () => new Response("bad request", { status: 400 })),
    );
    expectRefused(outcome, "http-status");
    if (outcome.kind === "refused") {
      expect(outcome.status.diagnostic).toMatchObject({
        stage: "request",
        reason: "http-status",
        httpStatus: 400,
      });
    }
  });

  test("aborts on cancellation and returns a successful Pi compaction envelope", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runFastJevCompaction(preparation(toolTranscript("unused")), [], {
      ...fastOptions(gatewayFetch(() => 0.01)),
      signal: controller.signal,
    });
    expectCancelled(cancelled, "caller-cancellation");

    const result = await runFastJevCompaction(
      preparation(toolTranscript("routine row\n".repeat(2_000))),
      [],
      fastOptions(gatewayFetch((candidate) => (candidate.source_range[0] === 0 ? 0.99 : 0.01))),
    );
    expect(result.kind).toBe("success");
    if (result.kind !== "success") throw new Error(`expected success, got ${result.kind}`);
    expect(toPiCompactionResponse(result)).toEqual({ compaction: result.result });
  });

  test("notifies the UI with actionable refusal status without source content", () => {
    const notifications: string[] = [];
    const status: FastJevAttemptStatus = {
      version: 3,
      outcome: "native-fallback",
      path: "native",
      reason: "source-span-limit",
      jevMs: 0,
      totalMs: 0,
      beforeChars: 717_500,
      afterChars: 717_500,
      spans: 1_024,
      requests: 0,
    };

    notifyFastJevRefusal({ notify: (message) => notifications.push(message) }, status);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("source-span-limit");
    expect(notifications[0]).toContain("could not compact");
    expect(notifications[0]).toContain("using Pi native compaction");
    expect(notifications[0]).not.toContain("/Users/");
    expect(notifications[0]).not.toContain("717_500");
  });

  test("registers compaction synchronously and refreshes configuration at startup", async () => {
    const handlers = new Map<string, unknown>();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const notifications: string[] = [];
    const pi = {
      on(name: string, callback: unknown) {
        handlers.set(name, callback);
      },
      registerCommand(name: string, command: unknown) {
        commands.set(name, command as typeof commands extends Map<string, infer T> ? T : never);
      },
      events: { emit() {} },
    } as unknown as ExtensionAPI;
    fastJevCompaction(pi, () => ({ config: { enabled: true, phased: true }, loadFailed: false }));
    expect(handlers.has("session_before_compact")).toBe(true);
    expect(commands.has("fast-jev-status")).toBe(true);
    const status = commands.get("fast-jev-status")!;
    const ctx = { ui: { notify: (message: string) => notifications.push(message) } };
    await status.handler("", ctx);
    expect(notifications[0]).toContain("configured disabled; startup observed no");
    expect(notifications[0]).toContain("compaction handler invocations 0");

    const start = handlers.get("session_start") as (() => void) | undefined;
    start?.();
    notifications.length = 0;
    await status.handler("", ctx);
    expect(notifications[0]).toContain("configured enabled (phased); startup observed yes");
    expect(notifications[0]).toContain("has no recorded attempt");
  });

  test("reports disabled compaction bypass and counts handler invocations", async () => {
    const handlers = new Map<string, unknown>();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const notifications: string[] = [];
    const pi = {
      on(name: string, callback: unknown) {
        handlers.set(name, callback);
      },
      registerCommand(name: string, command: unknown) {
        commands.set(name, command as typeof commands extends Map<string, infer T> ? T : never);
      },
      events: { emit() {} },
    } as unknown as ExtensionAPI;
    fastJevCompaction(pi, () => ({ config: { enabled: false }, loadFailed: false }));
    const compact = handlers.get("session_before_compact") as (
      event: SessionBeforeCompactEvent,
      ctx: unknown,
    ) => Promise<unknown>;
    const ctx = { ui: { notify: (message: string) => notifications.push(message) } };
    expect(await compact({} as SessionBeforeCompactEvent, ctx)).toBeUndefined();
    expect(notifications[0]).toContain("bypassed: jev.compaction is disabled");

    const status = commands.get("fast-jev-status")!;
    await status.handler("", ctx);
    expect(notifications[1]).toContain("configured disabled; startup observed no");
    expect(notifications[1]).toContain("compaction handler invocations 1");
  });
});
