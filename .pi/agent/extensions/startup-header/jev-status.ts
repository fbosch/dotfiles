import { JEV_GATEWAY_PROVIDER_IDS } from "../../lib/jev-gateway";
import { resolveFastJevCompactionConfig } from "../fast-jev-compaction";
import { resolveRecommendAgentConfig } from "../recommend-agent/settings";
import { resolveSkillSelectionConfig } from "../skill-selection";
import { resolveJevToolDiscoveryConfig } from "../tool-discovery";
import type { StartupOwnerState } from "./contracts";

export { VERCEL_GATEWAY_PROVIDER_ID } from "../../lib/jev-gateway";

export interface JevStartupStatus {
  readonly state: Exclude<StartupOwnerState, "disposed">;
}

type ProviderAuthStatus = { readonly configured: boolean };

type ProviderAuthStatusReader = {
  readonly getProviderAuthStatus?: (providerId: string) => ProviderAuthStatus | undefined;
};

export function resolveJevStartupStatus(
  globalSettings: unknown,
  projectSettings: unknown,
  modelRegistry: unknown,
): JevStartupStatus | undefined {
  const toolDiscovery = resolveJevToolDiscoveryConfig(globalSettings, projectSettings);
  const skillSelection = resolveSkillSelectionConfig(globalSettings, projectSettings);
  const recommendAgent = resolveRecommendAgentConfig(globalSettings);
  const compaction = resolveFastJevCompactionConfig(globalSettings);
  if (
    !toolDiscovery.enabled &&
    !skillSelection.enabled &&
    !recommendAgent.enabled &&
    !compaction.enabled
  )
    return undefined;

  if (typeof modelRegistry !== "object" || modelRegistry === null) return { state: "unavailable" };
  const reader = modelRegistry as ProviderAuthStatusReader;
  if (typeof reader.getProviderAuthStatus !== "function") return { state: "unavailable" };

  let hasKnownStatus = false;
  let hasUnknownStatus = false;
  let hasConfiguredProvider = false;
  for (const providerId of JEV_GATEWAY_PROVIDER_IDS) {
    let auth: ProviderAuthStatus | undefined;
    try {
      auth = reader.getProviderAuthStatus(providerId);
    } catch {
      hasUnknownStatus = true;
      continue;
    }
    if (auth === undefined || typeof auth.configured !== "boolean") {
      hasUnknownStatus = true;
      continue;
    }
    hasKnownStatus = true;
    hasConfiguredProvider ||= auth.configured;
  }
  if (hasConfiguredProvider) return { state: "ready" };
  return { state: hasKnownStatus && !hasUnknownStatus ? "degraded" : "unavailable" };
}
