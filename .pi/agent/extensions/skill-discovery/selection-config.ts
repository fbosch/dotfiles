import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CLASSIFIER_TIMEOUT_MS } from "../../lib/classifier";
import { isRecord } from "../shared/is-record";

const DEFAULT_THRESHOLD = 0.72;
const DEFAULT_MAX_RECOMMENDATIONS = 3;
const MAX_RECOMMENDATIONS = 5;

export interface SkillSelectionConfig {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly timeoutMs: number;
  readonly maxRecommendations: number;
}

export const DEFAULT_SKILL_SELECTION_CONFIG: SkillSelectionConfig = {
  enabled: false,
  // Experimental starting point, not a calibrated production threshold.
  threshold: DEFAULT_THRESHOLD,
  timeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
  maxRecommendations: DEFAULT_MAX_RECOMMENDATIONS,
};

type SkillSelectionSection = Record<string, unknown> | null | undefined;

function settingSection(settings: unknown): SkillSelectionSection {
  if (isRecord(settings) === false) return undefined;
  const classifier = settings.classifier;
  if (classifier === undefined) return undefined;
  if (isRecord(classifier) === false) return null;

  const section = classifier.skillSelection;
  if (section === undefined || isRecord(section)) return section;
  return null;
}

function invalidConfig(): SkillSelectionConfig {
  return { ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: false };
}

function readConfigSection(
  section: SkillSelectionSection,
  current: SkillSelectionConfig,
): SkillSelectionConfig {
  if (section === undefined) return current;
  if (section === null) return invalidConfig();
  const unknownFields = Object.keys(section).filter(
    (field) => !["enabled", "threshold", "timeoutMs", "maxRecommendations"].includes(field),
  );
  if (unknownFields.length > 0) return invalidConfig();

  const enabled = section.enabled ?? current.enabled;
  const threshold = section.threshold ?? current.threshold;
  const timeoutMs = section.timeoutMs ?? current.timeoutMs;
  const maxRecommendations = section.maxRecommendations ?? current.maxRecommendations;

  if (
    typeof enabled !== "boolean" ||
    typeof threshold !== "number" ||
    Number.isFinite(threshold) === false ||
    threshold < 0 ||
    threshold > 1 ||
    typeof timeoutMs !== "number" ||
    Number.isInteger(timeoutMs) === false ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_CLASSIFIER_TIMEOUT_MS ||
    typeof maxRecommendations !== "number" ||
    Number.isInteger(maxRecommendations) === false ||
    maxRecommendations < 1 ||
    maxRecommendations > MAX_RECOMMENDATIONS
  ) {
    return invalidConfig();
  }

  return { enabled, threshold, timeoutMs, maxRecommendations };
}

export function resolveSkillSelectionConfig(
  globalSettings: unknown,
  projectSettings: unknown,
): SkillSelectionConfig {
  const global = readConfigSection(settingSection(globalSettings), DEFAULT_SKILL_SELECTION_CONFIG);
  return readConfigSection(settingSection(projectSettings), global);
}

export function configuredSkillSelection(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): SkillSelectionConfig {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return resolveSkillSelectionConfig(settings.getGlobalSettings(), settings.getProjectSettings());
}
