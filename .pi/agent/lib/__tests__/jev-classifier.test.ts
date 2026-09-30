import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext } from "@earendil-works/pi-ai";
import {
  createJevClassifierRequester,
  type JevClassifierRegistry,
  OPENROUTER_PROVIDER_ID,
  VERCEL_GATEWAY_PROVIDER_ID,
} from "../jev-classifier";
import { createNativeClassifierRegistry } from "./native-classifier-registry";

const boolInput: ClassifierContext = {
  state: { query: "choose a route" },
  questions: {
    gate: {
      type: "bool",
      instructions: "Should this route be used?",
      criteria: { true: "Use it", false: "Do not use it" },
    },
  },
};

let testAgentDirectory: string | undefined;

beforeEach(() => {
  testAgentDirectory = mkdtempSync(join(tmpdir(), "jev-classifier-test-"));
});

afterEach(() => {
  if (testAgentDirectory !== undefined)
    rmSync(testAgentDirectory, { recursive: true, force: true });
  testAgentDirectory = undefined;
});

function createRequester(now: () => number = Date.now) {
  if (testAgentDirectory === undefined) throw new Error("test agent directory was not created");
  return createJevClassifierRequester(now, testAgentDirectory);
}

function writeSettings(settings: unknown): void {
  if (testAgentDirectory === undefined) throw new Error("test agent directory was not created");
  writeFileSync(join(testAgentDirectory, "settings.json"), `${JSON.stringify(settings)}\n`);
}

