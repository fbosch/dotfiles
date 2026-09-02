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

  test("keeps MCP status right-aligned and other statuses on the left", () => {
    const state = {
      ...promptState,
      getStatuses: () => ["permission status"],
    };
    const line = renderPromptHints(
      ansiTheme,
      keybindings,
      state,
      "~/dotfiles",
      50,
      renderMcpFooterStatus(ansiTheme, 2),
    );
    const plainLine = stripTerminalSequences(line);

    expect(plainLine).toContain("permission status");
    expect(plainLine.endsWith("⊙ 2 MCP")).toBe(true);
    expect(visibleWidth(line)).toBe(50);
  });

  test("preserves unrelated status text", () => {
    expect(renderFooterStatus(theme, "other", "status")).toBe("status");
  });
});
