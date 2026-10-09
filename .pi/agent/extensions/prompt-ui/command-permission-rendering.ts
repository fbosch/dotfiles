import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { renderPermissionPromptActions } from "./permission-prompt-rendering";

type CommandTheme = Pick<Theme, "fg" | "bg" | "inverse">;
interface CommandPresentation {
  command: string;
  cwd: string;
  concern: string;
  allowSelected: boolean;
}
interface Token {
  text: string;
  color: ThemeColor;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const DESTRUCTIVE_COMMANDS = new Set(["rm", "shred", "truncate", "dd", "mkfs", "wipefs"]);
const WRAPPERS = new Set(["sudo", "env", "exec", "command"]);
const WARNING_OPTION =
  /^(?:--(?:hard|force(?:-with-lease)?|delete(?:-excluded)?|upload-file|data(?:-binary|-raw|-urlencode)?|no-preserve-root|recursive)(?:=|$)|-[rfRF]+$|-[dT]$)/;
// shortcut: lexical colors are reading aids, not verdicts; use a shell parser before adding semantic attribution.
const SHELL_TOKENS =
  /\s+|&&|\|\||>>|<<|\|&|[|&;()<>]|(?:\\.|"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|[^\s|&;()<>'"\\])+|./gu;

function hiddenCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    code < 32 ||
    (code >= 127 && code <= 159) ||
    // Preserve emoji joiners; other format controls must remain visible during review.
    (/\p{Cf}/u.test(char) && code !== 0x200d) ||
    code === 0x2028 ||
    code === 0x2029
  );
}

function escapedText(text: string, asciiOnly = false): string {
  return Array.from(JSON.stringify(text), (char) =>
    hiddenCharacter(char) || (asciiOnly && char.charCodeAt(0) > 127)
      ? // JSON escapes are UTF-16 code units, including surrogate pairs.
        char
          .split("")
          .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
          .join("")
      : char,
  ).join("");
}

function metadata(text: string): string {
  return Array.from(text).some(hiddenCharacter) ? escapedText(text) : text;
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let executable = true;
  let redirectTarget = false;
  let comment = false;
  for (const match of command.matchAll(SHELL_TOKENS)) {
    const text = match[0];
    let color: ThemeColor = "text";
    if (comment) color = "syntaxComment";
    else if (/^\s+$/.test(text)) {
      tokens.push({ text, color });
      continue;
    } else if (text.startsWith("#")) {
      comment = true;
      color = "syntaxComment";
    } else if (/^(?:&&|\|\||\|&|[|&;()])$/.test(text)) {
      color = "customMessageLabel";
      executable = true;
      redirectTarget = false;
    } else if (/^[<>]+$/.test(text)) {
      color = "customMessageLabel";
      redirectTarget = true;
    } else if (redirectTarget) {
      color = "mdLinkUrl";
      redirectTarget = false;
    } else if (executable && /^[A-Za-z_][A-Za-z0-9_]*=/.test(text)) {
      color = "syntaxVariable";
    } else if (executable) {
      const name = text.split("/").at(-1) ?? text;
      color = DESTRUCTIVE_COMMANDS.has(name) || name.startsWith("mkfs.") ? "warning" : "accent";
      executable = WRAPPERS.has(name);
    } else if (WARNING_OPTION.test(text)) color = "warning";
    else if (/^(?:[./~]|https?:\/\/)/.test(text)) color = "mdLinkUrl";
    else if (/['"]/.test(text)) color = "syntaxString";
    tokens.push({ text, color });
  }
  return tokens;
}

function commandRows(tokens: readonly Token[], width: number, theme: CommandTheme): string[] {
  const rows: string[] = [];
  let line = "";
  let columns = 0;
  const flush = () => {
    rows.push(line);
    line = "";
    columns = 0;
  };
  for (const token of tokens) {
    const tokenWidth = visibleWidth(token.text);
    // Keep whole tokens together when possible; never trim quoted or escaped whitespace.
    if (columns > 0 && tokenWidth <= width && columns + tokenWidth > width) flush();
    if (tokenWidth <= width) {
      line += theme.fg(token.color, token.text);
      columns += tokenWidth;
      continue;
    }
    for (const { segment } of GRAPHEMES.segment(token.text)) {
      const size = visibleWidth(segment);
      if (columns > 0 && columns + size > width) flush();
      line += theme.fg(token.color, segment);
      columns += size;
    }
  }
  if (line || rows.length === 0) flush();
  return rows;
}

export function renderCommandPermissionLines(
  request: CommandPresentation,
  width: number,
  theme: CommandTheme,
): string[] {
  if (width <= 0) return [];
  const padding = width >= 6 ? 1 : 0;
  const gutter = width >= 6 ? 2 : 0;
  const codeWidth = width - padding * 2 - gutter;
  const asciiOnly = codeWidth < 2;
  const escaped = asciiOnly || Array.from(request.command).some(hiddenCharacter);
  const display = escaped ? escapedText(request.command, asciiOnly) : request.command;
  const tokens = escaped ? [{ text: display, color: "text" as const }] : tokenize(display);
  const rows = commandRows(tokens, codeWidth, theme).map((line, index) => {
    const marker = gutter ? theme.fg("muted", index === 0 ? "  " : "↪ ") : "";
    const content = `${" ".repeat(padding)}${marker}${line}`;
    return theme.bg(
      "userMessageBg",
      content + " ".repeat(Math.max(0, width - visibleWidth(content))),
    );
  });
  const fit = (lines: string[]) => lines.flatMap((line) => wrapTextWithAnsi(line, width));
  return [
    ...fit([
      theme.fg("warning", " Run this bash command?"),
      theme.fg("warning", metadata(request.concern)),
      "",
      theme.fg("muted", escaped ? "Command (escaped)" : "Command"),
    ]),
    ...rows,
    "",
    ...fit([theme.fg("muted", `Working directory: ${metadata(request.cwd)}`)]),
    ...renderPermissionPromptActions(
      [
        { label: "Allow once", selected: request.allowSelected },
        { label: "Reject", selected: !request.allowSelected },
      ],
      width,
      theme,
    ),
  ];
}
