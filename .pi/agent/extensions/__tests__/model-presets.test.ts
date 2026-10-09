import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ExtensionVirtualModel, ModelRoute } from "@earendil-works/pi-coding-agent";
import type { ClassifierRequestResult } from "../../lib/classifier";
import modelPresets, {
  createVirtualPreset,
  MODEL_PRESETS,
  resolvedPresetModelIds,
  routingPrompt,
} from "../model-presets";

type RouteRequest = Parameters<ReturnType<typeof createVirtualPreset>["route"]>[0];
type Classify = NonNullable<Parameters<typeof createVirtualPreset>[2]>;

const unavailable: Classify = async () => ({
  ok: false,
  stage: "config",
  reason: "model-unavailable",
});

function choice(level: string, confidence = 0.9): ClassifierRequestResult {
  return {
    ok: true,
    value: {
      answers: {
        thinking: { type: "choice", choice: level, confidence, probabilities: { [level]: 1 } },
      },
    },
  };
}

function context(id = "gpt-6-luna") {
  const physical: ModelRoute["model"] = {
    id,
    name: id,
    provider: "openai-codex",
    api: "openai-codex-responses",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 272000,
    maxTokens: 128000,
  };
  const lookups: string[] = [];
  return {
    physical,
    lookups,
    ctx: {
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      modelRegistry: {
        find(provider: string, model: string) {
          lookups.push(`${provider}/${model}`);
          return physical;
        },
        findOfType: () => undefined,
        classify: async () => {
          throw new Error("Unexpected native classifier call");
        },
      },
    },
  };
}

function request(
  reason: RouteRequest["reason"] = "user",
  text = "Implement the specified change",
): RouteRequest {
  return { reason, messages: [{ role: "user", content: text, timestamp: 0 }] };
}

