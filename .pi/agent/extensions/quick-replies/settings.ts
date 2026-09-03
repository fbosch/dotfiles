import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";

export interface QuickRepliesSettings {
  readonly enabled: boolean;
  readonly warnings: readonly string[];
}

export interface QuickReplyModel {
  provider: string;
  id: string;
}

export const DEFAULT_QUICK_REPLY_MODEL = "openai-codex/gpt-5.6-luna-fast";

function defaultSettings(): QuickRepliesSettings {
  return { enabled: true, warnings: [] };
}

function settingsError(settingsPath: string, error: unknown): string {
  return `Cannot load Pi settings from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`;
}

export function resolveQuickRepliesSettings(settings: unknown): QuickRepliesSettings {
  if (isRecord(settings) === false || settings.quickReplies === undefined) {
    return defaultSettings();
  }

  if (isRecord(settings.quickReplies) === false) {
    return {
      enabled: true,
      warnings: ["global quickReplies.enabled: expected a boolean"],
    };
  }

  if (settings.quickReplies.enabled === undefined) return defaultSettings();
  if (typeof settings.quickReplies.enabled !== "boolean") {
    return {
      enabled: true,
      warnings: ["global quickReplies.enabled: expected a boolean"],
    };
  }

  return { enabled: settings.quickReplies.enabled, warnings: [] };
}

export function loadQuickRepliesSettings(
  settingsPath = join(getAgentDir(), "settings.json"),
): QuickRepliesSettings {
  let source: string;
  try {
    source = readFileSync(settingsPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return defaultSettings();
    return { ...defaultSettings(), warnings: [settingsError(settingsPath, error)] };
  }

  try {
    return resolveQuickRepliesSettings(JSON.parse(source));
  } catch (error) {
    return { ...defaultSettings(), warnings: [settingsError(settingsPath, error)] };
  }
}

export function writeQuickRepliesSetting(
  enabled: boolean,
  settingsPath = join(getAgentDir(), "settings.json"),
): void {
  let settings: unknown = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(settingsError(settingsPath, error));
    }
  }

  if (isRecord(settings) === false) {
    throw new Error(
      `Cannot update global quickReplies setting from ${settingsPath}: expected a JSON object`,
    );
  }
  if (settings.quickReplies !== undefined && isRecord(settings.quickReplies) === false) {
    throw new Error(
      `Cannot update global quickReplies setting from ${settingsPath}: expected quickReplies to be a JSON object`,
    );
  }

  settings.quickReplies = {
    ...(isRecord(settings.quickReplies) ? settings.quickReplies : {}),
    enabled,
  };
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function resolveQuickReplyModel(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): QuickReplyModel | undefined {
  let reference = DEFAULT_QUICK_REPLY_MODEL;

  if (context.isProjectTrusted()) {
    try {
      const settings: unknown = JSON.parse(
        readFileSync(join(context.cwd, ".pi", "settings.json"), "utf8"),
      );
      if (isRecord(settings) && settings.quickReplies !== undefined) {
        if (isRecord(settings.quickReplies) === false) return undefined;
        if (typeof settings.quickReplies.model !== "string") return undefined;
        reference = settings.quickReplies.model.trim();
      }
    } catch (error) {
      if (isMissingFile(error) === false) return undefined;
    }
  }

  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return undefined;
  return { provider: reference.slice(0, separator), id: reference.slice(separator + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
