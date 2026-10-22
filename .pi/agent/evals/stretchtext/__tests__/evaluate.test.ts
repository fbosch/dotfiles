import { expect, test } from "bun:test";
import type { ClassifierAnswer } from "@earendil-works/pi-ai";
import {
  type Judgment,
  judge,
  preservesWords,
  project,
  summarizeControls,
  summarizePairs,
  verdict,
  type WriterRow,
} from "../evaluate";
import { FIXTURES } from "../fixtures";

const scenario = { id: "synthetic", request: "What must I do?", facts: "Restart the service." };
function judgment(probabilities = [0.01, 0.01, 0.99]): Judgment {
  return {
    issues: [],
    models: ["synthetic/judge"],
    elapsedMs: 1,
    result: {
      ok: true,
      value: {
        answers: {
          essentialMissing: { type: "bool", probability: probabilities[0]! },
          meaningChanged: { type: "bool", probability: probabilities[1]! },
          usefulDetail: { type: "bool", probability: probabilities[2]! },
        },
      },
    },
  };
}
function writer(arm: WriterRow["arm"], result = judgment()): WriterRow {
  return {
    scenario: "synthetic",
    arm,
    model: "synthetic/writer",
    reply: "Restart the service. {{Why?|Why? Settings are read at startup.}}",
    generationFailure: null,
    generationCost: 0,
    judgment: result,
  };
}

test("synthetic controls obey the structural contract before semantic grading", () => {
  expect(new Set(FIXTURES.map((row) => row.id)).size).toBe(FIXTURES.length);
  for (const fixture of FIXTURES) expect(project(fixture, fixture.reply).issues).toEqual([]);
});

test("nested projections show the reader's fully collapsed and expanded views", () => {
  const result = project(
    scenario,
    "{{Overview.|Overview. {{Action.|Action: restart the service.}}}}",
  );
  expect(result.issues).toEqual([]);
  expect(result.state.collapsed).toBe("Overview.");
  expect(result.state.expanded).toBe("Overview. Action: restart the service.");
  expect(result.state.request).toBe(scenario.request);
  expect(Object.keys(result.state).sort()).toEqual(["collapsed", "expanded", "facts", "request"]);
});

test("word preservation is ordered, case-sensitive, Unicode-aware, and counts repetitions", () => {
  expect(preservesWords("The build fails.", "The CI build sometimes fails.")).toBe(true);
  expect(preservesWords("æ ø å 漢字", "æ, then ø, then å and 漢字.")).toBe(true);
  expect(preservesWords("run run", "run")).toBe(false);
  expect(preservesWords("build fails", "fails build")).toBe(false);
  expect(preservesWords("The build", "the build")).toBe(false);
});

test.each([
  ["{{Summary.|Summary.", "incomplete stretch"],
  ["{{Summary}}", "incomplete stretch"],
  ["{{Two\nlines|Two lines expanded.}}", "multiline short form"],
  ["{{The build fails.|The build passes.}}", "short words missing or reordered"],
  [
    "{{It reads its config at startup.|The service reads its config at startup.}}",
    "short words missing or reordered",
  ],
])("structural violation is explicit for %s", (reply, reason) => {
  expect(project(scenario, reply).issues.some((issue) => issue.startsWith(reason))).toBe(true);
});

test("code examples with literal braces are not evaluated as stretches", () => {
  const code = "Use `{{short|long}}`.\n\n```text\n{{literal|code}}\n```";
  const result = project(scenario, code);
  expect(result.issues).toEqual([]);
  expect(result.state.collapsed).toBe(code);
  expect(result.state.expanded).toBe(code);
});

test("invalid structure never contacts a classifier", async () => {
  let contacted = false;
  const result = await judge(
    {
      findOfType() {
        contacted = true;
        return undefined;
      },
      async classify() {
        contacted = true;
        throw Error("Unexpected request");
      },
    },
    scenario,
    "{{Summary.|Summary.",
    new AbortController().signal,
  );
  expect(result.result).toBeNull();
  expect(result.issues.length).toBeGreaterThan(0);
  expect(contacted).toBe(false);
});

test("control errors, uncertain decisions, and failed requests remain separate", () => {
  const expected = { essentialMissing: false, meaningChanged: false, usefulDetail: true };
  const summary = summarizeControls([
    { id: "correct", expected, judgment: judgment() },
    { id: "wrong", expected, judgment: judgment([0.6, 0.1, 0.9]) },
    {
      id: "failed",
      expected,
      judgment: { ...judgment(), result: { ok: false, stage: "request", reason: "timeout" } },
    },
  ]);
  expect(summary).toMatchObject({
    completed: 3,
    excluded: 1,
    correct: 5,
    decisions: 6,
    uncertain: 1,
  });
  expect(summary.errors).toEqual([
    { id: "wrong", dimension: "essentialMissing", expected: false, probability: 0.6 },
  ]);
});

test.each([
  { type: "bool", probability: Number.NaN },
  { type: "bool", probability: 1.1 },
  { type: "choice", choice: "yes", probabilities: { yes: 1 }, confidence: 1 },
] satisfies ClassifierAnswer[])("malformed or unexpected answers are unscorable: %j", (answer) => {
  const row = judgment();
  if (!row.result?.ok) throw Error("Invalid test setup");
  row.result.value.answers.essentialMissing = answer;
  expect(verdict(row)).toBeNull();
});

test("a missing question is not a negative verdict", () => {
  const row = judgment();
  if (!row.result?.ok) throw Error("Invalid test setup");
  delete row.result.value.answers.essentialMissing;
  expect(verdict(row)).toBeNull();
});

test("pair summary reports semantic failures for both arms without implying ground truth", () => {
  const summary = summarizePairs([
    writer("baseline", judgment([0.9, 0.8, 0.1])),
    writer("candidate"),
  ]);
  expect(summary).toEqual({
    completePairs: 1,
    excludedPairs: 0,
    arms: {
      baseline: { essentialMissing: 1, meaningChanged: 1, redundantExpansion: 1 },
      candidate: { essentialMissing: 0, meaningChanged: 0, redundantExpansion: 0 },
    },
  });
});

test("plain answers are not penalized for lacking an expansion", () => {
  const a = { ...writer("baseline", judgment([0, 0, 0])), reply: "Restart the service." };
  const b = { ...writer("candidate", judgment([0, 0, 0])), reply: "Restart the service." };
  expect(summarizePairs([a, b]).arms.baseline.redundantExpansion).toBe(0);
});

test("failed, missing, duplicate, structurally invalid, or model-mismatched pairs are excluded", () => {
  const a = writer("baseline");
  const b = writer("candidate");
  const cases: WriterRow[][] = [
    [a],
    [a, b, b],
    [a, { ...b, model: "other/writer" }],
    [a, { ...b, generationFailure: "error" }],
    [a, { ...b, judgment: { ...judgment(), models: ["other/judge"] } }],
    [a, { ...b, judgment: { ...judgment(), models: [] } }],
    [
      { ...a, judgment: { ...judgment(), models: [] } },
      { ...b, judgment: { ...judgment(), models: [] } },
    ],
    [a, { ...b, judgment: { ...judgment(), issues: ["incomplete stretch"] } }],
    [a, { ...b, judgment: null }],
    [
      a,
      {
        ...b,
        judgment: { ...judgment(), result: { ok: false, stage: "request", reason: "timeout" } },
      },
    ],
  ];
  for (const rows of cases)
    expect(summarizePairs(rows)).toMatchObject({ completePairs: 0, excludedPairs: 1 });
});
