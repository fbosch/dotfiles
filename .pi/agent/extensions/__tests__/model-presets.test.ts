import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  type ExtensionVirtualModel,
  ModelRegistry,
  type ModelRoute,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import modelPresets, {
  applyPresetRouting,
  createVirtualPreset,
  MODEL_PRESETS,
  resolvedPresetModelIds,
} from "../model-presets";

const managed = [
  ["focused-execution", "low", "openai/gpt-6-luna-fast"],
  ["planning", "medium", "openai/gpt-6.1-sol"],
  ["deliberation", "high", "openai/gpt-6.1-sol"],
  ["implementation", "medium", "openai/gpt-6-luna"],
  ["deep-analysis", "high", "openai/gpt-6-luna"],
] as const;
const messages = [{ role: "user" as const, content: "Check æ ø å", timestamp: 0 }];
let runtime: ModelRuntime;
let registry: ModelRegistry;

beforeAll(async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openrouter", async () => ({
    type: "api_key",
    key: "preset-test-key",
  }));
  runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    executorSocket: null,
  });
  await runtime.refresh({ allowNetwork: false });
  registry = new ModelRegistry(runtime);
});

function register(id: keyof typeof MODEL_PRESETS) {
  const definition = createVirtualPreset(id, MODEL_PRESETS[id]);
  runtime.registerVirtualModel({
    ...definition,
    route: (request) => definition.route(request, { modelRegistry: registry }),
  });
  const virtual = runtime.getModel("presets", id);
  if (!virtual) throw new Error(`Missing virtual preset ${id}`);
  return virtual;
}

