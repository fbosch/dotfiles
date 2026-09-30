import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext, ClassifierResult, Usage } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { OPENROUTER_GATEWAY_ENDPOINT, VERCEL_GATEWAY_ENDPOINT } from "../../../lib/jev-gateway";
import {
  classifyJevQuestion,
  type JevClassifierRegistry,
  normalizeQuestionInput,
  normalizeQuestionResponse,
} from "../index";

const request: ClassifierContext = {
  state: { ticket: "Payouts have been failing for 3 days" },
  questions: {
    urgent: {
      type: "bool",
      instructions: "Is this urgent?",
      criteria: { true: "Time-sensitive", false: "Not urgent" },
    },
    team: {
      type: "choice",
      instructions: "Which team?",
      criteria: { billing: "Payments", support: "Other" },
    },
    frustration: {
      type: "score",
      instructions: "How frustrated?",
      criteria: ["Calm", "Frustrated", "Angry"],
    },
  },
};
const response = {
  answers: {
    urgent: { type: "bool" as const, probability: 0.9 },
    team: {
      type: "choice" as const,
      choice: "billing",
      probabilities: { billing: 0.8, support: 0.2 },
      confidence: 0.8,
    },
    frustration: { type: "score" as const, score: 1.2, confidence: 0.6 },
  },
};
const wireResponse = {
  answers: {
    ...response.answers,
    urgent: { type: "noul", noul: 0.9 },
    frustration: {
      ...response.answers.frustration,
      probabilities: { "0": 0.1, "1": 0.6, "2": 0.3 },
      legend: { "0": "Calm", "1": "Frustrated", "2": "Angry" },
    },
  },
  usage: { input_tokens: 100, output_tokens: 12 },
};
let registry: ModelRegistry;
let agentDirectory: string;
beforeAll(async () => {
  registry = await createNativeClassifierRegistry();
});
beforeEach(() => {
  agentDirectory = mkdtempSync(join(tmpdir(), "native-jev-test-"));
});
afterEach(() => rmSync(agentDirectory, { recursive: true, force: true }));

function result(usage?: Usage): ClassifierResult {
  return {
    api: "typesafe-system-one",
    provider: "openrouter",
    model: "typesafe/jev-1.13",
    timestamp: Date.now(),
    stopReason: "stop",
    ...response,
    ...(usage ? { usage } : {}),
  };
}

function stub(classify: JevClassifierRegistry["classify"]): JevClassifierRegistry {
  return { findOfType: registry.findOfType.bind(registry), classify };
}

function writeSettings(settings: unknown): void {
  writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify(settings));
}

