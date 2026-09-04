import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderPermissionPromptLines } from "../permission-prompt-rendering";

const theme = {
  fg: (color: string, text: string) => `[${color}]${text}`,
};

describe("permission prompt rendering", () => {
  test("prioritizes the action and scope with Nerd Font icons", () => {
    const lines = renderPermissionPromptLines(
      [
        "Permission Required (Subagent)",
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
    expect(plain).toContain("\uf06e action : Read");
    expect(plain).toContain("\uf07b scope  : External directory");
    expect(plain).toContain("\uf1de rule   : * (wildcard)");
    expect(plain).toContain("\uf15b path   : /usr/share/nvim/runtime/doc/api.txt");
    expect(plain).toContain("\uf3c5 cwd    : /home/fbb/dotfiles");
    expect(plain).not.toContain("subagent          : review · session 01a06d9c");
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
