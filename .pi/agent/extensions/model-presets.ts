import type {
  ExtensionAPI,
  ExtensionContext,
  ModelRoute,
  ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

const ROUTER_PROVIDER = "openrouter";
const ROUTER_MODEL = "typesafe/jev-router";

interface RoutingPolicy {
  costTier: "low" | "medium" | "high";
  models: readonly string[];
  excludedModels?: readonly string[];
}

interface Preset {
  model: string;
  thinking: ModelRoute["thinkingLevel"];
  routing?: RoutingPolicy;
}

export const MODEL_PRESETS = {
  discovery: { model: "gpt-6-luna-fast", thinking: "minimal" },
  routine: { model: "gpt-6-luna-fast", thinking: "low" },
  verification: { model: "gpt-6-luna-fast", thinking: "medium" },
  "focused-execution": {
    model: "gpt-6-luna-fast",
    thinking: "off",
    routing: { costTier: "low", models: ["openai/gpt-6-luna-fast"] },
  },
  creative: { model: "gpt-6.1-sol", thinking: "low" },
  planning: {
    model: "gpt-6.1-sol",
    thinking: "off",
    routing: { costTier: "medium", models: ["openai/gpt-6.1-sol"] },
  },
  deliberation: {
    model: "gpt-6.1-sol",
    thinking: "off",
    routing: { costTier: "high", models: ["openai/gpt-6.1-sol"] },
  },
  "technical-discovery": { model: "gpt-6-luna", thinking: "medium" },
  implementation: {
    model: "gpt-6-luna",
    thinking: "off",
    routing: { costTier: "medium", models: ["openai/gpt-6-luna"] },
  },
  "deep-analysis": {
    model: "gpt-6-luna",
    thinking: "off",
    routing: { costTier: "high", models: ["openai/gpt-6-luna"] },
  },
  "critical-review": { model: "gpt-6-astra", thinking: "high" },
  "failure-analysis": { model: "gpt-6-astra", thinking: "xhigh" },
} as const satisfies Record<string, Preset>;

type PresetContext = {
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "find">;
};
type SelectedModel = Pick<ModelRoute["model"], "provider" | "id">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyPresetRouting(
  payload: unknown,
  selected: SelectedModel | undefined,
): Record<string, unknown> | undefined {
  if (
    selected?.provider !== "presets" ||
    !isRecord(payload) ||
    payload.model !== ROUTER_MODEL
  ) return undefined;
  const preset: Preset | undefined = Object.entries(MODEL_PRESETS).find(
    ([id]) => id === selected.id,
  )?.[1];
  const policy = preset?.routing;
  if (!policy) return undefined;
  if (payload.plugins !== undefined && !Array.isArray(payload.plugins)) {
    throw new Error("Preset routing requires an array of request plugins");
  }
  const plugins = (payload.plugins ?? []).filter(
    (plugin: unknown) => !isRecord(plugin) || plugin.id !== "jev-router",
  );
  const result: Record<string, unknown> = {
    ...payload,
    plugins: [
      ...plugins,
      {
        id: "jev-router",
        cost_tier: policy.costTier,
        models: [...policy.models],
        ...(policy.excludedModels ? { excluded_models: [...policy.excludedModels] } : {}),
      },
    ],
  };
  // The catalog model maps Pi's "off" to an explicit "none" hint. Let the router
  // choose effort instead; keep this rewrite scoped to managed preset requests.
  delete result.reasoning;
  delete result.reasoning_effort;
  return result;
}

export function resolvedPresetModelIds(
  modelRegistry: PresetContext["modelRegistry"],
): ReadonlyMap<string, string> {
  const modelIds = new Map<string, string>();
  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    if ("routing" in preset) continue;
    const model = modelRegistry.find("openai-codex", preset.model);
    if (model) modelIds.set(`presets/${id}`, model.id);
  }
  return modelIds;
}

export function createVirtualPreset(id: string, preset: Preset, resolvedModelId = preset.model) {
  return {
    provider: "presets",
    id,
    name: preset.routing ? id : `${id} (${resolvedModelId})`,
    thinkingLevels: [preset.thinking],
    async route(
      request: Pick<ModelRouteRequest, "signal">,
      ctx: PresetContext,
    ): Promise<ModelRoute> {
      request.signal?.throwIfAborted();
      const provider = preset.routing ? ROUTER_PROVIDER : "openai-codex";
      const modelId = preset.routing ? ROUTER_MODEL : preset.model;
      const model = ctx.modelRegistry.find(provider, modelId);
      if (!model) {
        throw new Error(`Preset presets/${id}: ${provider}/${modelId} is not in the catalog`);
      }
      return { model, thinkingLevel: preset.thinking };
    },
  };
}

export default function modelPresets(pi: Pick<ExtensionAPI, "registerVirtualModel" | "on">): void {
  const register = (ctx?: PresetContext) => {
    const resolvedModels = ctx ? resolvedPresetModelIds(ctx.modelRegistry) : undefined;
    for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
      pi.registerVirtualModel(
        createVirtualPreset(id, preset, resolvedModels?.get(`presets/${id}`) ?? preset.model),
      );
    }
  };

  // Register before model selection, then refresh fixed-model labels at session start.
  register();
  pi.on("session_start", (_event, ctx) => register(ctx));
  // Use the current selection, not a last-routed preset shared by concurrent requests.
  pi.on("before_provider_request", (event, ctx) => applyPresetRouting(event.payload, ctx.model));
}