describe("model presets", () => {
  test("registers every preset with its existing fallback selection level", () => {
    const registrations: ExtensionVirtualModel[] = [];
    modelPresets({
      registerVirtualModel: (definition) => registrations.push(definition),
      on: () => () => {},
    });
    expect(registrations.map(({ provider, id }) => `${provider}/${id}`)).toEqual(
      Object.keys(MODEL_PRESETS).map((id) => `presets/${id}`),
    );
    expect(registrations.map(({ thinkingLevels }) => thinkingLevels)).toEqual(
      Object.values(MODEL_PRESETS).map(({ thinking }) => [thinking]),
    );
  });

  test("names presets with the resolved physical model", () => {
    const virtual = createVirtualPreset(
      "deep-analysis",
      MODEL_PRESETS["deep-analysis"],
      unavailable,
      "gpt-6.1-sol",
    );
    expect(virtual.name).toBe("deep-analysis (gpt-6.1-sol)");
  });

  test("resolves configured presets to catalog model IDs", () => {
    const { ctx } = context("gpt-6.1-sol");
    expect(resolvedPresetModelIds(ctx.modelRegistry).get("presets/planning")).toBe("gpt-6.1-sol");
  });

  test("all agents select known presets without overriding thinking", () => {
    const agentsDir = new URL("../../agents/", import.meta.url);
    const pairs = readdirSync(agentsDir).map((file) => {
      const text = readFileSync(new URL(file, agentsDir), "utf8");
      const model = /^model: (.+)$/m.exec(text)?.[1];
      if (!model?.startsWith("presets/")) throw new Error(`Agent ${file} must select a preset`);
      const preset = Object.entries(MODEL_PRESETS).find(([id]) => id === model.slice(8))?.[1];
      if (!preset) throw new Error(`Unknown preset in ${file}: ${model}`);
      expect(/^thinking:/m.test(text)).toBe(false);
      return `${preset.model}:${preset.thinking}`;
    });
    expect(new Set(pairs)).toEqual(
      new Set(Object.values(MODEL_PRESETS).map((preset) => `${preset.model}:${preset.thinking}`)),
    );
  });

  test("only the five broad presets adapt and all ranges include their fallback", () => {
    const entries = Object.entries(MODEL_PRESETS);
    expect(entries.filter(([, preset]) => "adaptiveThinking" in preset).map(([id]) => id)).toEqual([
      "focused-execution",
      "planning",
      "deliberation",
      "implementation",
      "deep-analysis",
    ]);
    for (const [, preset] of entries) {
      if ("adaptiveThinking" in preset) {
        expect([...preset.adaptiveThinking]).toContain(preset.thinking);
      }
    }
  });

  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    test(`${id} retains its original physical model and budget without a classifier`, async () => {
      const { ctx, physical, lookups } = context(preset.model);
      const virtual = createVirtualPreset(id, preset, unavailable);
      for (const reason of ["user", "continuation", "retry", "direct"] as const) {
        const result = await virtual.route(request(reason), ctx);
        expect(result.model).toBe(physical);
        expect(result.thinkingLevel).toBe(preset.thinking);
      }
      expect(lookups).toEqual(Array(4).fill(`openai-codex/${preset.model}`));
    });
  }

  test("fixed presets never call the classifier", async () => {
    const { ctx } = context();
    let calls = 0;
    const classify: Classify = async () => {
      calls++;
      return choice("max");
    };
    await createVirtualPreset("routine", MODEL_PRESETS.routine, classify).route(request(), ctx);
    expect(calls).toBe(0);
  });

  test("adapts only thinking and sends prompt plus workload with bounded options", async () => {
    const { ctx, physical } = context();
    const classify: Classify = async (registry, input, options) => {
      expect(registry).toBe(ctx.modelRegistry);
      expect(input.state).toEqual({
        prompt: "Rename one local variable",
        workload: "implementation",
      });
      expect(Object.keys(input.questions.thinking?.criteria ?? {})).toEqual([
        "medium",
        "high",
        "xhigh",
      ]);
      expect(options?.settingsContext).toBe(ctx);
      return choice("medium");
    };
    const result = await createVirtualPreset(
      "implementation",
      MODEL_PRESETS.implementation,
      classify,
    ).route(request("user", "Rename one local variable"), ctx);
    expect(result).toEqual({
      model: physical,
      thinkingLevel: "medium",
      state: { thinking: "medium" },
    });
  });

  test("classifies once per user task and reuses state through continuations and retries", async () => {
    const { ctx, physical } = context();
    let calls = 0;
    const classify: Classify = async () => {
      calls++;
      return choice(calls === 1 ? "medium" : "high");
    };
    const virtual = createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify);
    const first = await virtual.route(request(), ctx);
    if (!first.state) throw new Error("Expected persisted thinking state");
    for (const reason of ["continuation", "retry"] as const) {
      const next = await virtual.route({ ...request(reason), state: first.state }, ctx);
      expect(next).toEqual({ model: physical, thinkingLevel: "medium" });
    }
    expect(calls).toBe(1);
    const second = await virtual.route({ ...request(), state: first.state }, ctx);
    expect(second.thinkingLevel).toBe("high");
    expect(calls).toBe(2);
  });

  test("failed classification is also cached for the task", async () => {
    const { ctx } = context();
    let calls = 0;
    const classify: Classify = async () => {
      calls++;
      return unavailable(ctx.modelRegistry, { state: {}, questions: {} });
    };
    const virtual = createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify);
    const first = await virtual.route(request(), ctx);
    if (!first.state) throw new Error("Expected persisted fallback state");
    expect(first.state).toEqual({ thinking: "xhigh" });
    await virtual.route({ ...request("retry"), state: first.state }, ctx);
    expect(calls).toBe(1);
  });

  test("continuations use previous budget and retries use failed budget when state is absent", async () => {
    const { ctx, physical } = context();
    const virtual = createVirtualPreset(
      "implementation",
      MODEL_PRESETS.implementation,
      unavailable,
    );
    expect(
      (
        await virtual.route(
          { ...request("continuation"), previous: { model: physical, thinkingLevel: "medium" } },
          ctx,
        )
      ).thinkingLevel,
    ).toBe("medium");
    expect(
      (
        await virtual.route(
          {
            ...request("retry"),
            previous: { model: physical, thinkingLevel: "medium" },
            failed: {
              model: physical,
              thinkingLevel: "high",
              message: {
                role: "assistant",
                content: [],
                api: physical.api,
                provider: physical.provider,
                model: physical.id,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: "error",
                errorMessage: "Transient failure",
                timestamp: 0,
              },
            },
          },
          ctx,
        )
      ).thinkingLevel,
    ).toBe("high");
    expect(
      (
        await virtual.route(
          { ...request("continuation"), previous: { model: physical, thinkingLevel: "off" } },
          ctx,
        )
      ).thinkingLevel,
    ).toBe("xhigh");
  });

  test("direct requests use fallback without classification", async () => {
    const { ctx } = context();
    let calls = 0;
    const classify: Classify = async () => {
      calls++;
      return choice("medium");
    };
    expect(
      (
        await createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify).route(
          request("direct"),
          ctx,
        )
      ).thinkingLevel,
    ).toBe("xhigh");
    expect(calls).toBe(0);
  });

  for (const [label, result] of [
    ["low confidence", choice("medium", 0.2)],
    ["non-finite confidence", choice("medium", Number.NaN)],
    ["out-of-range choice", choice("off")],
    ["missing answer", { ok: true, value: { answers: {} } }],
    ["disabled classifier", { ok: false, stage: "config", reason: "disabled" }],
    ["timeout", { ok: false, stage: "request", reason: "timeout" }],
  ] satisfies [string, ClassifierRequestResult][]) {
    test(`retains existing budget on ${label}`, async () => {
      const { ctx } = context();
      const virtual = createVirtualPreset(
        "implementation",
        MODEL_PRESETS.implementation,
        async () => result,
      );
      expect((await virtual.route(request(), ctx)).thinkingLevel).toBe("xhigh");
    });
  }

  test("request exceptions fall back but caller cancellation does not", async () => {
    const { ctx } = context();
    const controller = new AbortController();
    const classify: Classify = async () => {
      throw new Error("offline");
    };
    const virtual = createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify);
    expect((await virtual.route(request(), ctx)).thinkingLevel).toBe("xhigh");
    controller.abort();
    await expect(virtual.route({ ...request(), signal: controller.signal }, ctx)).rejects.toThrow();
    const during = new AbortController();
    const aborting: Classify = async () => {
      during.abort();
      return choice("medium");
    };
    await expect(
      createVirtualPreset("implementation", MODEL_PRESETS.implementation, aborting).route(
        { ...request(), signal: during.signal },
        ctx,
      ),
    ).rejects.toThrow();
  });

  test("missing physical model still fails loudly", async () => {
    const { ctx } = context();
    const missing = { ...ctx, modelRegistry: { ...ctx.modelRegistry, find: () => undefined } };
    await expect(
      createVirtualPreset("routine", MODEL_PRESETS.routine).route(request(), missing),
    ).rejects.toThrow("Preset presets/routine: openai-codex/gpt-6-luna-fast is not in the catalog");
  });

  test("extracts only latest user text, excludes images and bounds the payload", () => {
    const messages: RouteRequest["messages"] = [
      { role: "user", content: "Earlier task", timestamp: 0 },
      {
        role: "user",
        content: [
          { type: "text", text: "Current task" },
          { type: "image", data: "secret-image", mimeType: "image/png" },
        ],
        timestamp: 1,
      },
    ];
    expect(routingPrompt(messages)).toBe("Current task");
    expect(routingPrompt(request("user", "x".repeat(5000)).messages)).toHaveLength(2400);
    expect(routingPrompt([])).toBe("");
  });

  test("redacts obvious credentials, paths and emails and skips private keys", () => {
    const text =
      "Diagnose api_key=abc123 Bearer xyz123 ghp_example /home/fbb/private/a user@example.com";
    const sanitized = routingPrompt(request("user", text).messages);
    for (const secret of ["abc123", "xyz123", "ghp_example", "/home/fbb", "user@example.com"]) {
      expect(sanitized).not.toContain(secret);
    }
    expect(routingPrompt(request("user", "-----BEGIN PRIVATE KEY----- secret").messages)).toBe("");
    expect(routingPrompt(request("user", "æ ø å").messages)).toBe("æ ø å");
  });

  test("every adaptive preset can select each of its allowed thinking levels", async () => {
    for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
      if (!("adaptiveThinking" in preset)) continue;
      const { ctx, physical } = context(preset.model);
      for (const level of preset.adaptiveThinking) {
        const route = createVirtualPreset(id, preset, async () => choice(level));
        const result = await route.route(request(), ctx);
        expect(result.model).toBe(physical);
        expect(result.thinkingLevel).toBe(level);
      }
    }
  });

  test("empty or private-key prompts never invoke the classifier", async () => {
    const { ctx } = context();
    let calls = 0;
    const classify: Classify = async () => {
      calls++;
      return choice("medium");
    };
    const route = createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify);
    for (const prompt of ["", "   ", "-----BEGIN PRIVATE KEY----- confidential"]) {
      const result = await route.route(request("user", prompt), ctx);
      expect(result.thinkingLevel).toBe("xhigh");
    }
    expect(calls).toBe(0);
  });

  test("JSON credentials are redacted before crossing the classifier boundary", async () => {
    const { ctx } = context();
    const classify: Classify = async (_registry, input) => {
      expect(JSON.stringify(input.state)).not.toContain("credential_value");
      return choice("medium");
    };
    const route = createVirtualPreset("implementation", MODEL_PRESETS.implementation, classify);
    const result = await route.route(
      request("user", 'Diagnose {"api_key": "credential_value"}'),
      ctx,
    );
    expect(result.thinkingLevel).toBe("medium");
  });
});
