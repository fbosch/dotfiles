import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { type ClassifierRegistry, createClassifierRequester } from "../../../lib/classifier";
import type { BrowserBackend } from "../backends";
import agentBrowserExtension from "../index";
import { browserFixture } from "./browser-fixture";

let registry: ModelRegistry;
let agentDirectory: string;
beforeAll(async () => {
  registry = await createNativeClassifierRegistry();
});
beforeEach(() => {
  agentDirectory = mkdtempSync(join(tmpdir(), "browser-workflow-test-"));
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
function choose(input: ClassifierContext, probability = 0.99): Record<string, ClassifierAnswer> {
  const question = input.questions.next_action;
  if (question?.type !== "choice") throw new Error("Expected next_action choice");
  const ids = Object.keys(question.criteria);
  const choice = ids.find((id) => id !== "no_action");
  if (!choice) throw new Error("Expected action candidate");
  return {
    next_action: {
      type: "choice",
      choice,
      confidence: probability,
      probabilities: Object.fromEntries(
        ids.map((id) => [id, id === choice ? probability : (1 - probability) / (ids.length - 1)]),
      ),
    },
  };
}
function workflow(
  backend: BrowserBackend,
  respond: (input: ClassifierContext) => Record<string, ClassifierAnswer>,
) {
  const f = browserFixture(backend);
  const requests: ClassifierContext[] = [];
  const classify: ClassifierRegistry["classify"] = async (_model, input) => {
    requests.push(input);
    return classifierResult(respond(input));
  };
  const modelRegistry = {
    findOfType: registry.findOfType.bind(registry),
    classify,
  } as ModelRegistry;
  const ctx = { ...f.ctx, modelRegistry };
  agentBrowserExtension(f.pi, createClassifierRequester(Date.now, agentDirectory));
  const target = backend === "agent-browser" ? {} : { backend, pageId: 3 };
  const execute = (name: string, params: Record<string, unknown>) =>
    f.getTool(name).execute("workflow", { ...target, ...params }, undefined, undefined, ctx);
  return { ...f, requests, execute };
}

for (const backend of ["agent-browser", "chrome", "firefox"] as const) {
  describe(`${backend} shared classifier workflows`, () => {
    test("fills a unique explicit input once despite changing MCP refs, without sending its secret to a classifier", async () => {
      const f = workflow(backend, () => {
        throw new Error("A unique input must not invoke the classifier");
      });
      f.state.controls = ["email"];
      const secret = "fixture-secret-123";
      const result = await f.execute("browser_run", {
        objective: "Fill the email field",
        inputs: [{ name: "email", value: secret, sensitive: true }],
        maxSteps: 5,
      });
      expect(f.actions.map(({ value }) => value)).toEqual([secret]);
      expect(f.requests).toHaveLength(0);
      expect(result.details).toMatchObject({
        stopReason: "no_candidates",
        trace: [expect.objectContaining({ step: 1, selectionMode: "deterministic" })],
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    });

    test("shares choice and independent click authorization across a fill-and-submit workflow", async () => {
      const f = workflow(backend, (input) =>
        input.questions.next_action
          ? choose(input)
          : { authorized: { type: "bool", probability: 0.99 } },
      );
      f.state.controls = ["email", "submit"];
      const secret = 'fixture-secret-456"\\\næøå';
      const result = await f.execute("browser_run", {
        objective: "Fill the email and submit",
        inputs: [{ name: "email", value: secret, sensitive: true }],
        maxSteps: 3,
      });
      expect(f.actions.map(({ action }) => action.replace("_by_uid", ""))).toEqual([
        "fill",
        "click",
      ]);
      expect(f.requests.map(({ questions }) => Object.keys(questions))).toEqual([
        ["next_action"],
        ["authorized"],
      ]);
      expect(result.details).toMatchObject({
        trace: [expect.objectContaining({ step: 1 }), expect.objectContaining({ step: 2 })],
        stopReason: "no_candidates",
      });
      expect(JSON.stringify(result)).not.toContain("fixture-secret-456");
      expect(JSON.stringify(f.requests)).not.toContain("fixture-secret-456");
      expect(JSON.stringify(f.requests)).toContain("Actions already completed");
    });

    test("blocks selected clicks when independent authorization is uncertain", async () => {
      const f = workflow(backend, (input) =>
        input.questions.next_action
          ? choose(input)
          : { authorized: { type: "bool", probability: 0.1 } },
      );
      f.state.controls = ["submit"];
      const result = await f.execute("browser_run", { objective: "Review the page", maxSteps: 1 });
      expect(f.actions).toHaveLength(0);
      expect(f.requests).toHaveLength(2);
      expect(result.details).toMatchObject({ trace: [], stopReason: "unauthorized_or_uncertain" });
    });

    test("blocks low-confidence selection before requesting authorization or acting", async () => {
      const f = workflow(backend, (input) => choose(input, 0.6));
      f.state.controls = ["learn"];
      const result = await f.execute("browser_run", { objective: "Read the docs", maxSteps: 1 });
      expect(f.actions).toHaveLength(0);
      expect(f.requests).toHaveLength(1);
      expect(result.details).toMatchObject({ trace: [], stopReason: "low_confidence" });
    });

    test("retains the stricter navigation-only gate for browser_step", async () => {
      const f = workflow(backend, (input) =>
        input.questions.next_action
          ? choose(input)
          : { navigation_only: { type: "bool", probability: 0.01 } },
      );
      f.state.controls = ["submit"];
      const result = await f.execute("browser_step", { objective: "Read the form" });
      expect(f.actions).toHaveLength(0);
      expect(f.requests.map(({ questions }) => Object.keys(questions))).toEqual([
        ["next_action"],
        ["navigation_only"],
      ]);
      expect(result.details).toMatchObject({ executed: false });
    });

    test("executes an authorized navigation once and returns a fresh snapshot", async () => {
      const f = workflow(backend, (input) =>
        input.questions.next_action
          ? choose(input)
          : { navigation_only: { type: "bool", probability: 0.99 } },
      );
      f.state.controls = ["learn"];
      const result = await f.execute("browser_step", { objective: "Read the docs" });
      expect(f.actions.map(({ action }) => action.replace("_by_uid", ""))).toEqual(["click"]);
      expect(result.details).toMatchObject({ executed: true });
      expect(f.getTool("browser_step").executionMode).toBe("sequential");
    });

    test("redacts supplied sensitive values from native action failures", async () => {
      const f = workflow(backend, () => {
        throw new Error("Classifier must not be called");
      });
      f.state.controls = ["email"];
      f.state.failTool = backend === "firefox" ? "fill_by_uid" : "fill";
      f.state.failMessage = "Rejected fixture-secret-789";
      await expect(
        f.execute("browser_run", {
          objective: "Fill email",
          inputs: [{ name: "email", value: "fixture-secret-789", sensitive: true }],
        }),
      ).rejects.toThrow("Rejected [redacted:email]");
      expect(f.actions).toHaveLength(0);
      expect(f.requests).toHaveLength(0);
    });
  });
}
