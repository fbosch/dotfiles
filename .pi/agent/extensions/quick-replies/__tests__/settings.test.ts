import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveQuickReplyModel } from "../settings";

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
