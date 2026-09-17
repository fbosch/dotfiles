import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readLockedJsonFile } from "../../lib/locked-json-file";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const DEFAULT_MODEL_REFERENCE = "openai-codex/gpt-5.6-luna-fast";
const DEFAULT_THINKING_LEVEL = "low" as const;

export type AutoSessionTitleThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface AutoSessionTitleModel {
  readonly provider: string;
  readonly id: string;
}

export interface AutoSessionTitleSettings {
  readonly model: AutoSessionTitleModel;
  readonly thinkingLevel: AutoSessionTitleThinkingLevel;
}

export const DEFAULT_AUTO_SESSION_TITLE_SETTINGS: AutoSessionTitleSettings = {
  model: parseModelReference(DEFAULT_MODEL_REFERENCE),
  thinkingLevel: DEFAULT_THINKING_LEVEL,
};

export function resolveAutoSessionTitleSettings(settings: unknown): AutoSessionTitleSettings {
  if (settings === undefined) return DEFAULT_AUTO_SESSION_TITLE_SETTINGS;
  if (isRecord(settings) === false) {
    throw new Error("global Pi settings: expected a JSON object");
  }

  const section = settings.autoSessionTitle;
  if (section === undefined) return DEFAULT_AUTO_SESSION_TITLE_SETTINGS;
  if (isRecord(section) === false) {
    throw new Error("global autoSessionTitle: expected a JSON object");
  }

  const modelReference = section.model === undefined ? DEFAULT_MODEL_REFERENCE : section.model;
  if (typeof modelReference !== "string") {
    throw new Error("global autoSessionTitle.model: expected a provider/model string");
  }

  const thinkingLevel =
    section.thinkingLevel === undefined ? DEFAULT_THINKING_LEVEL : section.thinkingLevel;
  if (!isThinkingLevel(thinkingLevel)) {
    throw new Error(`Invalid global autoSessionTitle.thinkingLevel: ${String(thinkingLevel)}`);
  }

  return {
    model: parseModelReference(modelReference),
    thinkingLevel,
  };
}

export function loadAutoSessionTitleSettings(
  settingsPath = join(getAgentDir(), "settings.json"),
): AutoSessionTitleSettings {
  return resolveAutoSessionTitleSettings(readLockedJsonFile(settingsPath));
}

function parseModelReference(reference: string): AutoSessionTitleModel {
  const normalized = reference.trim();
  const separator = normalized.indexOf("/");
  const provider = normalized.slice(0, separator).trim();
  const id = normalized.slice(separator + 1).trim();
  if (separator <= 0 || provider.length === 0 || id.length === 0) {
    throw new Error("global autoSessionTitle.model: expected a non-empty provider/model string");
  }
  return { provider, id };
}

function isThinkingLevel(value: unknown): value is AutoSessionTitleThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}
