import { readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const MODELS_CONFIG_URL = new URL("../models.json", import.meta.url);
const FAST_SERVICE_TIER = "priority";
const FAST_SUFFIX = "-fast";
const ASTRA_MODEL_ID = "gpt-6-astra-fast";

interface NativeOpenAICapabilityRegistration {
  provider: string;
  model: string;
  asyncTools: boolean;
  steering: boolean;
}

type OpenAICapabilitiesAPI = Pick<ExtensionAPI, "on"> & {
  registerOpenAICapabilities?: (registration: NativeOpenAICapabilityRegistration) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function buildFastModelMap(config: unknown): ReadonlyMap<string, string> {
  if (isRecord(config) === false || isRecord(config.providers) === false) {
    throw new Error("models.json must define a providers object");
  }

  const provider = config.providers["openai-codex"];
  if (isRecord(provider) === false || Array.isArray(provider.models) === false) {
    throw new Error("models.json must define openai-codex models");
  }

  const fastModels = new Map<string, string>();
  for (const [index, model] of provider.models.entries()) {
    if (isRecord(model) === false || typeof model.id !== "string") {
      throw new Error(`Invalid openai-codex model at index ${index}`);
    }

    if (model.id.endsWith(FAST_SUFFIX) === false) continue;
    if (fastModels.has(model.id)) throw new Error(`Duplicate OpenAI Codex fast model: ${model.id}`);

    fastModels.set(model.id, model.id.slice(0, -FAST_SUFFIX.length));
  }

  if (fastModels.size === 0) throw new Error("models.json defines no OpenAI Codex fast models");
  return fastModels;
}

function loadFastModelMap(): ReadonlyMap<string, string> {
  const config: unknown = JSON.parse(readFileSync(MODELS_CONFIG_URL, "utf8"));
  return buildFastModelMap(config);
}

const FAST_MODELS = loadFastModelMap();

export interface FastModelRequest {
  modelId: string;
  serviceTier: string;
}

export function resolveFastModelRequest(modelId: string): FastModelRequest | undefined {
  const baseModelId = FAST_MODELS.get(modelId);
  if (baseModelId === undefined) return undefined;
  return { modelId: baseModelId, serviceTier: FAST_SERVICE_TIER };
}

export function applyFastServiceTier(
  payload: unknown,
  fastModelId: string,
): Record<string, unknown> {
  const request = resolveFastModelRequest(fastModelId);
  if (request === undefined) {
    throw new Error(`Unsupported OpenAI Codex fast model: ${fastModelId}`);
  }

  if (isRecord(payload) === false) {
    throw new Error("OpenAI Codex fast mode requires an object request payload");
  }

  return {
    ...payload,
    model: request.modelId,
    service_tier: request.serviceTier,
  };
}

export function applyFastServiceTierForPayload(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (isRecord(payload) === false || typeof payload.model !== "string") return undefined;
  if (FAST_MODELS.has(payload.model) === false) return undefined;
  return applyFastServiceTier(payload, payload.model);
}

export default function openaiCapabilities(pi: OpenAICapabilitiesAPI): void {
  if (pi.registerOpenAICapabilities) {
    pi.registerOpenAICapabilities({
      provider: "openai-codex",
      model: ASTRA_MODEL_ID,
      asyncTools: true,
      steering: true,
    });
  } else {
    // Stow and Nix deploy independently; remove this guard once all hosts run the patched Pi build.
    const warnIfAstra = (ctx: ExtensionContext) => {
      if (ctx.model?.provider !== "openai-codex" || ctx.model.id !== ASTRA_MODEL_ID) return;
      ctx.ui.notify(
        "Native async tools and mid-turn steering require the patched Pi build from ~/nixos. Rebuild Pi and restart this session.",
        "warning",
      );
    };
    pi.on("session_start", (_event, ctx) => warnIfAstra(ctx));
    pi.on("model_select", (_event, ctx) => warnIfAstra(ctx));
  }

  pi.on("before_provider_request", (event) => {
    return applyFastServiceTierForPayload(event.payload);
  });
}
