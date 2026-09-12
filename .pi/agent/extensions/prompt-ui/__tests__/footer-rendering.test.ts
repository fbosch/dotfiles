import { describe, expect, test } from "bun:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { type PromptEditorState, renderPromptHints } from "../prompt-editor";

const theme = {
  fg: (color: string, text: string) => {
    const ansi = color === "muted" ? "\u001b[90m" : "\u001b[91m";
    return `${ansi}${text}\u001b[39m`;
  },
  getColorMode: () => "truecolor" as const,
};
const keybindings = { getKeys: () => [] };
const promptState: PromptEditorState = {
  isWorking: () => false,
  isInterruptPending: () => false,
  setInterruptPending() {},
  getWorkingMarker: () => "●",
  getBranch: () => null,
  getProfileName: () => undefined,
  getStatuses: () => [],
};

describe("footer repository customization", () => {
  test("renders a configured icon before the repository location", () => {
    const line = renderPromptHints(theme, keybindings, promptState, "~/nixos", 60, "", "", {
      icon: "",
      color: "blue",
    });

    expect(stripTerminalSequences(line)).toContain(" ~/nixos");
    expect(line).toContain("\u001b[34m\u001b[39m");
  });
});
