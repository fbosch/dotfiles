import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionContext,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import { readLockedJsonFile, updateLockedJsonFile } from "../../lib/locked-json-file";

export interface QuickRepliesSettings {
  readonly enabled: boolean;
  readonly shortcuts?: readonly KeyId[];
  readonly warnings: readonly string[];
}

export interface QuickReplyModel {
  provider: string;
  id: string;
}

export const DEFAULT_QUICK_REPLY_MODEL = "openai-codex/gpt-5.6-luna-fast";
export const DEFAULT_QUICK_REPLY_SHORTCUTS = [
  "alt+1",
  "alt+2",
  "alt+3",
  "alt+4",
  "alt+5",
] as const satisfies readonly KeyId[];

const MODIFIERS = new Set(["alt", "ctrl", "shift", "super"]);
const BASE_KEYS = new Set([
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
  ..."`-=[]\\;',./!@#$%^&*()_|~{}:<>?",
]);

function defaultSettings(): QuickRepliesSettings {
  return { enabled: true, warnings: [] };
}

function invalidSettings(warning: string): QuickRepliesSettings {
  return { enabled: false, shortcuts: [], warnings: [warning] };
}

function settingsError(settingsPath: string, error: unknown): string {
  return `Cannot load Pi settings from ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`;
}

export function resolveQuickRepliesSettings(settings: unknown): QuickRepliesSettings {
  if (settings === undefined) return defaultSettings();
  if (isRecord(settings) === false) {
    return invalidSettings("global Pi settings: expected a JSON object");
  }
  if (settings.quickReplies === undefined) return defaultSettings();
  if (isRecord(settings.quickReplies) === false) {
    return invalidSettings("global quickReplies: expected a JSON object");
  }

  const enabled = settings.quickReplies.enabled;
  if (enabled !== undefined && typeof enabled !== "boolean") {
    return invalidSettings("global quickReplies.enabled: expected a boolean");
  }

  const shortcuts = parseQuickReplyShortcuts(settings.quickReplies.shortcuts);
  if (shortcuts === null) {
    return invalidSettings(
      "global quickReplies.shortcuts: expected five unique supported modified keys or function keys",
    );
  }

  return {
    enabled: enabled ?? true,
    ...(shortcuts === undefined ? {} : { shortcuts }),
    warnings: [],
  };
}

function parseQuickReplyShortcuts(value: unknown): readonly KeyId[] | null | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) === false || value.length !== DEFAULT_QUICK_REPLY_SHORTCUTS.length) {
    return null;
  }

  const shortcuts: KeyId[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const shortcut = candidate.trim();
    if (isQuickReplyShortcut(shortcut) === false) return null;

    const normalized = shortcut.toLowerCase();
    if (seen.has(normalized)) return null;
    seen.add(normalized);
    shortcuts.push(shortcut as KeyId);
  }
  return shortcuts;
}

function isQuickReplyShortcut(value: string): boolean {
  const parts = value.toLowerCase().split("+");
  const base = parts.pop();
  if (base === undefined || BASE_KEYS.has(base) === false) return false;
  if (parts.length === 0) return /^f(?:[1-9]|1[0-2])$/u.test(base);
  return new Set(parts).size === parts.length && parts.every((part) => MODIFIERS.has(part));
}

export function loadQuickRepliesSettings(
  settingsPath = join(getAgentDir(), "settings.json"),
): QuickRepliesSettings {
  try {
    const settings = readLockedJsonFile(settingsPath);
    return settings === undefined ? defaultSettings() : resolveQuickRepliesSettings(settings);
  } catch (error) {
    return invalidSettings(settingsError(settingsPath, error));
  }
}

export function writeQuickRepliesSetting(
  enabled: boolean,
  settingsPath = join(getAgentDir(), "settings.json"),
): void {
  try {
    updateLockedJsonFile(settingsPath, (current) => {
      const settings = current ?? {};
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
      return settings;
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Cannot update global quickReplies")) {
      throw error;
    }
    throw new Error(settingsError(settingsPath, error));
  }
}

export function resolveQuickReplyModel(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): QuickReplyModel | undefined {
  let reference = DEFAULT_QUICK_REPLY_MODEL;

  if (context.isProjectTrusted()) {
    try {
      const settings = readLockedJsonFile(join(context.cwd, CONFIG_DIR_NAME, "settings.json"));
      if (isRecord(settings) && settings.quickReplies !== undefined) {
        if (isRecord(settings.quickReplies) === false) return undefined;
        if (typeof settings.quickReplies.model !== "string") return undefined;
        reference = settings.quickReplies.model.trim();
      }
    } catch {
      return undefined;
    }
  }

  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return undefined;
  return { provider: reference.slice(0, separator), id: reference.slice(separator + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}