function completionResponse() {
  const chunk = {
    id: "preset-response",
    model: "openai/gpt-6-luna",
    choices: [{ index: 0, delta: { content: "æ ø å" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 3,
      total_tokens: 13,
      cost: 0.004,
      is_byok: false,
    },
  };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("model presets", () => {
  test("registers all presets with their selection levels", () => {
    const registrations: ExtensionVirtualModel[] = [];
    modelPresets({
      registerVirtualModel: (definition) => registrations.push(definition),
      on: () => () => {},
    });
    expect(registrations.map(({ id }) => id)).toEqual(Object.keys(MODEL_PRESETS));
    expect(registrations.map(({ thinkingLevels }) => thinkingLevels)).toEqual(
      Object.values(MODEL_PRESETS).map(({ thinking }) => [thinking]),
    );
  });

  test("keeps the routing backend out of virtual preset labels", () => {
    expect(createVirtualPreset("planning", MODEL_PRESETS.planning).name).toBe(
      "planning",
    );
    expect(createVirtualPreset("routine", MODEL_PRESETS.routine, "resolved-model").name).toBe(
      "routine (resolved-model)",
    );
  });

  test("all agents select known presets without overriding thinking", () => {
    const agentsDir = new URL("../../agents/", import.meta.url);
    const selected = readdirSync(agentsDir).map((file) => {
      const text = readFileSync(new URL(file, agentsDir), "utf8");
      const model = /^model: presets\/(.+)$/m.exec(text)?.[1];
      if (!Object.hasOwn(MODEL_PRESETS, model ?? "")) throw new Error(`Unknown preset in ${file}`);
      expect(/^thinking:/m.test(text)).toBe(false);
      return model;
    });
    expect(new Set(selected)).toEqual(new Set(Object.keys(MODEL_PRESETS)));
  });

  test("only the five adaptive presets use managed routing", () => {
    expect(
      Object.entries(MODEL_PRESETS)
        .filter(([, preset]) => "routing" in preset)
        .map(([id]) => id),
    ).toEqual(managed.map(([id]) => id));
    expect(registry.findOfType("classifier", "openrouter", "typesafe/jev-1.13")).toBeDefined();
  });

  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    if ("routing" in preset) continue;
    test(`${id} preserves its Codex model and effort`, async () => {
      const model: ModelRoute["model"] = {
        id: preset.model,
        name: preset.model,
        provider: "openai-codex",
        api: "openai-codex-responses",
        baseUrl: "https://example.invalid",
        reasoning: true,
        input: ["text"],
        contextWindow: 272000,
        maxTokens: 128000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      const ctx = {
        modelRegistry: {
          find: (provider: string, modelId: string) => {
            expect(provider).toBe("openai-codex");
            expect(modelId).toBe(preset.model);
            return model;
          },
        },
      };
      expect(await createVirtualPreset(id, preset).route({}, ctx)).toEqual({
        model,
        thinkingLevel: preset.thinking,
      });
    });
  }

  for (const [id, costTier, preferredModel] of managed) {
    test(`${id} resolves its own policy for every request lifecycle`, async () => {
      const virtual = register(id);
      for (const reason of ["user", "continuation", "retry", "direct"] as const) {
        const result = await runtime.resolveModel(virtual, messages, {
          reason,
          thinkingLevel: "off",
        });
        expect(result.model.provider).toBe("openrouter");
        expect(result.model.id).toBe("typesafe/jev-router");
        expect(result.thinkingLevel).toBe("off");
        const body = applyPresetRouting(
          { model: result.model.id },
          { provider: "presets", id },
        );
        expect(body?.plugins).toEqual([
          { id: "jev-router", cost_tier: costTier, models: [preferredModel] },
        ]);
      }
    });

    test(`${id} serializes Jev policy through the installed native adapter`, async () => {
      const result = await runtime.completeSimple(
        register(id),
        { messages },
        {
          maxRetries: 0,
          onPayload: (payload) => applyPresetRouting(payload, { provider: "presets", id }),
          fetch: Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = new Request(input, init);
              expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
              expect(request.headers.get("authorization")).toBe("Bearer preset-test-key");
              const body = await request.json();
              expect(body.model).toBe("typesafe/jev-router");
              expect(body.plugins).toEqual([
                { id: "jev-router", cost_tier: costTier, models: [preferredModel] },
              ]);
              // Pi must leave effort to Jev, rather than send "off"/"none" as a hint.
              expect(body.reasoning).toBeUndefined();
              expect(body.reasoning_effort).toBeUndefined();
              expect(body.messages).toContainEqual({ role: "user", content: "Check æ ø å" });
              return completionResponse();
            },
            { preconnect: globalThis.fetch.preconnect },
          ),
        },
      );
      expect(result.stopReason).toBe("stop");
      expect(result.content).toEqual([{ type: "text", text: "æ ø å" }]);
      expect(result.responseModel).toBe("openai/gpt-6-luna");
      expect(result.usage.cost.total).toBe(0.004);
    });
  }

  test("keeps fixed-model labels aligned with catalog resolution", () => {
    const fixed: ModelRoute["model"] = {
      id: "resolved-model", name: "Resolved", provider: "openai-codex",
      api: "openai-codex-responses", baseUrl: "https://example.invalid",
      reasoning: true, input: ["text"], contextWindow: 272000, maxTokens: 128000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    expect(resolvedPresetModelIds({ find: () => fixed }).get("presets/routine")).toBe("resolved-model");
  });

  test("attaches policies through the registered provider hook", () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    modelPresets({
      registerVirtualModel: () => {},
      on(event: string, handler: unknown) {
        if (typeof handler !== "function") throw new Error("Expected event handler");
        handlers.set(event, (...args) => handler(...args));
        return () => {};
      },
    });
    const payload = { model: "typesafe/jev-router" };
    expect(handlers.get("before_provider_request")?.(
      { type: "before_provider_request", payload },
      { model: { provider: "presets", id: "deliberation" } },
    )).toEqual({
      ...payload,
      plugins: [{ id: "jev-router", cost_tier: "high", models: ["openai/gpt-6.1-sol"] }],
    });
  });

  test("preserves unrelated plugins and request fields without mutating the original", () => {
    const payload = {
      model: "typesafe/jev-router",
      messages,
      stream: true,
      reasoning: { effort: "none" },
      plugins: [{ id: "other", enabled: true }, { id: "jev-router", cost_tier: "low" }],
    };
    expect(applyPresetRouting(payload, { provider: "presets", id: "planning" })).toEqual({
      model: "typesafe/jev-router",
      messages,
      stream: true,
      plugins: [
        { id: "other", enabled: true },
        { id: "jev-router", cost_tier: "medium", models: ["openai/gpt-6.1-sol"] },
      ],
    });
    expect(payload.reasoning).toEqual({ effort: "none" });
    expect(payload.plugins[1]).toEqual({ id: "jev-router", cost_tier: "low" });
  });

  test("does not apply preset policy to unrelated provider requests or selections", () => {
    const router = { model: "typesafe/jev-router" };
    for (const selected of [
      undefined,
      { provider: "openrouter", id: "typesafe/jev-router" },
      { provider: "presets", id: "routine" },
      { provider: "presets", id: "unknown" },
    ]) expect(applyPresetRouting(router, selected)).toBeUndefined();
    const selected = { provider: "presets", id: "planning" };
    expect(applyPresetRouting({ model: "gpt-6-luna" }, selected)).toBeUndefined();
    expect(applyPresetRouting(null, selected)).toBeUndefined();
    expect(() => applyPresetRouting(
      { ...router, plugins: "invalid" }, selected,
    )).toThrow("array of request plugins");
  });

  test("interleaved requests retain their own selected preset policies", async () => {
    const results = await Promise.all(managed.map(async ([id, costTier, preferredModel]) => {
      const virtual = register(id);
      const route = await runtime.resolveModel(virtual, messages, {
        reason: "retry", thinkingLevel: "off",
      });
      return {
        actual: applyPresetRouting(
          { model: route.model.id }, { provider: "presets", id },
        )?.plugins,
        expected: [{ id: "jev-router", cost_tier: costTier, models: [preferredModel] }],
      };
    }));
    for (const { actual, expected } of results) expect(actual).toEqual(expected);
  });

  test("missing configured models fail loudly", async () => {
    await expect(
      createVirtualPreset("planning", MODEL_PRESETS.planning).route(
        {},
        { modelRegistry: { find: () => undefined } },
      ),
    ).rejects.toThrow("openrouter/typesafe/jev-router is not in the catalog");
  });

  test("caller cancellation propagates before model selection", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createVirtualPreset("planning", MODEL_PRESETS.planning).route(
        { signal: controller.signal },
        { modelRegistry: registry },
      ),
    ).rejects.toThrow();
  });

  test("router errors remain errors rather than silently switching providers", async () => {
    let calls = 0;
    const result = await runtime.completeSimple(
      register("planning"),
      { messages },
      {
        maxRetries: 0,
        fetch: Object.assign(
          async () => {
            calls++;
            return new Response(JSON.stringify({ error: { message: "Router unavailable" } }), {
              status: 503,
            });
          },
          { preconnect: globalThis.fetch.preconnect },
        ),
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Router unavailable");
    expect(calls).toBe(1);
  });
});
