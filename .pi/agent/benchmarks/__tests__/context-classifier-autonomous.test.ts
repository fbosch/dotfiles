import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLASSIFIER_DEFAULTS,
  type ClassifierResponse,
  classifyCompaction,
} from "../../extensions/context-masking/classifier-compaction";
import { DEFAULT_SETTINGS } from "../../extensions/context-masking/policy";
import { recallSaved } from "../../extensions/context-masking/recall";
import { autonomousProbe, type NativeAnswer } from "../context-classifier-autonomous-agent";
import {
  appendStage,
  artifactsPreserved,
  autonomousStages,
  compactionInput,
  newHistory,
  renderHistory,
  scoreStagedRecall,
} from "../context-classifier-autonomous-history";
import { assistant } from "../context-masking-recall-probe";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function fixture() {
  const stages = autonomousStages("autonomous-unit");
  const stage = stages[0];
  if (!stage) throw new Error("Missing stage");
  return { stages, stage };
}
function checkedAssistant(content: Parameters<typeof assistant>[0]): NativeAnswer {
  const message = assistant(content);
  if (message.role !== "assistant") throw new Error("Expected assistant fixture");
  return message;
}
function text(text: string): NativeAnswer {
  return checkedAssistant([{ type: "text", text }]);
}
function calls(
  items: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
): NativeAnswer {
  return {
    ...checkedAssistant(items.map((item) => ({ type: "toolCall", ...item }))),
    stopReason: "toolUse",
  };
}
const emptyAnswers = () =>
  JSON.stringify(Object.fromEntries(fixture().stage.probes.map((p) => [p.id, null])));
const bounds = { turns: 3, calls: 2, resultChars: 80, totalResultChars: 100, contextBytes: 48_000 };

test("allows an autonomous answer without forcing search or leaking ground truth", async () => {
  const { stage } = fixture();
  let completed = 0,
    searched = 0;
  const result = await autonomousProbe(
    stage,
    "visible memory",
    async (context) => {
      completed++;
      const prompt = JSON.stringify(context);
      for (const p of stage.probes) {
        expect(prompt).toContain(p.question);
        if (p.expected !== null && !/^\d+$/u.test(p.expected))
          expect(prompt).not.toContain(p.expected);
      }
      expect(context.tools?.[0]?.name).toBe("recall_saved");
      return text(emptyAnswers());
    },
    async () => {
      searched++;
      return { text: "should not be called", limited: false, skipped: 0 };
    },
  );
  expect(completed).toBe(1);
  expect(searched).toBe(0);
  expect(result.toolCalls).toBe(0);
  expect(result.exhausted).toBe(false);
});

test("executes the model-chosen query and preserves native call/result pairing", async () => {
  const { stage } = fixture();
  const queries: Array<[string, number]> = [];
  let turn = 0;
  const result = await autonomousProbe(
    stage,
    "memory",
    async (context) => {
      if (turn++ === 0)
        return calls([
          {
            id: "chosen",
            name: "recall_saved",
            arguments: { query: "ledger schema_tag", limit: 2 },
          },
        ]);
      const last = context.messages.at(-1);
      expect(last?.role).toBe("toolResult");
      if (last?.role === "toolResult") {
        expect(last.toolCallId).toBe("chosen");
        expect(last.isError).toBe(false);
      }
      return text(emptyAnswers());
    },
    async (query, limit) => {
      queries.push([query, limit]);
      return { text: "actual saved passage", limited: false, skipped: 0 };
    },
  );
  expect(queries).toEqual([["ledger schema_tag", 2]]);
  expect(result.turns).toBe(2);
  expect(result.toolCalls).toBe(1);
});

test("rejects unknown tools and invalid arguments without executing a search", async () => {
  const { stage } = fixture();
  let turn = 0,
    searched = 0;
  const result = await autonomousProbe(
    stage,
    "",
    async () =>
      turn++ === 0
        ? calls([
            { id: "wrong-name", name: "read", arguments: { query: "ledger" } },
            { id: "wrong-type", name: "recall_saved", arguments: { query: 42 } },
            { id: "wrong-limit", name: "recall_saved", arguments: { query: "ledger", limit: 4 } },
            { id: "long", name: "recall_saved", arguments: { query: "x".repeat(501) } },
          ])
        : text(emptyAnswers()),
    async () => {
      searched++;
      return { text: "", limited: false, skipped: 0 };
    },
  );
  expect(searched).toBe(0);
  expect(result.toolCalls).toBe(0);
  expect(result.events.every((e) => e.error)).toBe(true);
});

test("caps tool-result characters including truncation markers across parallel calls", async () => {
  const { stage } = fixture();
  let turn = 0;
  const result = await autonomousProbe(
    stage,
    "",
    async () =>
      turn++ === 0
        ? calls([
            { id: "one", name: "recall_saved", arguments: { query: "one" } },
            { id: "two", name: "recall_saved", arguments: { query: "two" } },
          ])
        : text(emptyAnswers()),
    async () => ({ text: "x".repeat(200), limited: false, skipped: 0 }),
    bounds,
  );
  expect(result.events.map((e) => e.chars)).toEqual([80, 20]);
  expect(result.events.every((e) => e.truncated)).toBe(true);
});

