import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ExtensionVirtualModel, ModelRoute } from "@earendil-works/pi-coding-agent";
import modelPresets, { createVirtualPreset, MODEL_PRESETS } from "../model-presets";

describe("fixed model presets", () => {
  test("registers one selectable virtual model per preset", () => {
    const registrations: ExtensionVirtualModel[] = [];
    modelPresets({
      registerVirtualModel(definition) {
        registrations.push(definition);
      },
    });

    expect(registrations.map(({ provider, id }) => `${provider}/${id}`)).toEqual(
      Object.keys(MODEL_PRESETS).map((id) => `presets/${id}`),
    );
    expect(registrations.map(({ thinkingLevels }) => thinkingLevels)).toEqual(
      Object.values(MODEL_PRESETS).map(({ thinking }) => [thinking]),
    );
  });

  test("covers exactly the model/thinking pairs currently used by agents", () => {
    const agentsDir = new URL("../../agents/", import.meta.url);
    const pairs = readdirSync(agentsDir).map((file) => {
      const text = readFileSync(new URL(file, agentsDir), "utf8");
      const model = /^model: (.+)$/m.exec(text)?.[1];
      if (!model?.startsWith("presets/")) {
        throw new Error(`Agent ${file} must select a virtual preset: ${model}`);
      }
      const id = model.slice("presets/".length);
      const preset = Object.entries(MODEL_PRESETS).find(([name]) => name === id)?.[1];
      if (!preset) throw new Error(`Unknown preset in ${file}: ${model}`);
      expect(/^thinking:/m.test(text)).toBe(false);
      return `${preset.model}:${preset.thinking}`;
    });

    expect(new Set(Object.values(MODEL_PRESETS).map((p) => `${p.model}:${p.thinking}`))).toEqual(
      new Set(pairs),
    );
  });

  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    test(`${id} fixes model and thinking across turns, tool continuations, retries and direct requests`, () => {
      const physical: ModelRoute["model"] = {
        id: preset.model,
        name: preset.model,
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
      const ctx = {
        modelRegistry: {
          find(provider: string, model: string) {
            lookups.push(`${provider}/${model}`);
            return physical;
          },
        },
      };
      const virtual = createVirtualPreset(id, preset);
      for (const reason of ["user", "continuation", "retry", "direct"]) {
        expect(virtual.route({ reason, thinkingLevel: "off" }, ctx)).toEqual({
          model: physical,
          thinkingLevel: preset.thinking,
        });
      }
      expect(lookups).toEqual(Array(4).fill(`openai-codex/${preset.model}`));
    });
  }

  test("fails clearly when the configured physical model is missing", () => {
    const preset = createVirtualPreset("routine", MODEL_PRESETS.routine);
    expect(() => preset.route({}, { modelRegistry: { find: () => undefined } })).toThrow(
      "Preset presets/routine: openai-codex/gpt-6-luna-fast is not in the catalog",
    );
  });
});
