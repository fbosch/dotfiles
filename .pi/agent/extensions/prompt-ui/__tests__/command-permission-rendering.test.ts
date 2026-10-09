import { describe, expect, test } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderCommandPermissionLines } from "../command-permission-rendering";

const colors: Record<string, string> = {
  accent: "36",
  warning: "33",
  customMessageLabel: "35",
  mdLinkUrl: "34",
  text: "37",
  muted: "90",
  borderMuted: "90",
  syntaxString: "32",
  syntaxComment: "90",
};
const BG = "\u001b[48;5;236m";
const theme = {
  fg: (color: string, text: string) => `\u001b[${colors[color] ?? "37"}m${text}\u001b[39m`,
  bg: (_color: string, text: string) => `${BG}${text}\u001b[49m`,
  inverse: (text: string) => `\u001b[7m${text}\u001b[27m`,
};
const input = {
  command: "rm -rf ./src/generated",
  cwd: "/workspace",
  concern: "Possible destructive changes.",
  allowSelected: true,
};
const render = (command: string, width = 100) =>
  renderCommandPermissionLines({ ...input, command }, width, theme);
const plain = (lines: string[]) => lines.map(stripTerminalSequences).join("\n");

describe("command permission presentation", () => {
  test("uses the ordinary code-row background rather than the selection background", () => {
    const backgrounds: string[] = [];
    const recordingTheme = {
      ...theme,
      bg: (color: string, text: string) => {
        backgrounds.push(color);
        return theme.bg(color, text);
      },
    };
    renderCommandPermissionLines(input, 100, recordingTheme);
    expect(backgrounds).toEqual(["userMessageBg"]);
  });

  test("separates the category, command block, directory, and unchanged actions", () => {
    const lines = render(input.command);
    const text = plain(lines);
    expect(text).toContain("Run this bash command?");
    expect(text).toContain(input.concern);
    expect(text.indexOf(input.concern)).toBeLessThan(text.indexOf("Command"));
    expect(text).toContain(input.command);
    expect(text).toContain("Working directory: /workspace");
    expect(text).toContain("Allow once");
    expect(text).toContain("Reject");
    expect(lines.join("\n")).toContain(BG);
    expect(text).not.toContain('"rm -rf');
    expect(text).not.toContain("Token colors are local hints");
    expect(text).not.toContain("Access permission");
  });

  test("uses selective warnings without painting the whole command orange", () => {
    const text = render(input.command).join("\n");
    expect(text).toContain("\u001b[33mrm\u001b[39m");
    expect(text).toContain("\u001b[33m-rf\u001b[39m");
    expect(text).toContain("\u001b[34m./src/generated\u001b[39m");
    expect(text).not.toContain(`\u001b[33m${input.command}`);
  });

  test("distinguishes chained executables and operators", () => {
    const command = "git reset --hard HEAD~1 && git push --force origin main";
    const lines = render(command);
    const text = lines.join("\n");
    expect(plain(lines)).toContain(command);
    expect(text.split("\u001b[36mgit\u001b[39m").length - 1).toBe(2);
    expect(text).toContain("\u001b[35m&&\u001b[39m");
    expect(text).toContain("\u001b[33m--hard\u001b[39m");
    expect(text).toContain("\u001b[33m--force\u001b[39m");
  });

  test("distinguishes upload flags, paths, and destinations", () => {
    const command = "curl --upload-file ./report.csv https://example.invalid/upload";
    const text = render(command).join("\n");
    expect(text).toContain("\u001b[36mcurl\u001b[39m");
    expect(text).toContain("\u001b[33m--upload-file\u001b[39m");
    expect(text).toContain("\u001b[34mhttps://example.invalid/upload\u001b[39m");
  });

  test("does not interpret quoted operators, comments, or escaped spaces as commands", () => {
    const command = "printf '%s' 'rm -rf && --force' ./a\\ b # rm --force";
    const text = render(command).join("\n");
    expect(plain(render(command))).toContain(command);
    expect(text).not.toContain("\u001b[33m--force\u001b[39m");
    expect(text).not.toContain("\u001b[35m&&\u001b[39m");
    expect(text).not.toContain("\u001b[33mrm\u001b[39m");
  });

  test("keeps quoted spaces, backslashes, Danish letters, and Unicode arguments intact", () => {
    for (const command of ["rm -rf 'træer ø å'", 'printf "a  b" ./a\\ b', "echo 你好 👩‍💻"]) {
      expect(plain(render(command))).toContain(command);
    }
  });

  test.each([
    "rm -rf træer\u001b[2J\n",
    "echo x\r\t\b",
    "echo \u009b31m",
    "echo \u202ehidden",
    "echo \u200bhidden",
    "echo \u2066hidden\u2069",
  ])("renders hidden and terminal controls as an explicitly escaped string: %j", (command) => {
    const text = plain(render(command));
    expect(text).toContain("Command (escaped)");
    expect(
      Array.from(text).some((char) => {
        const code = char.charCodeAt(0);
        return (
          (code < 32 && code !== 10) ||
          (code >= 127 && code <= 159) ||
          code === 0x200b ||
          code === 0x202e ||
          code === 0x2066 ||
          code === 0x2069
        );
      }),
    ).toBe(false);
    expect(text).toContain("\\");
  });

  test.each(["echo \u061chidden", "echo soft\u00adhyphen", "echo \ufeffhidden"])(
    "makes other invisible format controls visible: %j",
    (command) => {
      const rows = render(command)
        .filter((line) => line.includes(BG))
        .map(stripTerminalSequences);
      expect(rows).toHaveLength(1);
      expect(JSON.parse((rows[0] ?? "").trim())).toBe(command);
      expect(plain(render(command))).toContain("Command (escaped)");
    },
  );

  test("retains long arguments without ellipses or omitted suffixes", () => {
    const command = `rm -rf ./${"x".repeat(15900)}FINAL_TARGET`;
    const lines = render(command, 80);
    const code = lines
      .filter((line) => line.includes(BG))
      .map(stripTerminalSequences)
      .join("");
    expect(code.split("x").length - 1).toBe(15900);
    expect(code).toContain("FINAL_TARGET");
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);
  });

  test("distinguishes literal escape text from actual control characters", () => {
    expect(plain(render("printf 'a\\nb'"))).not.toContain("Command (escaped)");
    expect(plain(render("printf 'a\nb'"))).toContain("Command (escaped)");
  });

  test("also escapes untrusted directory and concern metadata", () => {
    const lines = renderCommandPermissionLines(
      { ...input, cwd: "/workspace\u001b[31m", concern: "risk\u202ehidden" },
      100,
      theme,
    );
    const text = plain(lines);
    expect(text).toContain("\\u001b");
    expect(text).toContain("\\u202e");
    expect(text).not.toContain("\u202e");
  });

  test("wraps without hiding the final argument, respects width, and retains every word", () => {
    const command = "git reset --hard HEAD~1 && git push --force origin main";
    for (const width of [1, 3, 12, 24, 80, 120]) {
      const lines = render(command, width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.some((line) => line.includes(BG))).toBe(true);
    }
    const code = render(command, 24)
      .filter((line) => line.includes(BG))
      .map(stripTerminalSequences)
      .join("");
    for (const token of [
      "git",
      "reset",
      "--hard",
      "HEAD~1",
      "&&",
      "push",
      "--force",
      "origin",
      "main",
    ])
      expect(code).toContain(token);
    expect(plain(render(command, 100))).not.toContain("↪");
    expect(plain(render(command, 24))).toContain("↪");
    expect(render(command, 0)).toEqual([]);
  });

  test("keeps confirm and rejection help visible at narrow widths", () => {
    const text = plain(render("rm -rf ./src/generated", 40));
    expect(text).toContain("enter confirm");
    expect(text).toContain("esc reject");
    expect(text).toContain("Allow once");
    expect(text).toContain("Reject");
  });

  test("fits wide graphemes and refreshes palette colors on each render", () => {
    for (const width of [1, 3, 4, 12, 24])
      expect(render("echo 你好 👩‍💻", width).every((line) => visibleWidth(line) <= width)).toBe(
        true,
      );
    const updated = {
      ...theme,
      fg: (_color: string, text: string) => `\u001b[31m${text}\u001b[39m`,
    };
    expect(renderCommandPermissionLines(input, 100, updated).join("\n")).not.toContain(
      "\u001b[34m",
    );
  });
});