test("enforces model-turn, successful-search and context budgets", async () => {
  const { stage } = fixture();
  let turn = 0,
    searched = 0;
  const result = await autonomousProbe(
    stage,
    "",
    async () =>
      calls([{ id: String(turn++), name: "recall_saved", arguments: { query: "ledger" } }]),
    async () => {
      searched++;
      return { text: "evidence", limited: false, skipped: 0 };
    },
    { ...bounds, turns: 2, calls: 1 },
  );
  expect(searched).toBe(1);
  expect(result.turns).toBe(2);
  expect(result.exhausted).toBe(true);
  expect(result.events[1]?.error).toBe(true);
  let completed = 0;
  const limited = await autonomousProbe(
    stage,
    "",
    async () => {
      completed++;
      return text("");
    },
    async () => ({ text: "", limited: false, skipped: 0 }),
    { ...bounds, contextBytes: 1 },
  );
  expect(completed).toBe(0);
  expect(limited.exhausted).toBe(true);
});

test("revisions and superseded drafts score against the correct checkpoint", () => {
  const { stages } = fixture();
  const first = stages[0],
    last = stages[2];
  if (!first || !last) throw new Error("Missing stages");
  for (const stage of stages)
    for (const output of stage.outputs)
      expect(output.length).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.minResultChars);
  const answers = Object.fromEntries(last.probes.map((p) => [p.id, p.expected]));
  expect(scoreStagedRecall(stages, 2, JSON.stringify(answers)).positiveCorrect).toBe(6);
  expect(
    scoreStagedRecall(stages, 2, JSON.stringify({ ...answers, schema: first.probes[0]?.expected }))
      .staleAnswers,
  ).toBe(1);
  expect(
    scoreStagedRecall(stages, 2, JSON.stringify({ ...answers, schema: first.probes[0]?.rejected }))
      .staleAnswers,
  ).toBe(1);
});

test("three real checkpoints carry previous summaries without leaking isolated probes", async () => {
  const { stages } = fixture();
  const root = await mkdtemp(join(tmpdir(), "classifier-autonomous-test-"));
  roots.push(root);
  const history = newHistory(root);
  let previous: string | undefined;
  for (const [phase, stage] of stages.entries()) {
    await appendStage(history, stage, phase);
    const input = compactionInput(history, stage.goal);
    expect(input.previousSummary).toBe(previous);
    expect(input.messages.filter((m) => m.role === "toolResult")).toHaveLength(
      phase === 0 ? 16 : 12,
    );
    const masked = await renderHistory(input, history.artifactRoot, false);
    const hydrated = await renderHistory(input, history.artifactRoot, true);
    const output = stage.probes.find((p) => p.id === "schema")?.expected;
    if (phase === 0 && output) {
      expect(masked).not.toContain(output);
      expect(hydrated).toContain(output);
    }
    const outcome = await classifyCompaction(
      input,
      { ...CLASSIFIER_DEFAULTS, enabled: true, maxOutputBytes: 4_000 },
      {
        artifactRoot: history.artifactRoot,
        classify: async (request): Promise<ClassifierResponse> => {
          for (const s of stages)
            for (const p of s.probes) expect(JSON.stringify(request)).not.toContain(p.question);
          return {
            api: "typesafe-system-one",
            provider: "test",
            model: "test",
            timestamp: 0,
            stopReason: "stop",
            answers: Object.fromEntries(
              Object.keys(request.questions).map((q) => [q, { type: "bool", probability: 0 }]),
            ),
          };
        },
      },
    );
    expect(outcome.kind).toBe("retained");
    previous = outcome.text;
    history.manager.appendCompaction(previous, null, 0);
    expect(history.manager.buildSessionProjection().messages).toHaveLength(1);
    const count = history.manager.getEntryCount();
    await autonomousProbe(
      stage,
      previous,
      async () => text(emptyAnswers()),
      (query, limit) =>
        recallSaved(history.manager.getBranch(), history.artifactRoot, query, limit),
    );
    expect(history.manager.getEntryCount()).toBe(count);
    expect(await artifactsPreserved(history)).toBe(true);
  }
  const latest = stages[2];
  if (!latest) throw new Error("Missing final stage");
  const schema = latest.probes.find((p) => p.id === "schema");
  if (!schema?.expected) throw new Error("Missing final schema");
  const found = await recallSaved(
    history.manager.getBranch(),
    history.artifactRoot,
    "ledger schema_tag revision",
    3,
  );
  expect(found.text).toContain(schema.expected);
  expect(found.limited).toBe(false);
  expect(found.skipped).toBe(0);
});

test("a length-limited final answer is scored instead of aborting the probe", async () => {
  const { stage } = fixture();
  const result = await autonomousProbe(
    stage,
    "",
    async () => ({
      ...text('{"schema":'),
      stopReason: "length",
    }),
    async () => ({ text: "", limited: false, skipped: 0 }),
  );
  expect(scoreStagedRecall([stage], 0, result.answer).valid).toBe(false);
  expect(result.turns).toBe(1);
});
