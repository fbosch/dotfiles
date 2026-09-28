import { describe, expect, test } from "bun:test";
import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import type { JevGatewayFetch } from "../../../lib/jev-gateway";
import {
  type FastJevRunOptions,
  resolveFastJevCompactionConfig,
  runFastJevCompaction,
  toPiCompactionResponse,
} from "../index";
import { runPhasedSelection } from "../phased";

const registry = {
  getProviderAuth: async () => ({ auth: { apiKey: "offline-test-key" } }),
} as unknown as FastJevRunOptions["modelRegistry"];
const missingCredentials = {
  getProviderAuth: async () => undefined,
} as unknown as FastJevRunOptions["modelRegistry"];

type Preparation = SessionBeforeCompactEvent["preparation"];
type Evidence = { readonly text: string };
type Question = { readonly instructions: string };
type UserConstraint = { readonly source: string; readonly text: string };
type Candidate = {
  readonly id: string;
  readonly judgment: "retain" | "retire";
  readonly group_id: string;
  readonly evidence: readonly Evidence[];
  readonly retirement_witness_group_id?: string;
};
type RequestBody = {
  readonly state: {
    readonly task: string;
    readonly user_constraints: readonly UserConstraint[];
    readonly candidates: readonly Candidate[];
    readonly retirement_witness_groups: readonly {
      readonly id: string;
      readonly evidence: readonly Evidence[];
    }[];
  };
  readonly questions: Record<string, Question>;
};

function preparation(messages: readonly unknown[], reserveTokens = 50_000): Preparation {
  return {
    messagesToSummarize: messages,
    turnPrefixMessages: [],
    isSplitTurn: false,
    firstKeptEntryId: "kept-entry",
    tokensBefore: 500_000,
    previousSummary: undefined,
    fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
    settings: { enabled: true, reserveTokens, keepRecentTokens: 20_000 },
  } as unknown as Preparation;
}

function priorV3Summary(text: string): string {
  return [
    "<fast-jev-compaction>",
    "Selection-only continuation record. Source text is copied, not summarized or inferred.",
    "<selected-source-spans>",
    `[source s1; kind user; origin ${JSON.stringify("prepared message 2 (user)")}; range (sanitized UTF-16 code units after redaction and whitespace normalization) 0:${text.length}]`,
    JSON.stringify(text),
    "</selected-source-spans>",
    "Pi file operations (source: CompactionPreparation.fileOps):",
    "read: none",
    "modified: none",
    "</fast-jev-compaction>",
  ].join("\n");
}

function toolTranscript(result: string): unknown[] {
  return [
    { role: "user", content: [{ type: "text", text: "Keep this current user constraint." }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect the source." },
        { type: "toolCall", id: "read-1", name: "read", arguments: { path: "src/input.ts" } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "read-1",
      content: [{ type: "text", text: result }],
      isError: false,
    },
  ];
}

function expectQuestionIdentity(body: RequestBody): void {
  expect(Object.keys(body.questions).length).toBeLessThanOrEqual(16);
  expect(body.state).toHaveProperty("user_constraints");
  for (const [name, question] of Object.entries(body.questions)) {
    const candidate = body.state.candidates.find((item) => name === `${item.judgment}_${item.id}`);
    if (candidate === undefined) throw new Error(`missing candidate for ${name}`);
    expect(question.instructions).toContain(candidate.id);
    expect(question.instructions).toContain(candidate.group_id);
    if (candidate.judgment === "retire") {
      const witnessId = candidate.retirement_witness_group_id;
      if (witnessId === undefined) throw new Error(`missing witness for ${candidate.id}`);
      expect(question.instructions).toContain(witnessId);
    }
  }
}

function responseFor(
  body: RequestBody,
  choose: (phase: "coarse" | "refine", candidate: Candidate) => number,
): Response {
  const phase = body.state.task.startsWith("Select ") ? "coarse" : "refine";
  const answers = Object.fromEntries(
    Object.keys(body.questions).map((name) => {
      const judgment = name.startsWith("retire_") ? "retire" : "retain";
      const id = name.slice(`${judgment}_`.length);
      const candidate = body.state.candidates.find((item) => item.id === id);
      return [name, { type: "noul", noul: candidate === undefined ? 0 : choose(phase, candidate) }];
    }),
  );
  return new Response(JSON.stringify({ answers }), { status: 200 });
}

function mockedJev(
  choose: (phase: "coarse" | "refine", candidate: Candidate) => number,
  onRequest?: (phase: "coarse" | "refine", body: RequestBody) => void,
): JevGatewayFetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as RequestBody;
    const phase = body.state.task.startsWith("Select ") ? "coarse" : "refine";
    expectQuestionIdentity(body);
    onRequest?.(phase, body);
    await new Promise((resolve) => setTimeout(resolve, 1));
    return responseFor(body, choose);
  };
}

