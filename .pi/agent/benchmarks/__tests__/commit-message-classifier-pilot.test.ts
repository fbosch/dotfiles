import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeClassifierRegistry } from "../../lib/__tests__/native-classifier-registry";
import {
  type CommitMessagePilotCase,
  loadCommitMessagePilotCases,
  runCommitMessageClassifierPilot,
} from "../commit-message-classifier-pilot";

const modelRegistryPromise = createNativeClassifierRegistry();

function pilotCase(overrides: Partial<CommitMessagePilotCase> = {}): CommitMessagePilotCase {
  return {
    id: "case-pass",
    sourceResult: "fixture.json",
    taskId: "task-1",
    taskName: "A bounded commit-message case",
    rubric: "Pass when the candidate is concise and accurate.",
    output: "fix(session): reject expired sessions",
    deterministicPass: true,
    existingJudgePass: true,
    ...overrides,
  };
}

describe("commit-message Classifier pilot", () => {
  test("compares one bounded Classifier request with deterministic and existing judge results", async () => {
    const modelRegistry = await modelRegistryPromise;
    let requestBody: Record<string, unknown> | undefined;
    const report = await runCommitMessageClassifierPilot(
      [
        pilotCase(),
        pilotCase({ id: "case-fail", deterministicPass: false, existingJudgePass: false }),
      ],
      {
        modelRegistry,
        fetch: async (_input, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              answers: {
                case_0: { type: "noul", noul: 0.96 },
                case_1: { type: "noul", noul: 0.04 },
              },
              usage: { input_tokens: 300, output_tokens: 20 },
            }),
          );
        },
      },
    );

    expect(report.gatewayFailure).toBeUndefined();
    expect(report.usage).toEqual({ inputTokens: 300, outputTokens: 20 });
    expect(report.comparisons.map((comparison) => comparison.classifierVerdict)).toEqual([
      "pass",
      "fail",
    ]);
    expect(
      report.comparisons.every((comparison) => comparison.disagreesWithDeterministic === false),
    ).toBe(true);
    expect(
      report.comparisons.every((comparison) => comparison.disagreesWithExistingJudge === false),
    ).toBe(true);

    const state = (requestBody?.state ?? {}) as Record<string, unknown>;
    expect(Array.isArray(state.cases)).toBe(true);
  });

  test("keeps Classifier advisory when it disagrees or returns an unusable response", async () => {
    const modelRegistry = await modelRegistryPromise;
    const disagree = await runCommitMessageClassifierPilot(
      [pilotCase({ deterministicPass: false })],
      {
        modelRegistry,
        fetch: async () =>
          new Response(JSON.stringify({ answers: { case_0: { type: "noul", noul: 0.99 } } })),
      },
    );
    expect(disagree.comparisons[0]).toMatchObject({
      classifierVerdict: "pass",
      falsePass: true,
      disagreesWithDeterministic: true,
    });

    const unavailable = await runCommitMessageClassifierPilot([pilotCase()], {
      modelRegistry,
      fetch: async () => new Response(JSON.stringify({ answers: {} })),
    });
    expect(unavailable.gatewayFailure).toMatchObject({
      stage: "request",
      reason: "request-failure",
    });
    expect(unavailable.comparisons[0]?.classifierVerdict).toBe("unavailable");
    expect(unavailable.comparisons[0]?.disagreesWithDeterministic).toBeNull();
  });

  test("returns a safe gateway failure without raw auth details", async () => {
    const registry = await modelRegistryPromise;
    const report = await runCommitMessageClassifierPilot([pilotCase()], {
      modelRegistry: {
        findOfType: registry.findOfType.bind(registry),
        classify: async () => {
          throw new Error("secret auth detail");
        },
      },
    });
    expect(report.gatewayFailure).toMatchObject({ stage: "auth", reason: "auth-failure" });
    expect(JSON.stringify(report)).not.toContain("secret auth detail");
  });

  test("loads bounded existing attempts and preserves the eval rubric", async () => {
    const root = await mkdtemp(join(tmpdir(), "commit-message-classifier-pilot-"));
    try {
      const specPath = join(root, "commit-message.eval.yaml");
      const resultPath = join(root, "result.json");
      await writeFile(
        specPath,
        [
          "tasks:",
          "  - name: First case",
          "    expect: The first rubric",
          "  - name: Second case",
          "    expect: The second rubric",
        ].join("\n"),
      );
      await writeFile(
        resultPath,
        JSON.stringify({
          task_results: [
            {
              task_id: "task-001",
              attempts: [
                {
                  attempt: 1,
                  output: "fix(session): reject expired sessions",
                  assert_passed: true,
                  autorater_passed: true,
                },
              ],
            },
            {
              task_id: "task-002",
              attempts: [
                {
                  attempt: 1,
                  output: "bad",
                  assert_passed: false,
                  autorater_passed: false,
                },
              ],
            },
          ],
        }),
      );

      const cases = await loadCommitMessagePilotCases({
        specPath,
        resultPaths: [resultPath],
        limit: 2,
      });
      expect(cases).toHaveLength(2);
      expect(cases.map((pilotCase) => pilotCase.rubric)).toEqual([
        "The first rubric",
        "The second rubric",
      ]);
      expect(cases.map((pilotCase) => pilotCase.deterministicPass)).toEqual([true, false]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
