import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODELS_CONFIG_URL = new URL("../models.json", import.meta.url);
const FAST_SERVICE_TIER = "priority";
const FAST_SUFFIX = "-fast";

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

export function applyFastServiceTier(
  payload: unknown,
  fastModelId: string,
): Record<string, unknown> {
  const baseModelId = FAST_MODELS.get(fastModelId);
  if (baseModelId === undefined) {
    throw new Error(`Unsupported OpenAI Codex fast model: ${fastModelId}`);
  }

  if (isRecord(payload) === false) {
    throw new Error("OpenAI Codex fast mode requires an object request payload");
  }

  return {
    ...payload,
    model: baseModelId,
    service_tier: FAST_SERVICE_TIER,
  };
}

export function applyFastServiceTierForPayload(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (isRecord(payload) === false || typeof payload.model !== "string") return undefined;
  if (FAST_MODELS.has(payload.model) === false) return undefined;
  return applyFastServiceTier(payload, payload.model);
}

export default function openaiFast(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event) => {
    return applyFastServiceTierForPayload(event.payload);
  });
}
