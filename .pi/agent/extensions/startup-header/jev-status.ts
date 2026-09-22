import { resolveRecommendAgentConfig } from "../recommend-agent/settings";
import { resolveSkillSelectionConfig } from "../skill-selection";
import { resolveJevToolDiscoveryConfig } from "../tool-discovery";
import type { StartupOwnerState } from "./contracts";

export const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway";

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
  if (!toolDiscovery.enabled && !skillSelection.enabled && !recommendAgent.enabled)
    return undefined;

  if (typeof modelRegistry !== "object" || modelRegistry === null) return { state: "unavailable" };
  const reader = modelRegistry as ProviderAuthStatusReader;
  if (typeof reader.getProviderAuthStatus !== "function") return { state: "unavailable" };

  let auth: ProviderAuthStatus | undefined;
  try {
    auth = reader.getProviderAuthStatus(VERCEL_GATEWAY_PROVIDER_ID);
  } catch {
    return { state: "unavailable" };
  }
  if (auth === undefined || typeof auth.configured !== "boolean") return { state: "unavailable" };
  return { state: auth.configured ? "ready" : "degraded" };
}
