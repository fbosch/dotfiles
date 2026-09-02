const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface CommitMessageModelConfig {
  model: string;
  thinkingLevel?: ThinkingLevel;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(settings: unknown): unknown {
  return isRecord(settings) ? settings.commitMessageModel : undefined;
}

export function resolveCommitMessageModelConfig(
  globalSettings: unknown,
  projectSettings?: unknown,
): CommitMessageModelConfig | null {
  const globalSection = section(globalSettings);
  const projectSection = section(projectSettings);

  if (projectSection === false) return null;
  if (globalSection === false && projectSection === undefined) return null;
  if (globalSection === undefined && projectSection === undefined) return null;

  const raw: UnknownRecord = {
    ...(isRecord(globalSection) ? globalSection : {}),
    ...(isRecord(projectSection) ? projectSection : {}),
  };
  if (raw.enabled === false) return null;

  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error("commitMessageModel.model must be a non-empty provider/model string");
  }

  let thinkingLevel: ThinkingLevel | undefined;
  if (raw.thinkingLevel !== undefined && raw.thinkingLevel !== null) {
    if (
      typeof raw.thinkingLevel !== "string" ||
      !(THINKING_LEVELS as readonly string[]).includes(raw.thinkingLevel)
    ) {
      throw new Error(`Invalid commitMessageModel.thinkingLevel: ${String(raw.thinkingLevel)}`);
    }
    thinkingLevel = raw.thinkingLevel as ThinkingLevel;
  }

  return {
    model,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };
}
