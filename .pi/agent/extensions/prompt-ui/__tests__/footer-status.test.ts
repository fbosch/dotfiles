import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  type PromptEditorState,
  renderFooterStatus,
  renderMcpFooterStatus,
  renderPromptHints,
} from "../prompt-editor";

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
  isInterruptPending: () => false,
  setInterruptPending() {},
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("prompt footer statuses", () => {
  test("prompts for a second interrupt press while armed", () => {
    const state = {
      ...promptState,
      isWorking: () => true,
      isInterruptPending: () => true,
    };
    const line = renderPromptHints(theme, { getKeys: () => ["escape"] }, state, "~/dotfiles", 60);

    expect(line).toContain("warning:esc again to interrupt");
  });

  test("renders the session YOLO status with its icon and error color", () => {
    expect(renderFooterStatus(theme, "session-yolo", "yolo")).toBe("error:󱚝 yolo");
  });

  test("preserves the permission-system status when session YOLO is disabled", () => {
    expect(renderFooterStatus(theme, "pi-permission-system", "permission status")).toBe(
      "permission status",
    );
  });

  test("renders MCP status like OpenCode", () => {
    expect(renderMcpFooterStatus(theme, 2)).toBe("success:⊙ text:2 MCP");
    expect(renderMcpFooterStatus(theme, 2, true)).toBe("error:⊙ text:2 MCP");
    expect(renderMcpFooterStatus(theme, 0)).toBe("");
  });

  test("converts the adapter's compact status to the OpenCode rendering", () => {
    expect(renderFooterStatus(theme, "mcp", "MCP 2/6")).toBe("success:⊙ text:2 MCP");
    expect(renderFooterStatus(theme, "mcp", "MCP 0/6")).toBe("");
  });

  test("colors file change counts in the footer", () => {
    expect(renderFooterStatus(theme, "file-changes", "2 files +40 -25")).toBe(
      "text:2 files success:+40 error:-25",
    );
    expect(renderFooterStatus(theme, "file-changes", "1 file")).toBe("text:1 file");
  });

  test("omits YOLO from the lower footer", () => {
    const state = {
      ...promptState,
      getStatuses: () => [renderFooterStatus(ansiTheme, "session-yolo", "yolo")],
    };
    const line = renderPromptHints(ansiTheme, keybindings, state, "~/dotfiles", 50);

    expect(stripTerminalSequences(line)).not.toContain("yolo");
  });

  test("keeps file changes and MCP together on the right", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["permission status"],
    };
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    const line = renderPromptHints(
      ansiTheme,
      keybindings,
      state,
      "~/dotfiles",
      60,
      mcpStatus,
      fileStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).toContain("permission status");
    expect(plainLine.endsWith("2 files +40 -25 · ⊙ 2 MCP")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("drops file changes before MCP when the footer narrows", () => {
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    const line = renderPromptHints(
      ansiTheme,
      keybindings,
      promptState,
      "~/dotfiles",
      25,
      mcpStatus,
      fileStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).not.toContain("2 files");
    expect(plainLine.endsWith("⊙ 2 MCP")).toBe(true);
    expect(visibleWidth(line)).toBe(25);
  });

  test("preserves unrelated status text", () => {
    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });
});
