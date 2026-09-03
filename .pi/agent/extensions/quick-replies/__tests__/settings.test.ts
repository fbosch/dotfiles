import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  test("warns and enables quick replies for an invalid setting", () => {
    expect(resolveQuickRepliesSettings({ quickReplies: { enabled: "no" } })).toEqual({
      enabled: true,
      warnings: ["global quickReplies.enabled: expected a boolean"],
    });
  });

  test("loads the global setting from a Pi settings file", () => {
    expect(loadQuickRepliesSettings(settingsFile({ quickReplies: { enabled: false } }))).toEqual({
      enabled: false,
      warnings: [],
    });
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
