import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderSandboxFooterStatus } from "../footer-config";
import {
  type PromptEditorState,
  renderFooterStatus,
  renderMcpFooterStatus,
  renderPromptHints,
} from "../prompt-editor";

const theme = {
  fg: (color: string, text: string) => `${color}:${text}`,
};
const ansiTheme = {
  fg: (_color: string, text: string) => `\u001b[38;5;45m${text}\u001b[39m`,
};
const promptState: PromptEditorState = {
  isWorking: () => false,
  getWorkingPulse: () => 0,
  getWorkingPosition: () => 0,
  getInterruptPulse: () => 0,
  onInterrupt() {},
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("prompt footer statuses", () => {

  test("renders MCP status and marks failures", () => {
    expect(renderMcpFooterStatus(theme, 2)).toBe("success: text:2 MCP");
    expect(renderMcpFooterStatus(theme, 2, true)).toBe("error: text:2 MCP");
    expect(renderMcpFooterStatus(theme, 0)).toBe("");
    expect(renderMcpFooterStatus(theme, 0, true)).toBe("error: text:0 MCP");
    expect(renderFooterStatus(theme, "mcp", "MCP 2/6")).toBe("success: text:2 MCP");
    expect(renderFooterStatus(theme, "mcp", "MCP 2/6!")).toBe("error: text:2 MCP");
    expect(renderFooterStatus(theme, "mcp", "MCP 0/6")).toBe("");
    expect(renderFooterStatus(theme, "mcp", "MCP 0/6!")).toBe("error: text:0 MCP");
  });

  test("colors file change counts in the footer", () => {
    expect(renderFooterStatus(theme, "file-changes", "2 files +40 -25")).toBe(
      "text:2 files success:+40 error:-25",
    );
    expect(renderFooterStatus(theme, "file-changes", "1 file")).toBe("text:1 file");
  });

  test("treats plan-like status text as ordinary extension status", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["Plan"],
    };
    const line = renderPromptHints(theme, state, "~/dotfiles", 60);

    expect(line).toContain("Plan");
  });

  test("keeps file changes and MCP on the right while showing extension statuses on the left", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["background task"],
    };
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    const line = renderPromptHints(
      ansiTheme,
      state,
      "~/dotfiles",
      60,
      mcpStatus,
      fileStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).toContain("background task");
    expect(plainLine.endsWith("2 files +40 -25 ·  2 MCP ")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("leaves one column after right-side MCP status", () => {
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const line = renderPromptHints(
      ansiTheme,
      promptState,
      "~/dotfiles",
      60,
      mcpStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine.endsWith(" 2 MCP ")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("prioritizes MCP over file changes when the footer narrows", () => {
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    const line = renderPromptHints(
      ansiTheme,
      promptState,
      "~/dotfiles",
      25,
      mcpStatus,
      fileStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).not.toContain("2 files");
    expect(plainLine.endsWith(" 2 MCP ")).toBe(true);
    expect(visibleWidth(line)).toBe(25);
  });

  test("preserves unrelated status text", () => {
    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });

  test("keeps the lock beside MCP and drops file counts when space is tight", () => {
    const primaryStatus = [
      renderMcpFooterStatus(ansiTheme, 2),
      renderSandboxFooterStatus(ansiTheme, "nono"),
    ].join(" · ");
    const fileStatus = renderFooterStatus(ansiTheme, "file-changes", "2 files +40 -25");
    for (const width of [25, 60]) {
      const line = renderPromptHints(
        ansiTheme,
        promptState,
        "~/dotfiles",
        width,
        primaryStatus,
        fileStatus,
      );
      const plainLine = stripTerminalSequences(line);
      expect(plainLine.endsWith(" 2 MCP ·  ")).toBe(true);
      expect(plainLine.includes("2 files")).toBe(width === 60);
      expect(visibleWidth(line)).toBe(width);
    }
  });
  test("truncates a long cwd to keep MCP and sandbox statuses visible", () => {
    const primaryStatus = [
      renderMcpFooterStatus(ansiTheme, 2),
      renderSandboxFooterStatus(ansiTheme, "nono"),
    ].join(" · ");
    const cwd = "/Projects/Organization/very-long-worktree-name-that-exceeds-the-footer-width";
    const line = renderPromptHints(ansiTheme, promptState, cwd, 60, primaryStatus);
    const plainLine = stripTerminalSequences(line);

    expect(plainLine.endsWith(" 2 MCP ·  ")).toBe(true);
    expect(plainLine).not.toContain(cwd);
    expect(visibleWidth(line)).toBe(60);
  });
});
