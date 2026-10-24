import { expect, test } from "bun:test";
import { createBashTool, type ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { eligibleCapture, makePreview } from "../../../extensions/tool-output/policy";
import { median, type Row, summarize } from "../evaluate";
import { checkAnswer, FIXTURES } from "../fixtures";
import { SEARCH_FIXTURES } from "../search-fixtures";

test("fixtures exercise actual eligible previews and intentional fallbacks without native truncation", async () => {
  for (const fixture of [...FIXTURES, ...SEARCH_FIXTURES]) {
    const bash = createBashTool("/tmp", {
      operations: {
        exec: async (_command, _cwd, { onData }) => {
          onData(Buffer.from(fixture.output));
          return { exitCode: fixture.exitCode };
        },
      },
    });
    const native = await bash.execute("fixture", { command: "inspect-fixture" });
    const event: ToolResultEvent = {
      ...native,
      type: "tool_result",
      toolName: "bash",
      toolCallId: "fixture",
      input: { command: "inspect-fixture" },
      isError: native.isError === true,
    };
    expect(native.structuredContent).toMatchObject({
      truncated: false,
      exit_code: fixture.exitCode,
    });
    const eligible = eligibleCapture(event);
    const preview =
      eligible === undefined
        ? undefined
        : makePreview(eligible.text, "/tmp/private/output.txt", false, eligible);
    expect(!!preview).toBe(fixture.previewExpected);
    if (fixture.unmarkedEvidence) {
      expect(preview).toBeDefined();
      for (const value of Object.values(fixture.expected)) {
        if (typeof value === "string") expect(preview?.text).toContain(value);
      }
    }
    expect(checkAnswer(JSON.stringify(fixture.expected), fixture.expected).correct).toBe(true);
  }
});

test("answer checks require exact typed facts and reject missing, stale, or invalid answers", () => {
  expect(checkAnswer('{"allowed":true}', { allowed: false }).correct).toBe(false);
  expect(checkAnswer('{"count":"3"}', { count: 3 }).correct).toBe(false);
  expect(checkAnswer("{}", { host: "staging" }).correct).toBe(false);
  expect(checkAnswer("not json", { count: 3 }).correct).toBe(false);
  expect(checkAnswer('```json\n{"count":3}\n```', { count: 3 }).correct).toBe(true);
});

function row(overrides: Partial<Row> = {}): Row {
  return {
    fixture: "test",
    repeat: 0,
    arm: "off",
    correct: true,
    issues: [],
    reply: "{}",
    serviceFailure: false,
    mechanismValid: true,
    previewCount: 0,
    reads: 0,
    searches: 0,
    toolCalls: 1,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    estimatedCostUSD: 0.01,
    elapsedMs: 100,
    retrievedLines: 0,
    ...overrides,
  };
}
test("paired summary excludes incomplete or broken-mechanism trials and counts regressions", () => {
  const result = summarize([
    row(),
    row({ arm: "on", correct: false }),
    row({ fixture: "incomplete" }),
    row({ fixture: "transport" }),
    row({ fixture: "transport", arm: "on", serviceFailure: true }),
    row({ fixture: "inactive" }),
    row({ fixture: "inactive", arm: "on", mechanismValid: false }),
  ]);
  expect(result.completePairs).toBe(1);
  expect(result.regressions).toEqual(["test/0"]);
  expect(result.excluded).toHaveLength(3);
  expect(result.off.correct).toBe(1);
  expect(result.on.correct).toBe(0);
});

test("median handles even, odd, and empty trial sets", () => {
  expect(median([5, 1, 3, 7])).toBe(4);
  expect(median([5, 1, 3])).toBe(3);
  expect(median([])).toBeNull();
});

test("counter-search fixtures require evidence that repetition collapse does not expose", () => {
  for (const fixture of SEARCH_FIXTURES) {
    const preview = makePreview(fixture.output, "/private/output.txt");
    expect(preview).toBeDefined();
    for (const [key, present] of Object.entries(fixture.expected)) {
      if (typeof present !== "boolean")
        throw new Error("Counter fixtures require boolean ground truth");
      const counter = key.replace("scan", "");
      const literal = `scan ${counter}:`;
      expect(fixture.output.includes(literal)).toBe(present);
      expect(preview?.text).not.toContain(literal);
    }
  }
});
