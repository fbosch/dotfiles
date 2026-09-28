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
type Candidate = { readonly id: string; readonly evidence: readonly Evidence[] };
type RequestBody = {
  readonly state: { readonly task: string; readonly candidates: readonly Candidate[] };
  readonly questions: Record<string, unknown>;
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

function responseFor(
  body: RequestBody,
  choose: (phase: "coarse" | "refine", candidate: Candidate) => number,
): Response {
  const phase = body.state.task.startsWith("Select ") ? "coarse" : "refine";
  const answers = Object.fromEntries(
    Object.keys(body.questions).map((name) => {
      const id = name.slice("retain_".length);
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
          (phase) => phases.push(phase),
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
    expect(summary).not.toContain("routine-row-");
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

  test("bounds each of the two waves to four logical requests and eight total", async () => {
    const messages = Array.from({ length: 768 }, (_, index) => ({
      role: "assistant",
      content: [{ type: "text", text: `GROUP_${index};`.padEnd(700, "z") }],
    }));
    let active = 0;
    let maximumActive = 0;
    const fetch: JevGatewayFetch = async (_input, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        const body = JSON.parse(String(init?.body)) as RequestBody;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return responseFor(body, (phase) => (phase === "coarse" ? 0.99 : 0.01));
      } finally {
        active -= 1;
      }
    };

    const outcome = await runFastJevCompaction(preparation(messages), [], options(fetch));

    expect(outcome.kind).toBe("success");
    if (outcome.kind !== "success") throw new Error(`expected success, got ${outcome.kind}`);
    expect(outcome.result.details.fastJev.attempt.requests).toBeLessThanOrEqual(8);
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(outcome.result.details.fastJev.attempt.jevMs).toBeLessThan(12_000);
    expect(outcome.result.details.fastJev.attempt.afterChars).toBeLessThanOrEqual(
      Math.floor(outcome.result.details.fastJev.attempt.beforeChars * 0.2),
    );
  });

  test("refuses protected facts that alone exceed the final bound before any Jev request", async () => {
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
    if (outcome.kind === "refused") expect(outcome.status.reason).toBe("protected-too-large");
    expect(requests).toBe(0);
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
              candidates.map((candidate) => [candidate.id, phase === "coarse" ? 0.99 : 0.01]),
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
          answers: Object.fromEntries(candidates.map((candidate) => [candidate.id, 0.99])),
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
