import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AUTO_SESSION_TITLE_SETTINGS,
  loadAutoSessionTitleSettings,
  resolveAutoSessionTitleSettings,
} from "../settings";

const temporaryDirectories: string[] = [];

describe("auto-session-title settings", () => {
  test("uses Luna Fast with low reasoning by default", () => {
    expect(resolveAutoSessionTitleSettings(undefined)).toEqual(DEFAULT_AUTO_SESSION_TITLE_SETTINGS);
  });

  test("loads the model and thinking level from global settings", () => {
    expect(
      resolveAutoSessionTitleSettings({
        autoSessionTitle: {
          model: "anthropic/claude-haiku-4-5",
          thinkingLevel: "minimal",
        },
      }),
    ).toEqual({
      model: { provider: "anthropic", id: "claude-haiku-4-5" },
      thinkingLevel: "minimal",
    });
  });

  test("loads the global settings file", () => {
    const directory = mkdtempSync(join(tmpdir(), "auto-session-title-settings-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "settings.json");
    writeFileSync(
      path,
      JSON.stringify({
        autoSessionTitle: {
          model: "openai-codex/gpt-6-luna-fast",
          thinkingLevel: "low",
        },
      }),
    );

    expect(loadAutoSessionTitleSettings(path)).toEqual(DEFAULT_AUTO_SESSION_TITLE_SETTINGS);
  });

  test.each([
    { settings: { autoSessionTitle: true }, message: "expected a JSON object" },
    {
      settings: { autoSessionTitle: { model: "missing-separator" } },
      message: "expected a non-empty provider/model string",
    },
    {
      settings: { autoSessionTitle: { thinkingLevel: "none" } },
      message: "Invalid global autoSessionTitle.thinkingLevel",
    },
  ])("rejects invalid configuration: $settings", ({ settings, message }) => {
    expect(() => resolveAutoSessionTitleSettings(settings)).toThrow(message);
  });
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});
