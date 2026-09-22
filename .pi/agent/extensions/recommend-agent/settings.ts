import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_JEV_TIMEOUT_MS } from "../../lib/vercel-gateway";

export const RECOMMEND_AGENT_SETTING = "recommendAgent" as const;
export const DEFAULT_RECOMMEND_AGENT_CONFIG = {
  enabled: false,
  // These are conservative operating thresholds, not calibrated probabilities.
  minProbability: 0.72,
  minMargin: 0.1,
  timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
  maxCandidates: 32,
} as const;

export interface RecommendAgentConfig {
  readonly enabled: boolean;
  readonly minProbability: number;
  readonly minMargin: number;
  readonly timeoutMs: number;
  readonly maxCandidates: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    return undefined;
  return value;
}

/** Only the user-global settings object is accepted; project settings cannot opt in. */
export function resolveRecommendAgentConfig(globalSettings: unknown): RecommendAgentConfig {
  if (!isRecord(globalSettings)) return DEFAULT_RECOMMEND_AGENT_CONFIG;
  const jev = globalSettings.jev;
  if (jev === undefined) return DEFAULT_RECOMMEND_AGENT_CONFIG;
  if (!isRecord(jev)) return { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: false };

  const raw = jev[RECOMMEND_AGENT_SETTING];
  if (raw === undefined) return DEFAULT_RECOMMEND_AGENT_CONFIG;
  if (!isRecord(raw)) return { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: false };

  const enabled = raw.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: false };
  }

  const minProbability = boundedNumber(
    raw.minProbability,
    DEFAULT_RECOMMEND_AGENT_CONFIG.minProbability,
    0.5,
    1,
  );
  const minMargin = boundedNumber(raw.minMargin, DEFAULT_RECOMMEND_AGENT_CONFIG.minMargin, 0, 0.5);
  const timeoutMs = boundedNumber(
    raw.timeoutMs,
    DEFAULT_RECOMMEND_AGENT_CONFIG.timeoutMs,
    200,
    2000,
  );
  const maxCandidates = boundedNumber(
    raw.maxCandidates,
    DEFAULT_RECOMMEND_AGENT_CONFIG.maxCandidates,
    1,
    32,
  );
  if (
    minProbability === undefined ||
    minMargin === undefined ||
    timeoutMs === undefined ||
    maxCandidates === undefined
  ) {
    return { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: false };
  }

  return {
    enabled: enabled ?? DEFAULT_RECOMMEND_AGENT_CONFIG.enabled,
    minProbability,
    minMargin,
    timeoutMs,
    maxCandidates: Math.floor(maxCandidates),
  };
}

export function readGlobalRecommendAgentConfig(): RecommendAgentConfig {
  try {
    const settings = SettingsManager.create(process.cwd(), getAgentDir());
    return resolveRecommendAgentConfig(settings.getGlobalSettings());
  } catch {
    return { ...DEFAULT_RECOMMEND_AGENT_CONFIG, enabled: false };
  }
}
