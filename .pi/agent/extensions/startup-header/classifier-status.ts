import { resolveClassifierEnabled, resolveClassifierPreferences } from "../../lib/classifier";
import { resolveClassifierToolDiscoveryConfig } from "../../lib/discovery-ranking";
import { resolveSkillSelectionConfig } from "../skill-discovery/selection-config";
import type { StartupOwnerState } from "./contracts";

export { VERCEL_GATEWAY_PROVIDER_ID } from "../../lib/classifier";

export interface ClassifierStartupStatus {
  readonly state: Exclude<StartupOwnerState, "disposed">;
}

type ProviderAuthStatus = { readonly configured: boolean };

type ProviderAuthStatusReader = {
  readonly getProviderAuthStatus?: (providerId: string) => ProviderAuthStatus | undefined;
};

export function resolveClassifierStartupStatus(
  globalSettings: unknown,
  projectSettings: unknown,
  modelRegistry: unknown,
): ClassifierStartupStatus | undefined {
  const enabled = resolveClassifierEnabled(globalSettings, projectSettings);
  if (enabled === false) return undefined;
  if (enabled === undefined) return { state: "unavailable" };

  const toolDiscovery = resolveClassifierToolDiscoveryConfig(globalSettings, projectSettings);
  const skillSelection = resolveSkillSelectionConfig(globalSettings, projectSettings);
  if (!toolDiscovery.enabled && !skillSelection.enabled) return undefined;

  if (typeof modelRegistry !== "object" || modelRegistry === null) return { state: "unavailable" };
  const reader = modelRegistry as ProviderAuthStatusReader;
  if (typeof reader.getProviderAuthStatus !== "function") return { state: "unavailable" };

  let hasKnownStatus = false;
  let hasUnknownStatus = false;
  let hasConfiguredProvider = false;
  const preferences = resolveClassifierPreferences(globalSettings);
  if (!preferences) return { state: "unavailable" };
  for (const providerId of new Set(preferences.map(({ provider }) => provider))) {
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
