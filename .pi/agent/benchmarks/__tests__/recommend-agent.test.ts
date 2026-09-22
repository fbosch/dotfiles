import { describe, expect, test } from "bun:test";
import {
  RECOMMEND_AGENT_BENCHMARK_CASES,
  RECOMMEND_AGENT_BENCHMARK_CATALOG,
} from "../recommend-agent-fixtures";

describe("recommend agent benchmark fixtures", () => {
  test("uses actual agent ids and covers conservative routing controls", () => {
    const ids = new Set(RECOMMEND_AGENT_BENCHMARK_CATALOG.map(({ id }) => id));
    expect(
      ["analyze", "explore", "validate", "test", "review", "debug", "lookup", "research"].every(
        (id) => ids.has(id),
      ),
    ).toBe(true);
    expect(RECOMMEND_AGENT_BENCHMARK_CASES.some(({ relevant }) => relevant[0] === "stay")).toBe(
      true,
    );
    expect(RECOMMEND_AGENT_BENCHMARK_CASES.some(({ relevant }) => relevant[0] === "abstain")).toBe(
      true,
    );
    expect(
      RECOMMEND_AGENT_BENCHMARK_CASES.some(
        ({ explicitSkillInvocation }) => explicitSkillInvocation === true,
      ),
    ).toBe(true);
    expect(RECOMMEND_AGENT_BENCHMARK_CASES.some(({ denied }) => denied?.length === 1)).toBe(true);
  });

  test("does not put fixture labels in evaluator-facing task or intent text", () => {
    for (const testCase of RECOMMEND_AGENT_BENCHMARK_CASES) {
      const evaluatorText = `${testCase.task} ${testCase.intent}`;
      expect(evaluatorText).not.toContain(testCase.name);
    }
  });
});
