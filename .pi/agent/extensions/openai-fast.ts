import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FAST_SERVICE_TIER = "priority";
const FAST_MODELS: Readonly<Record<string, string>> = {
  "gpt-5.6-luna-fast": "gpt-5.6-luna",
  "gpt-5.6-sol-fast": "gpt-5.6-sol",
  "gpt-5.6-terra-fast": "gpt-5.6-terra",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function applyFastServiceTier(
  payload: unknown,
  fastModelId: string,
): Record<string, unknown> {
  const baseModelId = FAST_MODELS[fastModelId];
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
  if (FAST_MODELS[payload.model] === undefined) return undefined;
  return applyFastServiceTier(payload, payload.model);
}

export default function openaiFast(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event) => {
    return applyFastServiceTierForPayload(event.payload);
  });
}