describe("typesafe_question native classifiers", () => {
  test("uses Pi's auth, adapter, bool mapping, score normalization, and catalog-priced usage", async () => {
    let calledUrl = "";
    let sent: unknown;
    const output = await classifyJevQuestion(request, registry, {
      agentDirectory,
      fetch: async (url, init) => {
        calledUrl = String(url);
        sent = JSON.parse(String(init?.body));
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer native-classifier-test-key",
        );
        return new Response(JSON.stringify(wireResponse));
      },
    });
    expect(calledUrl).toBe(OPENROUTER_GATEWAY_ENDPOINT);
    expect(sent).toMatchObject({
      state: request.state,
      model: "typesafe/jev-1.13",
      questions: { urgent: { ...request.questions.urgent, type: "noul" } },
    });
    expect(output.answers).toEqual(response.answers);
    expect(output.answers.frustration).not.toHaveProperty("probabilities");
    expect(output.answers.frustration).not.toHaveProperty("legend");
    expect(output.usage).toMatchObject({ input: 100, output: 12, totalTokens: 112 });
    expect(output.usage?.cost.total).toBeGreaterThan(0);
  });

  test("honors configured provider order and falls back through native adapters", async () => {
    writeSettings({
      jev: {
        providers: [
          { provider: "vercel-ai-gateway", model: "typesafe-ai/jev" },
          { provider: "openrouter", model: "typesafe/jev-1.13" },
        ],
      },
    });
    const urls: string[] = [];
    const output = await classifyJevQuestion(request, registry, {
      agentDirectory,
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(wireResponse), {
          status: urls.length === 1 ? 400 : 200,
        });
      },
    });
    expect(urls).toEqual([VERCEL_GATEWAY_ENDPOINT, OPENROUTER_GATEWAY_ENDPOINT]);
    expect(output.answers).toEqual(response.answers);
  });

  test("rejects old contracts, unknown fields, invalid names, and non-JSON or oversized state before classification", async () => {
    let calls = 0;
    const fake = stub(async () => {
      calls++;
      return result();
    });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const invalid of [
      { ...request, state: null },
      { ...request, state: "plain text" },
      { ...request, state: [] },
      { ...request, state: { text: "x".repeat(65_000) } },
      { ...request, state: { value: Number.NaN } },
      { ...request, state: cycle },
      { ...request, questions: {} },
      { ...request, questions: { "bad key": request.questions.urgent } },
      { ...request, questions: { urgent: { type: "noul", instructions: "Urgent?" } } },
      {
        ...request,
        questions: { urgent: { ...request.questions.urgent, instructions: ["Urgent?"] } },
      },
      {
        ...request,
        questions: { team: { type: "choice", instructions: "Pick", criteria: { one: "One" } } },
      },
      {
        ...request,
        questions: {
          team: { type: "choice", instructions: "Pick", criteria: { one: null, two: "Two" } },
        },
      },
      { ...request, questions: { urgent: { type: "bool", instructions: "Urgent?" } } },
      { ...request, extra: true },
    ]) {
      await expect(classifyJevQuestion(invalid, fake, { agentDirectory })).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  test("rejects malformed provider preferences before classification", async () => {
    writeSettings({ jev: { providers: [] } });
    let calls = 0;
    await expect(
      classifyJevQuestion(
        request,
        stub(async () => {
          calls++;
          return result();
        }),
        {
          agentDirectory,
        },
      ),
    ).rejects.toThrow("invalid-config");
    expect(calls).toBe(0);
  });

  test("validates native answer bounds, completeness, and choice consistency", () => {
    const input = normalizeQuestionInput(request);
    for (const answers of [
      { ...response.answers, urgent: { type: "bool", probability: 1.1 } },
      { ...response.answers, urgent: { type: "bool", probability: Number.NaN } },
      { ...response.answers, team: { ...response.answers.team, choice: "support" } },
      {
        ...response.answers,
        team: { ...response.answers.team, probabilities: { billing: 0.4, support: 0.4 } },
      },
      { ...response.answers, frustration: { ...response.answers.frustration, score: 3 } },
      { ...response.answers, frustration: { ...response.answers.frustration, confidence: -1 } },
      { urgent: response.answers.urgent },
      { ...response.answers, extra: response.answers.urgent },
    ]) {
      expect(() => normalizeQuestionResponse({ answers, secret: "do not expose" }, input)).toThrow(
        /Jev/,
      );
    }
  });

  test("never exposes native provider error messages or raw response data", async () => {
    await expect(
      classifyJevQuestion(
        request,
        stub(async () => ({
          ...result(),
          stopReason: "error",
          errorMessage: "Bearer private-token response-body",
        })),
        { agentDirectory },
      ),
    ).rejects.toThrow("classifier-unavailable");
    try {
      await classifyJevQuestion(
        request,
        stub(async () => {
          throw new Error("private-token");
        }),
        { agentDirectory },
      );
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).not.toContain("private-token");
    }
  });

  test("does not classify after caller cancellation and does not fall back on in-flight cancellation", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fake = stub(async () => {
      calls++;
      controller.abort();
      return result();
    });
    await expect(
      classifyJevQuestion(request, fake, { agentDirectory, signal: controller.signal }),
    ).rejects.toThrow("caller-cancellation");
    expect(calls).toBe(1);
    calls = 0;
    await expect(
      classifyJevQuestion(request, fake, { agentDirectory, signal: controller.signal }),
    ).rejects.toThrow("caller-cancellation");
    expect(calls).toBe(0);
  });

  test("bounds an uncooperative primary and gives the fallback the remaining budget", async () => {
    let calls = 0;
    const fake = stub(async (_model, _input, options) => {
      calls++;
      if (calls === 1) return new Promise<ClassifierResult>(() => {});
      expect(options?.signal?.aborted).toBe(false);
      return result();
    });
    const output = await classifyJevQuestion(request, fake, { agentDirectory, timeoutMs: 60 });
    expect(calls).toBe(2);
    expect(output.answers).toEqual(response.answers);
  });

  test("bounds a single uncooperative provider with the full deadline", async () => {
    writeSettings({ jev: { providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }] } });
    await expect(
      classifyJevQuestion(
        request,
        stub(async () => new Promise<ClassifierResult>(() => {})),
        {
          agentDirectory,
          timeoutMs: 30,
        },
      ),
    ).rejects.toThrow("timeout");
  });

  test("retains reported usage from a failed billed attempt when falling back", async () => {
    const usage: Usage = {
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 12,
      cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
    };
    let calls = 0;
    const output = await classifyJevQuestion(
      request,
      stub(async () => ({
        ...result(usage),
        stopReason: ++calls === 1 ? "error" : "stop",
      })),
      { agentDirectory },
    );
    expect(output.usage).toMatchObject({
      input: 20,
      output: 4,
      totalTokens: 24,
      cost: { total: 0.6 },
    });
  });
});
