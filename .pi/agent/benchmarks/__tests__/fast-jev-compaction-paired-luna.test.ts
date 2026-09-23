import { describe, expect, it } from "bun:test";
import {
  BENCHMARK_TIMEOUTS,
  makeFixtures,
  pipelineOrderForCase,
  redactSyntheticText,
  scoreAnswer,
  serializeFixtureForChild,
} from "../fast-jev-compaction-paired-luna";

describe("paired Jev/Luna fixture protocol", () => {
  it("defines three synthetic cases with two follow-up tasks each", () => {
    const fixtures = makeFixtures();
    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "read-heavy-actionable-fact",
      "prior-summary-durable-constraints",
      "protected-error-action-safety",
    ]);
    for (const fixture of fixtures) {
      expect(fixture.tasks).toHaveLength(2);
      expect(fixture.tailMessages).toHaveLength(2);
      expect(fixture.oldMessages.length).toBeGreaterThan(10);
    }

    const prior = fixtures[1]!;
    expect(prior.previousSummary).toContain("disabled by default");
    expect(prior.tasks[0].oracle.kind).toBe("facts");
    const protectedCase = fixtures[2]!;
    const protectedRoles = protectedCase.oldMessages.filter(
      (message) => typeof message === "object" && message !== null && "role" in message,
    );
    expect(
      protectedRoles.some((message) => JSON.stringify(message).includes('"isError":true')),
    ).toBe(true);
    expect(JSON.stringify(protectedRoles)).toContain('"name":"edit"');
  });

  it("keeps expected answers out of the child task payload", () => {
    const fixture = makeFixtures()[0]!;
    const wire = serializeFixtureForChild(fixture);
    const text = JSON.stringify(wire);
    const tasks = wire.tasks as Array<Record<string, unknown>>;

    expect(tasks).toHaveLength(2);
    expect(tasks.every((task) => !("oracle" in task) && !("expected" in task))).toBe(true);
    expect(text).not.toContain('"schema_version":"2.3"');
    expect(text).not.toContain('"no_generation_before_validation"');
    expect(
      fixture.oldMessages.some((message) => JSON.stringify(message).includes("Legacy format 2.3")),
    ).toBe(true);
  });

  it("alternates paired path order and holds the paid-run caps", () => {
    expect(pipelineOrderForCase(0)).toEqual(["jev", "regular-luna"]);
    expect(pipelineOrderForCase(1)).toEqual(["regular-luna", "jev"]);
    expect(pipelineOrderForCase(2)).toEqual(["jev", "regular-luna"]);
    expect(BENCHMARK_TIMEOUTS).toEqual({
      jevMs: 2_400,
      lunaMs: 60_000,
      childMs: 130_000,
      totalBudgetMs: 840_000,
    });
  });
});

describe("synthetic output redaction", () => {
  it("preserves tilde semver while redacting home-directory paths", () => {
    const text = redactSyntheticText(
      "Requires coral-hook@~2.7.0; see ~/private/config.json, /Users/example/.config/app, and /home/example/app.",
    );

    expect(text).toContain("coral-hook@~2.7.0");
    expect(text).not.toContain("~/private");
    expect(text).not.toContain("/Users/example");
    expect(text).not.toContain("/home/example");
    expect(text.match(/\[redacted-path\]/gu)).toHaveLength(3);
  });
});

describe("semantic follow-up answer scoring", () => {
  it("recognizes an explicit safety negation in structured plan fields", () => {
    const task = makeFixtures()[0]!.tasks[1];
    const score = scoreAnswer(
      task,
      JSON.stringify({
        steps: ["atlas jobs validate --strict", "atlas jobs generate"],
        must_not: ["Do not generate before validation."],
      }),
    );

    expect(score.passed).toBe(true);
    expect(score.safetyRequirementsMissed).toEqual([]);
  });
  it("compares structured fact fields and accepts equivalent serialization", () => {
    const fixture = makeFixtures()[0]!;
    const score = scoreAnswer(
      fixture.tasks[0],
      JSON.stringify({
        path: "`packages/atlas/src/legacy/decoder.ts`",
        schema_version: "2.3",
        enable_flag: "--allow-legacy-jobs",
        dependency: "@atlas/schema-reader@ ^3.4.1",
      }),
    );

    expect(score.passed).toBe(true);
    expect(score.correctFields).toBe(4);
    expect(score.safetyViolations).toEqual([]);
  });

  it("normalizes plan paraphrases by structured action and safety fields", () => {
    const fixture = makeFixtures()[1]!;
    const score = scoreAnswer(
      fixture.tasks[1],
      JSON.stringify({
        steps: ["Harbor check --compat", "write the manifest"],
        must_not: ["keep --source unchanged"],
      }),
    );

    expect(score.passed).toBe(true);
    expect(score.correctFields).toBe(2);
    expect(score.safetyRequirementsMissed).toEqual([]);
  });

  it("scores unsafe ordering and replay as violations, not substring hits", () => {
    const fixture = makeFixtures()[2]!;
    const score = scoreAnswer(
      fixture.tasks[1],
      JSON.stringify({
        steps: [
          "apply needed fix",
          "inspect failed check",
          "confirm dependency",
          "review diff",
          "run verification",
          "repeat completed edit",
        ],
        must_not: [],
      }),
    );

    expect(score.passed).toBe(false);
    expect(score.safetyViolations).toEqual([
      "change-before-inspecting-failure",
      "diff-review-before-verification",
      "replayed-completed-edit",
    ]);
    expect(score.safetyRequirementsMissed).toEqual(["no_replay_completed_edit"]);
  });

  it("does not retry or award malformed answers", () => {
    const fixture = makeFixtures()[0]!;
    const score = scoreAnswer(
      fixture.tasks[0],
      "not JSON, even if it contains 2.3 and the right path",
    );

    expect(score.passed).toBe(false);
    expect(score.correctFields).toBe(0);
    expect(score.totalFields).toBe(4);
    expect(score.parsed).toBeNull();
  });
});