function classifierResponse(): Response {
  return new Response(
    JSON.stringify({
      answers: {
        gate: {
          type: "noul",
          noul: 0.9,
          trueProbability: 0.9,
          falseProbability: 0.1,
          confidence: 0.9,
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

type Lookup = { provider: string; id: string };
type Observations = {
  lookups: Lookup[];
  maxRetries: Array<number | undefined>;
};

function observeRegistry(
  registry: JevClassifierRegistry,
  observations: Observations,
): JevClassifierRegistry {
  return {
    findOfType: (type, provider, id) => {
      observations.lookups.push({ provider, id });
      return registry.findOfType(type, provider, id);
    },
    classify: (model, input, options) => {
      observations.maxRetries.push(options?.maxRetries);
      return registry.classify(model, input, options);
    },
  };
}

describe("requestJevClassifier", () => {
  test("uses native default provider order and falls back to the second provider", async () => {
    const observations: Observations = { lookups: [], maxRetries: [] };
    const registry = observeRegistry(await createNativeClassifierRegistry(), observations);
    let fetchCalls = 0;

    const result = await createRequester()(registry, boolInput, {
      fetch: async () => {
        fetchCalls += 1;
        return fetchCalls === 1
          ? new Response("unavailable", { status: 503 })
          : classifierResponse();
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: { answers: { gate: { type: "bool", probability: 0.9 } } },
    });
    expect(observations.lookups.map(({ provider }) => provider)).toEqual([
      OPENROUTER_PROVIDER_ID,
      VERCEL_GATEWAY_PROVIDER_ID,
    ]);
    expect(observations.lookups.map(({ id }) => id)).toEqual([
      "typesafe/jev-1.13",
      "typesafe-ai/jev",
    ]);
  });

  test("resolves the saved unprefixed latest alias through the native catalog", async () => {
    writeSettings({
      jev: { providers: [{ provider: OPENROUTER_PROVIDER_ID, model: "typesafe/jev-latest" }] },
    });
    const observations: Observations = { lookups: [], maxRetries: [] };
    const registry = observeRegistry(await createNativeClassifierRegistry(), observations);

    const result = await createRequester()(registry, boolInput, {
      fetch: async () => classifierResponse(),
    });

    expect(result).toMatchObject({ ok: true, value: { answers: { gate: { type: "bool" } } } });
    expect(observations.lookups).toEqual([
      { provider: OPENROUTER_PROVIDER_ID, id: "~typesafe/jev-latest" },
    ]);
  });

  test("skips an OpenRouter 429 cooldown and retries that provider at expiry", async () => {
    let now = 10_000;
    const requester = createRequester(() => now);
    const observations: Observations = { lookups: [], maxRetries: [] };
    const registry = observeRegistry(await createNativeClassifierRegistry(), observations);
    let fetchCalls = 0;
    const fetch = async (): Promise<Response> => {
      fetchCalls += 1;
      if (fetchCalls === 1)
        return new Response("busy", { status: 429, headers: { "Retry-After": "2" } });
      return classifierResponse();
    };

    const initial = await requester(registry, boolInput, { fetch });
    now = 11_999;
    const duringCooldown = await requester(registry, boolInput, { fetch });
    now = 12_000;
    const afterExpiry = await requester(registry, boolInput, { fetch });

    for (const result of [initial, duringCooldown, afterExpiry])
      expect(result).toMatchObject({ ok: true, value: { answers: { gate: { type: "bool" } } } });
    expect(observations.lookups.map(({ provider }) => provider)).toEqual([
      OPENROUTER_PROVIDER_ID,
      VERCEL_GATEWAY_PROVIDER_ID,
      VERCEL_GATEWAY_PROVIDER_ID,
      OPENROUTER_PROVIDER_ID,
    ]);
    expect(fetchCalls).toBe(4);
  });

  test("sets native retries to zero and counts each transport attempt once", async () => {
    const observations: Observations = { lookups: [], maxRetries: [] };
    const registry = observeRegistry(await createNativeClassifierRegistry(), observations);
    let fetchCalls = 0;
    let onFetchAttemptCalls = 0;

    const result = await createRequester()(registry, boolInput, {
      fetch: async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) throw new Error("transport detail");
        return classifierResponse();
      },
      onFetchAttempt: () => {
        onFetchAttemptCalls += 1;
      },
    });

    expect(result).toMatchObject({ ok: true, value: { answers: { gate: { type: "bool" } } } });
    expect(observations.maxRetries).toEqual([0, 0]);
    expect(fetchCalls).toBe(2);
    expect(onFetchAttemptCalls).toBe(2);
    expect(JSON.stringify(result)).not.toContain("transport detail");
  });

  test("rejects non-plain JSON state before attempting a provider request", async () => {
    const nonPlainState = Object.setPrototypeOf({ value: "not plain JSON" }, { marker: true });
    const input: ClassifierContext = {
      ...boolInput,
      state: { nested: nonPlainState },
    };
    const observations: Observations = { lookups: [], maxRetries: [] };
    const registry = observeRegistry(await createNativeClassifierRegistry(), observations);
    let fetchCalls = 0;

    const result = await createRequester()(registry, input, {
      fetch: async () => {
        fetchCalls += 1;
        return classifierResponse();
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid-input", stage: "config" });
    expect(observations.lookups).toEqual([]);
    expect(fetchCalls).toBe(0);
  });
  test("does not bill cached cooldown usage again", async () => {
    writeSettings({
      jev: { providers: [{ provider: OPENROUTER_PROVIDER_ID, model: "typesafe/jev-1.13" }] },
    });
    const native = await createNativeClassifierRegistry();
    let calls = 0;
    const registry: JevClassifierRegistry = {
      findOfType: native.findOfType.bind(native),
      classify: async (_model, _input, options) => {
        calls++;
        await options?.fetch?.("https://example.invalid");
        return {
          api: "typesafe-system-one",
          provider: "openrouter",
          model: "typesafe/jev-1.13",
          timestamp: 0,
          stopReason: "error",
          answers: {},
          usage: {
            input: 1,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 1,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
      },
    };
    const request = createRequester(() => 0);
    const fetch = async () =>
      new Response("busy", { status: 429, headers: { "Retry-After": "2" } });
    expect((await request(registry, boolInput, { fetch })).usage?.totalTokens).toBe(1);
    expect(await request(registry, boolInput, { fetch })).not.toHaveProperty("usage");
    expect(calls).toBe(1);
  });
});
