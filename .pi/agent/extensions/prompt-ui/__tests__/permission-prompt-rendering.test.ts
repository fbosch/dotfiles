import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderPermissionPromptLines } from "../permission-prompt-rendering";

const COLOR_CODES: Record<string, string> = {
  accent: "36",
  borderMuted: "90",
  muted: "90",
  text: "37",
  warning: "33",
};

const theme = {
  fg: (color: string, text: string) => `\u001b[${COLOR_CODES[color] ?? "37"}m${text}\u001b[39m`,
  inverse: (text: string) => `\u001b[7m${text}\u001b[27m`,
};

describe("permission prompt rendering", () => {
  test("renders the request, patterns, and actions as a compact inline prompt", () => {
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
        "▶ (o) Allow once",
        "  (s) Allow for this session",
        "  (n) Deny",
        "  (r) Deny with reason",
        "",
        "↑/↓ move · enter confirm · esc deny · press a letter, then again to confirm",
      ],
      120,
      theme,
    );
    const plain = lines.map(stripTerminalSequences);

    expect(plain.slice(0, 6)).toEqual([
      "△ Permission required (Subagent)",
      "    ← Access external directory /usr/share/nvim/runtime/doc/api.txt",
      "Patterns",
      "- *",
      "",
      "─".repeat(120),
    ]);
    expect(plain[6]).toContain(" Allow once ");
    expect(plain[6]).toContain(" Allow session ");
    expect(plain[6]).toContain(" Reject ");
    expect(plain[6]).toContain(" Reject + reason ");
    expect(plain[6]).toEndWith("↑/↓ select · enter confirm · esc deny");
    expect(lines[0]).toBe("\u001b[33m△ Permission required (Subagent)\u001b[39m");
    expect(lines[6]).toContain("\u001b[7m");
    expect(lines[6]).toContain("\u001b[36m Allow once \u001b[39m");
    expect(plain).not.toContain("subagent          : review · session 01a06d9c");
  });

  test("emphasizes the command behind a path permission", () => {
    const lines = renderPermissionPromptLines(
      [
        "Permission Required",
        "surface : path_write",
        "path : .pi/mcp.json",
        "command : printf secret > .pi/mcp.json",
        "rule : */.pi/mcp.json",
      ],
      120,
      theme,
    );
    const plain = lines.map(stripTerminalSequences);

    expect(plain[1]).toBe("    ← Write path .pi/mcp.json");
    expect(plain[2]).toBe("      ↳ command printf secret > .pi/mcp.json");
    expect(lines[2]).toContain("\u001b[33mprintf secret > .pi/mcp.json\u001b[39m");
  });

  test("compacts verbose approval labels without changing their order", () => {
    const lines = renderPermissionPromptLines(
      [
        "Permission Required",
        "surface : external_directory_read",
        "rule : /Users/fbb/.config/fbb/*",
        "path : ~/.config/fbb",
        "",
        "▶ (o) Allow once",
        '  (s) Yes, allow reads to "/Users/fbb/.config/fbb/*" for this session',
        "  (b) Allow reads and writes for this session",
        "  (f) Allow in future sessions…",
        "  (n) Deny",
      ],
      120,
      theme,
    );

    expect(
      lines
        .map(stripTerminalSequences)
        .some(
          (line) =>
            line.includes(" Allow once ") &&
            line.includes(" Allow session ") &&
            line.includes(" Allow in future sessions… ") &&
            line.includes(" Reject ") &&
            line.endsWith("↑/↓ select · enter confirm · esc deny"),
        ),
    ).toBe(true);
    expect(lines.map(stripTerminalSequences).join("\n")).not.toContain("Allow reads and writes");
  });

  test("keeps unrelated custom dialogs unchanged", () => {
    const lines = ["Settings", "tool : read"];

    expect(renderPermissionPromptLines(lines, 80, theme)).toEqual(lines);
  });

  test("fits the compact prompt to the available width", () => {
    const lines = renderPermissionPromptLines(
      [
        "Permission Required",
        "tool : read",
        "surface : external_directory_read",
        "path : /usr/share/nvim/runtime/doc/api.txt",
        "",
        "▶ (o) Allow once",
        "  (s) Allow for this session",
        "  (n) Deny",
        "  (r) Deny with reason",
      ],
      24,
      theme,
    );

    expect(lines.length).toBeGreaterThan(4);
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true);
  });
});
