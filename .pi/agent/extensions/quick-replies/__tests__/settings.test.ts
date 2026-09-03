import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  loadQuickRepliesSettings,
  resolveQuickRepliesSettings,
  resolveQuickReplyModel,
  writeQuickRepliesSetting,
} from "../settings";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function context(cwd: string, trusted = true): Pick<ExtensionContext, "cwd" | "isProjectTrusted"> {
  return { cwd, isProjectTrusted: () => trusted };
}

function project(settings?: unknown): string {
  const cwd = mkdtempSync(join(tmpdir(), "quick-replies-settings-"));
  temporaryDirectories.push(cwd);
  if (settings !== undefined) {
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(settings));
  }
  return cwd;
}

function settingsFile(settings: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "quick-replies-global-settings-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "settings.json");
  writeFileSync(path, JSON.stringify(settings));
  return path;
}

describe("quick reply global settings", () => {
  test.each([undefined, {}, { quickReplies: {} }, { quickReplies: { model: "provider/model" } }])(
    "enables quick replies when the setting is absent: %j",
    (settings) => {
      expect(resolveQuickRepliesSettings(settings)).toEqual({ enabled: true, warnings: [] });
    },
  );

  test("disables quick replies when configured globally", () => {
    expect(resolveQuickRepliesSettings({ quickReplies: { enabled: false } })).toEqual({
      enabled: false,
      warnings: [],
    });
  });

  test("loads five configurable quick-reply shortcuts", () => {
    const shortcuts = ["ctrl+1", "ctrl+2", "ctrl+3", "ctrl+4", "ctrl+5"] as const;

    expect(resolveQuickRepliesSettings({ quickReplies: { shortcuts } })).toEqual({
      enabled: true,
      shortcuts,
      warnings: [],
    });
  });

  test.each([
    { shortcuts: ["ctrl+1", "ctrl+2"] },
    { shortcuts: ["ctrl+1", "ctrl+1", "ctrl+3", "ctrl+4", "ctrl+5"] },
    { shortcuts: ["1", "2", "3", "4", "5"] },
    { shortcuts: ["ctrl+1", "ctrl+2", "ctrl+3", "ctrl+4", "invalid+key"] },
  ])("disables quick replies for invalid shortcut configuration: $shortcuts", ({ shortcuts }) => {
    expect(resolveQuickRepliesSettings({ quickReplies: { shortcuts } })).toEqual({
      enabled: false,
      shortcuts: [],
      warnings: [
        "global quickReplies.shortcuts: expected five unique supported modified keys or function keys",
      ],
    });
  });

  test.each([
    {
      settings: null,
      warning: "global Pi settings: expected a JSON object",
    },
    {
      settings: { quickReplies: true },
      warning: "global quickReplies: expected a JSON object",
    },
    {
      settings: { quickReplies: { enabled: "no" } },
      warning: "global quickReplies.enabled: expected a boolean",
    },
  ])(
    "warns and disables quick replies for invalid settings: $settings",
    ({ settings, warning }) => {
      expect(resolveQuickRepliesSettings(settings)).toEqual({
        enabled: false,
        shortcuts: [],
        warnings: [warning],
      });
    },
  );

  test("loads the global setting from a Pi settings file", () => {
    expect(loadQuickRepliesSettings(settingsFile({ quickReplies: { enabled: false } }))).toEqual({
      enabled: false,
      warnings: [],
    });
  });

  test("disables quick replies when the settings file cannot be parsed", () => {
    const path = settingsFile({});
    writeFileSync(path, "invalid json");

    const settings = loadQuickRepliesSettings(path);

    expect(settings.enabled).toBe(false);
    expect(settings.warnings[0]).toContain(`Cannot load Pi settings from ${path}`);
  });

  test("updates the global setting without dropping other quick-replies settings", () => {
    const path = settingsFile({
      theme: "dark",
      quickReplies: { model: "anthropic/claude-haiku-4-5", enabled: true },
    });

    writeQuickRepliesSetting(false, path);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      quickReplies: { model: "anthropic/claude-haiku-4-5", enabled: false },
    });
  });

  test("does not overwrite settings while Pi's file lock is held", () => {
    const path = settingsFile({ theme: "dark", quickReplies: { enabled: true } });
    mkdirSync(`${path}.lock`);

    expect(() => writeQuickRepliesSetting(false, path)).toThrow("locked by another process");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "dark",
      quickReplies: { enabled: true },
    });
  });

  test("recovers a stale Pi settings lock before updating", () => {
    const path = settingsFile({ quickReplies: { enabled: true } });
    const lockPath = `${path}.lock`;
    mkdirSync(lockPath);
    const staleTime = new Date(Date.now() - 20_000);
    utimesSync(lockPath, staleTime, staleTime);

    writeQuickRepliesSetting(false, path);

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      quickReplies: { enabled: false },
    });
  });
});

describe("quick reply model settings", () => {
  test("loads the model from trusted project settings", () => {
    const cwd = project({ quickReplies: { model: "anthropic/claude-haiku-4-5" } });

    expect(resolveQuickReplyModel(context(cwd))).toEqual({
      provider: "anthropic",
      id: "claude-haiku-4-5",
    });
  });

  test("uses the built-in default when the setting is absent or untrusted", () => {
    const cwd = project({ quickReplies: { model: "anthropic/claude-haiku-4-5" } });
    const expected = { provider: "openai-codex", id: "gpt-5.6-luna-fast" };

    expect(resolveQuickReplyModel(context(project()))).toEqual(expected);
    expect(resolveQuickReplyModel(context(cwd, false))).toEqual(expected);
  });

  test.each([
    { quickReplies: true },
    { quickReplies: {} },
    { quickReplies: { model: "missing-separator" } },
  ])("fails closed for an invalid configured model: %j", (settings) => {
    expect(resolveQuickReplyModel(context(project(settings)))).toBeUndefined();
  });
});
