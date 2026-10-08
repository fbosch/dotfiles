import type { ExtensionAPI, ExtensionContext, ModelRoute } from "@earendil-works/pi-coding-agent";

interface Preset {
  model: string;
  thinking: ModelRoute["thinkingLevel"];
}

export const MODEL_PRESETS = {
  discovery: { model: "gpt-6-luna-fast", thinking: "minimal" },
  routine: { model: "gpt-6-luna-fast", thinking: "low" },
  verification: { model: "gpt-6-luna-fast", thinking: "medium" },
  "focused-execution": { model: "gpt-6-luna-fast", thinking: "xhigh" },
  creative: { model: "gpt-6.1-sol", thinking: "low" },
  planning: { model: "gpt-6.1-sol", thinking: "medium" },
  deliberation: { model: "gpt-6.1-sol", thinking: "high" },
  "technical-discovery": { model: "gpt-6-luna", thinking: "medium" },
  implementation: { model: "gpt-6-luna", thinking: "xhigh" },
  "deep-analysis": { model: "gpt-6-luna", thinking: "max" },
  "critical-review": { model: "gpt-6-astra", thinking: "high" },
  "failure-analysis": { model: "gpt-6-astra", thinking: "xhigh" },
} as const satisfies Record<string, Preset>;

type PresetContext = {
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "find">;
};

export function createVirtualPreset(id: string, preset: Preset) {
  return {
    provider: "presets",
    id,
    name: `${id} (${preset.model} · ${preset.thinking})`,
    thinkingLevels: [preset.thinking],
    route(_request: unknown, ctx: PresetContext): ModelRoute {
      const model = ctx.modelRegistry.find("openai-codex", preset.model);
      if (!model) {
        throw new Error(`Preset presets/${id}: openai-codex/${preset.model} is not in the catalog`);
      }
      // A fixed preset owns the physical budget, regardless of session thinking overrides.
      return { model, thinkingLevel: preset.thinking };
    },
  };
}

export default function modelPresets(pi: Pick<ExtensionAPI, "registerVirtualModel">): void {
  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    pi.registerVirtualModel(createVirtualPreset(id, preset));
  }
}
