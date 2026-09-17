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

  test("renders MCP status like OpenCode", () => {
    expect(renderMcpFooterStatus(theme, 2)).toBe("success: text:2 MCP");
    expect(renderMcpFooterStatus(theme, 2, true)).toBe("error: text:2 MCP");
    expect(renderMcpFooterStatus(theme, 0)).toBe("");
  });

  test("converts the client's compact status to the OpenCode rendering", () => {
    expect(renderFooterStatus(theme, "mcp", "MCP 2/6")).toBe("success: text:2 MCP");
    expect(renderFooterStatus(theme, "mcp", "MCP 0/6")).toBe("");
  });

  test("colors file change counts in the footer", () => {
    expect(renderFooterStatus(theme, "file-changes", "2 files +40 -25")).toBe(
      "text:2 files success:+40 error:-25",
    );
    expect(renderFooterStatus(theme, "file-changes", "1 file")).toBe("text:1 file");
  });

  test("keeps file changes and MCP together on the right", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["background task"],
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

    expect(plainLine).toContain("background task");
    expect(plainLine.endsWith("2 files +40 -25 ·  2 MCP ")).toBe(true);
    expect(visibleWidth(line)).toBe(60);
  });

  test("leaves one column after right-side statuses at the right edge", () => {
    const mcpStatus = renderMcpFooterStatus(ansiTheme, 2);
    const line = renderPromptHints(
      ansiTheme,
      keybindings,
      promptState,
      "~/dotfiles",
      60,
      mcpStatus,
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine.endsWith(" 2 MCP ")).toBe(true);
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
    expect(plainLine.endsWith(" 2 MCP ")).toBe(true);
    expect(visibleWidth(line)).toBe(25);
  });

  test("preserves unrelated status text", () => {
    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });
});
