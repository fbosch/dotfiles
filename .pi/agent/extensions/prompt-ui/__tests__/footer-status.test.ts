import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { type PromptEditorState, renderFooterStatus, renderPromptHints } from "../prompt-editor";

const theme = {
  fg: (color: string, text: string) => `${color}:${text}`,
};
const keybindings = {
  getKeys: () => [],
};
const ansiTheme = {
  fg: (_color: string, text: string) => `\u001b[38;5;45m${text}\u001b[39m`,
};
const promptState: PromptEditorState = {
  isWorking: () => false,
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("prompt footer statuses", () => {
  test("shows a direct interrupt hint while working", () => {
    const state = {
      ...promptState,
      isWorking: () => true,
    };
    const line = renderPromptHints(theme, { getKeys: () => ["escape"] }, state, "~/dotfiles", 60);

    expect(line).toContain("esc interrupt");
  });

  test("colors file change counts in the footer", () => {
    expect(renderFooterStatus(theme, "file-changes", "2 files +40 -25")).toBe(
      "text:2 files success:+40 error:-25",
    );
    expect(renderFooterStatus(theme, "file-changes", "1 file")).toBe("text:1 file");
  });

  test("keeps file changes on the right while displaying extension statuses on the left", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["background task"],
    };
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    const line = renderPromptHints(ansiTheme, keybindings, state, "~/dotfiles", 60, fileStatus);
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).toContain("background task");
    expect(plainLine.endsWith("2 files +40 -25 ")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("leaves one column after the right-side file status", () => {
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "1 file");
    const line = renderPromptHints(
      ansiTheme,
      keybindings,
      promptState,
      "~/dotfiles",
      60,
      fileStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine.endsWith("1 file ")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("preserves unrelated status text", () => {
    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });
});
