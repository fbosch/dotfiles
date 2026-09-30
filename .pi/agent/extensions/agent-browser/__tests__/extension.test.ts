import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import {
  createJevClassifierRequester,
  type JevClassifierRegistry,
} from "../../../lib/jev-classifier";
import {
  browserArgs,
  createDecisionRequest,
  createRunAuthorizationRequest,
  createStepSafetyRequest,
  parseClickCandidates,
  parseRunCandidates,
} from "../index";

let registry: ModelRegistry;
let agentDirectory: string;
beforeAll(async () => {
  registry = await createNativeClassifierRegistry();
});
beforeEach(() => {
  agentDirectory = mkdtempSync(join(tmpdir(), "agent-browser-jev-test-"));
});
afterEach(() => rmSync(agentDirectory, { recursive: true, force: true }));

function classifierResult(answers: Record<string, ClassifierAnswer>): ClassifierResult {
  return {
    api: "typesafe-system-one",
    provider: "openrouter",
    model: "typesafe/jev-1.13",
    timestamp: Date.now(),
    stopReason: "stop",
    answers,
  };
}

function registryWithClassifier(
  classify: JevClassifierRegistry["classify"],
): JevClassifierRegistry {
  return { findOfType: registry.findOfType.bind(registry), classify };
}

describe("agent-browser extension", () => {
  test("always scopes commands to a sanitized Lightpanda session", () => {
    expect(browserArgs("session/id with spaces", ["open", "https://example.com"])).toEqual([
      "--engine",
      "lightpanda",
      "--session",
      "pi-session-id-with-spaces",
      "open",
      "https://example.com",
    ]);
  });

  test("uses native choice and bool contexts and preserves SDK answer shapes", async () => {
    const click = parseClickCandidates('- link "Learn more" [ref=e1]')[0];
    const submit = parseRunCandidates('- button "Submit" [ref=e2]')[0];
    if (!click || !submit) throw new Error("expected browser candidates");

    const contexts: ClassifierContext[] = [
      createDecisionRequest({
        objective: "Open settings",
        pageState: '- button "Menu" [ref=e1]',
        actions: [{ id: "menu", description: "Click @e1 to open the menu" }],
      }),
      createStepSafetyRequest("Read more", "page", click),
      createRunAuthorizationRequest("Submit the form", "page", submit),
    ];
    expect(contexts.map(({ questions }) => Object.values(questions)[0]?.type)).toEqual([
      "choice",
      "bool",
      "bool",
    ]);

    const seen: ClassifierContext[] = [];
    const request = createJevClassifierRequester(Date.now, agentDirectory);
    const nativeRegistry = registryWithClassifier(async (_model, input) => {
      seen.push(input);
      const [questionId, question] = Object.entries(input.questions)[0] ?? [];
      if (!questionId || !question) throw new Error("expected a classifier question");
      const answer: ClassifierAnswer =
        question.type === "choice"
          ? {
              type: "choice",
              choice: "menu",
              probabilities: { menu: 0.9, no_action: 0.1 },
              confidence: 0.9,
            }
          : { type: "bool", probability: 0.96 };
      return classifierResult({ [questionId]: answer });
    });

    const results = await Promise.all(contexts.map((context) => request(nativeRegistry, context)));
    expect(seen).toEqual(contexts);
    expect(results.every((result) => result.ok)).toBe(true);
    if (!results.every((result) => result.ok)) throw new Error("native classifier request failed");
    expect(results[0]?.value.answers.next_action).toEqual({
      type: "choice",
      choice: "menu",
      probabilities: { menu: 0.9, no_action: 0.1 },
      confidence: 0.9,
    });
    expect(results[1]?.value.answers.navigation_only).toEqual({ type: "bool", probability: 0.96 });
    expect(results[2]?.value.answers.authorized).toEqual({ type: "bool", probability: 0.96 });
  });
});
