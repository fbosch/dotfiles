import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderPermissionPromptLines } from "../permission-prompt-rendering";

const COLOR_CODES: Record<string, string> = {
  accent: "36",
  muted: "90",
  success: "32",
  text: "37",
  warning: "33",
};

const theme = {
  fg: (color: string, text: string) => `\u001b[${COLOR_CODES[color] ?? "37"}m${text}\u001b[39m`,
};

describe("permission prompt rendering", () => {
  test("prioritizes the action and scope with sparse icon and color hierarchy", () => {
    const lines = renderPermissionPromptLines(
      [
        "\u001b[36mPermission Required (Subagent)\u001b[39m",
        "subagent          : review · session 01a06d9c",
        "tool              : read",
        "surface           : external_directory_read",
        "rule              : *",
        "path              : \u001b[33m/usr/share/nvim/runtime/doc/api.txt\u001b[39m",
        "working directory : /home/fbb/dotfiles",
        "",
        "▶ (y) Yes",
      ],
      120,
      theme,
    );
    const plain = lines.map(stripTerminalSequences);

    expect(plain[0]).toBe("\uf071 Permission Required (Subagent)");
    expect(lines[0]).toBe("\u001b[33m\uf071 Permission Required (Subagent)\u001b[39m");
    expect(plain).toContain("action : \uf06e Read");
    expect(plain).toContain("scope  : External directory");
    expect(plain).toContain("rule   : * (wildcard)");
    expect(plain).toContain("path   : /usr/share/nvim/runtime/doc/api.txt");
    expect(plain).toContain("cwd    : /home/fbb/dotfiles");
    expect(plain).not.toContain("subagent          : review · session 01a06d9c");
    expect(lines[2]).toContain("\u001b[32m\uf06e");
    expect(lines[2]).toContain("\u001b[32mRead");
    expect(lines[3]).toContain("\u001b[36mExternal directory");
    expect(lines[4]).toContain("\u001b[33m* (wildcard)");
    expect(lines[5]).toContain("\u001b[33m/usr/share/nvim/runtime/doc/api.txt");
  });

  test("keeps unrelated custom dialogs unchanged", () => {
    const lines = ["Settings", "tool : read"];

    expect(renderPermissionPromptLines(lines, 80, theme)).toEqual(lines);
  });

  test("fits decorated lines to the available width", () => {
    const lines = renderPermissionPromptLines(
      [
        "Permission Required",
        "tool : read",
        "surface : external_directory_read",
        "path : /usr/share/nvim/runtime/doc/api.txt",
      ],
      24,
      theme,
    );

    expect(lines.length).toBeGreaterThan(4);
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
  });
});
