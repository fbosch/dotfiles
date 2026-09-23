import { describe, expect, it } from "bun:test";
import {
  extensionSource,
  makePositionalFixtures,
  redactSyntheticText,
  POSITIONAL_BENCHMARK_LIMITS,
  scorePositionalAnswer,
  serializeFixtureForChild,
} from "../fast-jev-compaction-positional";

describe("positional Jev retention fixtures", () => {
  it("holds the approved live-call caps and uses sequential, no-retry requests", () => {
    expect(POSITIONAL_BENCHMARK_LIMITS).toEqual({
      maxCompactions: 6,
      maxFollowups: 12,
      followupsPerCompaction: 2,
      maxJevHttpRequests: 6,
      maxJevHttpPerCompaction: 1,
      maxCompactionsPerPass: 3,
      jevTimeoutMs: 2_400,
      followupTimeoutMs: 60_000,
      childTimeoutMs: 140_000,
      totalBudgetMs: 840_000,
      sequentialCompactions: true,
      retries: 0,
      summaryModelFallbackRequests: 0,
    });
  });

  it("uses the same synthetic fact record at the beginning, middle, and end", () => {
    const fixtures = makePositionalFixtures();
    expect(fixtures.map((fixture) => fixture.position)).toEqual([
      "beginning",
      "middle",
      "end",
      "beginning",
      "middle",
      "end",
    ]);
    for (const position of ["beginning", "middle", "end"] as const) {
      const pair = fixtures.filter((fixture) => fixture.position === position);
      expect(pair).toHaveLength(2);
      expect(pair[0]?.factRecord).toBe(pair[1]?.factRecord);
      for (const fixture of pair) {
        const offset = fixture.targetResult.indexOf(fixture.factRecord);
        expect(fixture.targetResult.length).toBeGreaterThan(240);
        if (position === "beginning") expect(offset).toBe(0);
        else expect(offset).toBeGreaterThan(240);
        if (position === "end")
          expect(fixture.targetResult.endsWith(fixture.factRecord)).toBe(true);
      }
    }
  });

  it("keeps fixture seed and oracle separate from the child's task payload", () => {
    const fixtures = makePositionalFixtures();
    for (const fixture of fixtures) {
      const child = serializeFixtureForChild(fixture);
      const wire = JSON.stringify(child);
      const tasks = child.tasks as Array<Record<string, unknown>>;
      const taskPayload = JSON.stringify(tasks);
      expect(wire).not.toContain("oracle");
      expect(taskPayload).not.toContain("5.7.3");
      expect(taskPayload).not.toContain("quartz verify --abi");
      expect(taskPayload).not.toContain("quartz publish --channel edge");
      expect(taskPayload).not.toContain("./dist/quartz/manifest.json");
      expect(fixture.targetResult.match(/5\.7\.3/gu)).toHaveLength(1);
      expect(fixture.targetResult.match(/quartz verify --abi/gu)).toHaveLength(1);
      expect(fixture.targetResult.match(/quartz publish --channel edge/gu)).toHaveLength(1);
      expect(fixture.targetResult.match(/\.\/dist\/quartz\/manifest\.json/gu)).toHaveLength(1);
      expect(fixture.tasks).toHaveLength(2);
    }
  });
});

describe("positional deterministic answer scorer", () => {
  it("requires every fact field to match exactly", () => {
    const task = makePositionalFixtures()[0]!.tasks[0];
    const score = scorePositionalAnswer(
      task,
      JSON.stringify({
        artifact_version: "5.7.3",
        verification_command: "quartz verify --abi",
        publish_command: "quartz publish --channel edge",
        manifest_path: "./dist/quartz/manifest.json",
      }),
    );
    expect(score.status).toBe("pass");
    expect(score.correctFields).toBe(4);
    const partial = scorePositionalAnswer(task, JSON.stringify({ artifact_version: "5.7.3" }));
    expect(partial.status).toBe("partial");
    expect(partial.correctFields).toBe(1);
    expect(partial.reason).toContain("verification_command");
  });

  it("requires exact action ordering and reports unsafe publishing", () => {
    const task = makePositionalFixtures()[0]!.tasks[1];
    const safe = scorePositionalAnswer(
      task,
      JSON.stringify({
        steps: ["quartz verify --abi", "quartz publish --channel edge"],
        must_not: ["Do not publish before ABI verification succeeds."],
      }),
    );
    expect(safe.status).toBe("pass");
    const alternateSafety = scorePositionalAnswer(
      task,
      JSON.stringify({
        steps: [],
        must_not: ["Publishing must not happen before ABI verification succeeds."],
      }),
    );
    expect(alternateSafety.status).toBe("partial");
    expect(alternateSafety.fieldChecks.must_not).toBe(true);
    const unsafe = scorePositionalAnswer(
      task,
      JSON.stringify({
        steps: ["quartz publish --channel edge", "quartz verify --abi"],
        must_not: [],
      }),
    );
    expect(unsafe.status).toBe("failed");
    expect(unsafe.safetyViolations).toEqual(["publish-before-verification"]);
    expect(unsafe.safetyRequirementsMissed).toEqual(["publish-before-verification"]);
  });

  it("does not retry or credit non-JSON answers", () => {
    const task = makePositionalFixtures()[0]!.tasks[0];
    const score = scorePositionalAnswer(task, "not JSON, even if it contains 5.7.3");
    expect(score.status).toBe("failed");
    expect(score.correctFields).toBe(0);
    expect(score.reason).toBe("answer was not valid JSON");
  });
});

describe("synthetic text redaction", () => {
  it("preserves semver tildes while redacting home paths", () => {
    const text = redactSyntheticText("Requires quartz@~2.7.0; see ~/private/config.json.");
    expect(text).toContain("quartz@~2.7.0");
    expect(text).not.toContain("~/private");
  });
});

describe("generated positional child extension", () => {
  it("compiles and enforces request budgets before network dispatch", () => {
    const source = extensionSource({ oursModule: "/tmp/synthetic-fast-jev/index.ts" });
    const compiled = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    expect(compiled).toContain("jev-http-budget-exhausted-before-fetch");
    expect(compiled).toContain("followup-budget-exhausted-before-provider-dispatch");
    expect(compiled).toContain("Jev HTTP request budget exhausted before fetch");
    expect(compiled).toContain("FOLLOWUP_BUDGET_EXHAUSTED");
  });
});