function options(fetch: JevGatewayFetch, modelRegistry = registry): FastJevRunOptions {
  return { modelRegistry, fetch, phased: true };
}

describe("phased Fast Jev compaction", () => {
  test("keeps unique middle and tail evidence beyond the former 256-span window", async () => {
    const rows = Array.from({ length: 330 }, (_, index) => {
      if (index === 157) return "FACT_MID_WINDOW".padEnd(700, ".");
      if (index === 293) return "FACT_END_WINDOW".padEnd(700, ".");
      return `routine-row-${index};`.padEnd(700, "x");
    });
    const phases: string[] = [];
    const outcome = await runFastJevCompaction(
      preparation(toolTranscript(rows.join(""))),
      [],
      options(
        mockedJev(
          (phase, candidate) => {
            if (phase === "coarse") return 0.99;
            const text = candidate.evidence.map((evidence) => evidence.text).join("");
            return text.includes("FACT_MID_WINDOW") || text.includes("FACT_END_WINDOW")
              ? 0.99
              : 0.01;
          },
          (phase, body) => {
            phases.push(phase);
            expect(
              body.state.user_constraints.some((item) =>
                item.text.includes("Keep this current user constraint."),
              ),
            ).toBe(true);
          },
        ),
      ),
    );

    if (outcome.kind !== "success")
      throw new Error(`expected success, got ${outcome.kind}/${outcome.status.reason}`);
    expect(outcome.kind).toBe("success");
    const { summary } = outcome.result;
    expect(summary).toContain("Keep this current user constraint.");
    expect(summary).toContain("FACT_MID_WINDOW");
    expect(summary).toContain("FACT_END_WINDOW");
    expect(summary).not.toContain("routine-row-0;");
    expect(summary).not.toContain("routine-row-100;");
    expect(summary).toContain('tool call "read-1"');
    expect(phases).toContain("coarse");
    expect(phases).toContain("refine");
    expect(outcome.result.details.fastJev.attempt.afterChars).toBeLessThanOrEqual(
      Math.floor(outcome.result.details.fastJev.attempt.beforeChars * 0.2),
    );
    expect(outcome.result.details.fastJev.selectedSpans).toContainEqual(
      expect.objectContaining({ toolCallId: "read-1", toolCallPart: "call" }),
    );
    expect(outcome.result.details.fastJev.attempt.requests).toBeLessThanOrEqual(8);
  });

  test("skips targeted refinement when coarse selection already meets both size limits", async () => {
    const phases: string[] = [];
    const outcome = await runFastJevCompaction(
      preparation([
        { role: "assistant", content: [{ type: "text", text: "Routine evidence ".repeat(5_000) }] },
      ]),
      [],
      options(
        mockedJev(
          () => 0.01,
          (phase) => phases.push(phase),
        ),
      ),
    );

    expect(outcome.kind).toBe("success");
    expect(phases).toEqual(["coarse"]);
    if (outcome.kind === "success") expect(outcome.result.details.fastJev.attempt.requests).toBe(1);
  });

  test("bounds each wave to four requests of sixteen questions across 784 spans in 49 groups", async () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "CURRENT_TASK_CONSTRAINT" }] },
      ...Array.from({ length: 49 }, (_, index) => ({
        role: "assistant",
        content: [{ type: "text", text: `GROUP_${index};`.padEnd(700, "z").repeat(16) }],
      })),
    ];
    const phaseCounts = { coarse: 0, refine: 0 };
    let active = 0;
    let maximumActive = 0;
    const fetch: JevGatewayFetch = async (_input, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        expectQuestionIdentity(body);
        const phase = body.state.task.startsWith("Select ") ? "coarse" : "refine";
        phaseCounts[phase] += 1;
        expect(
          body.state.user_constraints.some((item) => item.text.includes("CURRENT_TASK_CONSTRAINT")),
        ).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return responseFor(body, (requestPhase) => (requestPhase === "coarse" ? 0.99 : 0.01));
      } finally {
        active -= 1;
      }
    };

    const outcome = await runFastJevCompaction(preparation(messages), [], options(fetch));

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error(`expected success, got ${outcome.kind}`);
    expect(outcome.result.details.fastJev.attempt.spans).toBe(785);
    expect(phaseCounts.coarse).toBeLessThanOrEqual(4);
    expect(phaseCounts.refine).toBeLessThanOrEqual(4);
    expect(outcome.result.details.fastJev.attempt.requests).toBeLessThanOrEqual(8);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(outcome.result.details.fastJev.attempt.jevMs).toBeLessThan(12_000);
    expect(outcome.result.details.fastJev.attempt.afterChars).toBeLessThanOrEqual(
      Math.floor(outcome.result.details.fastJev.attempt.beforeChars * 0.2),
    );
  });

  test("reports an irreducible protected floor accurately before any Jev request", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation([
        { role: "user", content: [{ type: "text", text: "PROTECTED_FACT ".repeat(4_000) }] },
      ]),
      [],
      options(async () => {
        requests += 1;
        return new Response("{}");
      }),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.status.reason).toBe("protected-too-large");
      expect(outcome.status.requests).toBe(0);
      expect(outcome.status.jevMs).toBe(0);
      expect(outcome.status.selection).toMatchObject({
        phase: "preflight",
        candidateChars: 0,
      });
      const selection = outcome.status.selection;
      if (selection === undefined) throw new Error("expected protected-floor diagnostics");
      expect(outcome.status.afterChars).toBe(selection.protectedChars);
      expect(outcome.status.afterChars).not.toBe(outcome.status.beforeChars);
    }
    expect(requests).toBe(0);
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
  });

  test("retires 784 historical spans across bounded whole-group requests", async () => {
    const priorSummary = "OLD_PRIOR_DUPLICATE ".repeat(600);
    const historicalUsers = Array.from({ length: 49 }, (_, index) => ({
      role: "user",
      content: [{ type: "text", text: `OLD_USER_${index}_`.padEnd(700, "x").repeat(16) }],
    }));
    const historicalUserChars = historicalUsers.reduce(
      (sum, message) =>
        sum + (message.content[0]?.type === "text" ? message.content[0].text.length : 0),
      0,
    );
    const prepared = {
      ...preparation([
        ...historicalUsers,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "The old requests are superseded. Keep CURRENT_ACTIVE_CONSTRAINT; use the current plan only.",
            },
          ],
        },
      ]),
      previousSummary: priorSummary,
    };
    const phaseCounts = { coarse: 0, refine: 0 };
    let assessedHistoricalChars = 0;
    let questionCount = 0;
    const fetch: JevGatewayFetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as RequestBody;
      expectQuestionIdentity(body);
      expect(
        body.state.user_constraints.some((item) => item.text.includes("CURRENT_ACTIVE_CONSTRAINT")),
      ).toBe(true);
      const phase = body.state.task.startsWith("Select ") ? "coarse" : "refine";
      phaseCounts[phase] += 1;
      questionCount += Object.keys(body.questions).length;
      const answers = Object.fromEntries(
        Object.keys(body.questions).map((name) => {
          const candidateId = name.slice(name.indexOf("_") + 1);
          const candidate = body.state.candidates.find((item) => item.id === candidateId);
          if (candidate === undefined) throw new Error(`missing candidate ${candidateId}`);
          const text = candidate.evidence.map((item) => item.text).join("");
          if (candidate.judgment === "retire") {
            expect(text.length).toBeGreaterThan(700);
            assessedHistoricalChars += text.length;
            const witness = body.state.retirement_witness_groups.find(
              (group) => group.id === candidate.retirement_witness_group_id,
            );
            const witnessText = witness?.evidence.map((item) => item.text).join("") ?? "";
            return [
              name,
              {
                type: "noul",
                noul: witnessText.includes("old requests are superseded") ? 0.99 : 0.01,
              },
            ];
          }
          throw new Error(`unexpected non-retirement candidate ${candidate.id}`);
        }),
      );
      return new Response(JSON.stringify({ answers }));
    };

    const outcome = await runFastJevCompaction(prepared, [], options(fetch));

    if (outcome.kind !== "success")
      throw new Error(
        `expected success, got ${outcome.kind}/${outcome.status.reason}/${outcome.status.beforeChars}->${outcome.status.afterChars}/${outcome.status.requests}/${outcome.status.spans}/${JSON.stringify(outcome.status.selection)}`,
      );
    expect(outcome.kind).toBe("success");
    expect(outcome.result.summary).toContain("CURRENT_ACTIVE_CONSTRAINT");
    expect(outcome.result.summary).not.toContain("OLD_PRIOR_DUPLICATE");
    expect(outcome.result.summary).not.toContain("OLD_USER_");
    expect(assessedHistoricalChars).toBe(priorSummary.trim().length + historicalUserChars);
    expect(questionCount).toBe(50);
    expect(phaseCounts.coarse).toBeLessThanOrEqual(4);
    expect(phaseCounts.refine).toBe(0);
    expect(outcome.result.details.fastJev.attempt.requests).toBe(
      phaseCounts.coarse + phaseCounts.refine,
    );
    expect(outcome.result.details.fastJev.attempt.requests).toBeLessThanOrEqual(8);
    expect(outcome.result.details.fastJev.attempt.afterChars).toBeLessThanOrEqual(
      Math.floor(outcome.result.details.fastJev.attempt.beforeChars * 0.2),
    );
  });

  test("keeps every latest-user span separate from a colliding historical source label", async () => {
    const currentText = "CURRENT_ACTIVE_CONSTRAINT".padEnd(1_400, ".");
    const oldRequest = "OLD_OPEN_REQUEST ".repeat(600);
    const prepared = {
      ...preparation([
        { role: "user", content: [{ type: "text", text: oldRequest }] },
        { role: "compactionSummary", summary: priorV3Summary(currentText) },
        { role: "user", content: [{ type: "text", text: currentText }] },
      ]),
      previousSummary: priorV3Summary(currentText),
    };
    let sawHistoricalCollision = false;
    const outcome = await runFastJevCompaction(
      prepared,
      [],
      options(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        expectQuestionIdentity(body);
        expect(
          body.state.user_constraints.some((item) =>
            item.text.includes("CURRENT_ACTIVE_CONSTRAINT"),
          ),
        ).toBe(true);
        const witnessGroups = new Map(
          body.state.retirement_witness_groups.map((group) => [group.id, group]),
        );
        for (const candidate of body.state.candidates) {
          if (candidate.judgment !== "retire") continue;
          const witnessId = candidate.retirement_witness_group_id;
          if (witnessId === undefined) throw new Error(`missing witness for ${candidate.id}`);
          expect(candidate.group_id).not.toBe(witnessId);
          const witness = witnessGroups.get(witnessId);
          if (witness === undefined) throw new Error(`missing witness group ${witnessId}`);
          expect(witness.evidence.map((item) => item.text).join("")).toBe(currentText);
          expect(body.state.candidates.some((item) => item.group_id === witnessId)).toBe(false);
          if (candidate.evidence.some((item) => item.text === currentText)) {
            sawHistoricalCollision = true;
            expect(candidate.group_id).not.toBe(witness.id);
          }
        }
        return responseFor(body, () => 0.99);
      }),
    );

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error(`expected success, got ${outcome.kind}`);
    expect(sawHistoricalCollision).toBe(true);
    const retainedUserText = outcome.result.summary
      .split("\n")
      .filter((line) => line.startsWith('"'))
      .map((line): unknown => JSON.parse(line))
      .join("");
    expect(retainedUserText).toBe(currentText);
    expect(
      outcome.result.details.fastJev.selectedSpans.filter(
        (span) => span.source === "prepared message 2 (user)",
      ),
    ).toHaveLength(2);
  });

  test("keeps oversized history when the complete named witness provides no retirement evidence", async () => {
    let requests = 0;
    const priorSummary = "OLD_UNRESOLVED_FACT ".repeat(4_000);
    const prepared = {
      ...preparation([
        { role: "user", content: [{ type: "text", text: "A new unrelated question." }] },
      ]),
      previousSummary: priorSummary,
    };
    const statuses: unknown[] = [];
    const outcome = await runFastJevCompaction(prepared, [], {
      ...options(
        mockedJev(
          () => 0.01,
          () => {
            requests += 1;
          },
        ),
      ),
      onStatus: (status) => statuses.push(status),
    });

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.status.reason).toBe("protected-too-large");
      expect(outcome.status.selection).toMatchObject({ phase: "coarse" });
      expect(outcome.status.requests).toBeGreaterThan(0);
      expect(outcome.status.selection?.candidateChars).toBeGreaterThan(0);
      const selection = outcome.status.selection;
      if (selection === undefined) throw new Error("expected protected-floor diagnostics");
      expect(outcome.status.afterChars).toBe(selection.protectedChars);
      expect(outcome.status.afterChars).not.toBe(outcome.status.beforeChars);
    }
    expect(statuses).toHaveLength(1);
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
    expect(requests).toBeGreaterThan(0);
  });

  test("refuses malformed historical-retirement answers atomically", async () => {
    let requests = 0;
    const prepared = {
      ...preparation([
        { role: "user", content: [{ type: "text", text: "The old task is closed." }] },
      ]),
      previousSummary: "OLD_SUMMARY_FACT ".repeat(1_000),
    };
    const outcome = await runFastJevCompaction(
      prepared,
      [],
      options(async () => {
        requests += 1;
        return new Response(JSON.stringify({ answers: {} }));
      }),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.status.reason).toBe("malformed-jev");
      expect(outcome.status.selection?.phase).toBe("coarse");
    }
    expect(requests).toBe(1);
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
  });

  test("checks Pi budget limits before making requests", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation(
        [
          { role: "user", content: [{ type: "text", text: "Keep the user constraint." }] },
          {
            role: "assistant",
            content: [{ type: "text", text: "optional evidence ".repeat(2_000) }],
          },
        ],
        1,
      ),
      [],
      options(async () => {
        requests += 1;
        return new Response("{}");
      }),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.status.reason).toBe("protected-too-large");
    expect(requests).toBe(0);
  });

  test("refuses when targeted refinement still exceeds the final bound", async () => {
    const outcome = await runFastJevCompaction(
      preparation([
        { role: "assistant", content: [{ type: "text", text: "KEEP_TOO_MUCH ".repeat(2_500) }] },
      ]),
      [],
      options(mockedJev(() => 0.99)),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.status.reason).toBe("final-size-limit");
      expect(outcome.status.requests).toBe(2);
    }
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
  });

  test("keeps optional spans from a mandatory tool-call group after refinement", async () => {
    const phases: string[] = [];
    const outcome = await runPhasedSelection(
      [
        {
          id: "A",
          kind: "tool-call",
          source: "tool call",
          start: 0,
          end: 1,
          text: "A",
          mandatory: true,
          toolCallId: "tool-1",
          toolCallPart: "call",
        },
        {
          id: "B",
          kind: "tool-result",
          source: "tool result",
          start: 1,
          end: 2,
          text: "B",
          mandatory: false,
          toolCallId: "tool-1",
          toolCallPart: "result",
        },
        {
          id: "X",
          kind: "assistant",
          source: "optional evidence",
          start: 0,
          end: 1,
          text: "X",
          mandatory: false,
        },
      ],
      {
        originalChars: 10,
        deadlineMs: 1_000,
        maxItemsPerRequest: 192,
        preflight: () => true,
        judge: async (phase, candidates) => {
          phases.push(phase);
          return {
            kind: "answers",
            answers: Object.fromEntries(
              candidates.map((candidate) => [
                `${candidate.judgment}_${candidate.id}`,
                phase === "coarse" ? 0.99 : 0.01,
              ]),
            ),
          };
        },
        render: (selected) => selected.map((span) => span.text).join(""),
        wrappedChars: (rendered) => rendered.length,
        fitsPiBudget: (rendered) => rendered.length <= 2,
      },
    );

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.selected.map((span) => span.id)).toEqual(["A", "B"]);
      expect(outcome.wrappedChars).toBe(2);
    }
    expect(phases).toEqual(["coarse", "refine"]);
  });

  test("deduplicates exact source spans before coarse judgments", async () => {
    const span = {
      id: "s1",
      kind: "assistant",
      source: "prepared message 1 (assistant)",
      start: 0,
      end: 4,
      text: "FACT",
      mandatory: false,
    } as const;
    const outcome = await runPhasedSelection([span, { ...span, id: "s2" }], {
      originalChars: 100,
      deadlineMs: 1_000,
      maxItemsPerRequest: 192,
      preflight: () => true,
      judge: async (phase, candidates) => {
        expect(phase).toBe("coarse");
        expect(candidates).toHaveLength(1);
        expect(candidates[0]?.spans).toHaveLength(1);
        return {
          kind: "answers",
          answers: Object.fromEntries(
            candidates.map((candidate) => [`${candidate.judgment}_${candidate.id}`, 0.99]),
          ),
        };
      },
      render: (selected) => selected.map((source) => source.text).join(""),
      wrappedChars: (rendered) => rendered.length,
      fitsPiBudget: () => true,
    });

    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") expect(outcome.selected).toHaveLength(1);
  });

  test("rejects malformed phase answers atomically instead of delegating natively", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation([
        {
          role: "assistant",
          content: [{ type: "text", text: "optional evidence ".repeat(4_000) }],
        },
      ]),
      [],
      options(async () => {
        requests += 1;
        return new Response(JSON.stringify({ answers: {} }));
      }),
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") expect(outcome.status.reason).toBe("malformed-jev");
    expect(requests).toBe(1);
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
  });

  test("uses native compaction when credentials are unavailable", async () => {
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation([
        {
          role: "assistant",
          content: [{ type: "text", text: "optional evidence ".repeat(1_000) }],
        },
      ]),
      [],
      options(async () => {
        requests += 1;
        return new Response("{}");
      }, missingCredentials),
    );

    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") expect(outcome.status.reason).toBe("missing-credentials");
    expect(requests).toBe(0);
    expect(toPiCompactionResponse(outcome)).toBeUndefined();
  });

  test("uses native compaction after the bounded gateway deadline", async () => {
    const outcome = await runFastJevCompaction(
      preparation([
        {
          role: "assistant",
          content: [{ type: "text", text: "optional evidence ".repeat(1_000) }],
        },
      ]),
      [],
      options(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const abort = () => reject(new Error("mock request aborted"));
            if (signal == null || signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          }),
      ),
    );

    expect(outcome.kind).toBe("unavailable");
    if (outcome.kind === "unavailable") expect(outcome.status.reason).toBe("timeout");
    expect(toPiCompactionResponse(outcome)).toBeUndefined();
  });

  test("treats caller cancellation as terminal rather than native fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    let requests = 0;
    const outcome = await runFastJevCompaction(
      preparation([{ role: "assistant", content: [{ type: "text", text: "optional evidence" }] }]),
      [],
      {
        ...options(async () => {
          requests += 1;
          return new Response("{}");
        }),
        signal: controller.signal,
      },
    );

    expect(outcome.kind).toBe("cancelled");
    expect(requests).toBe(0);
    expect(toPiCompactionResponse(outcome)).toEqual({ cancel: true });
  });

  test("requires explicit phased opt-in and still requires compaction enablement", () => {
    expect(resolveFastJevCompactionConfig({ jev: { compaction: { enabled: true } } })).toEqual({
      enabled: true,
    });
    expect(
      resolveFastJevCompactionConfig({ jev: { compaction: { enabled: true, phased: true } } }),
    ).toEqual({ enabled: true, phased: true });
    expect(
      resolveFastJevCompactionConfig({ jev: { compaction: { enabled: false, phased: true } } }),
    ).toEqual({ enabled: false });
  });
});
