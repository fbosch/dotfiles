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
    if (/^\s+$/.test(text)) {
      tokens.push({ text, color });
      if (text.includes("\n")) {
        comment = false;
        executable = true;
        redirectTarget = false;
      }
      continue;
    }
    if (comment) color = "syntaxComment";
    else if (text.startsWith("#")) {
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
    // Quoted payloads may contain whole files; keep them at normal reading contrast.
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

export function renderCommandPermissionSections(
  request: CommandPresentation,
  width: number,
  theme: CommandTheme,
): { header: string[]; body: string[]; footer: string[] } {
  if (width <= 0) return { header: [], body: [], footer: [] };
  const lineCount = request.command.split("\n").length;
  const numberWidth = String(lineCount).length;
  const numbered = lineCount > 1 && width >= numberWidth + 7;
  const padding = width >= 6 ? 1 : 0;
  const gutter = numbered ? numberWidth + 3 : width >= 6 ? 2 : 0;
  const codeWidth = width - padding * 2 - gutter;
  const asciiOnly = codeWidth < 2;
  const escaped =
    asciiOnly || Array.from(request.command).some((char) => char !== "\n" && hiddenCharacter(char));
  const display = escaped
    ? request.command
        .split("\n")
        .map((line) => escapedText(line, asciiOnly))
        .join("\n")
    : request.command;
  const tokens = escaped ? [{ text: display, color: "text" as const }] : tokenize(display);
  let sourceLine: Token[] = [];
  const sourceLines = [sourceLine];
  // Split after tokenizing so multiline quoted payloads are not recolored as executables.
  for (const token of tokens) {
    for (const [index, fragment] of token.text.split("\n").entries()) {
      if (index > 0) {
        sourceLine = [];
        sourceLines.push(sourceLine);
      }
      sourceLine.push({ text: fragment, color: token.color });
    }
  }
  const rows = sourceLines.flatMap((lineTokens, sourceIndex) =>
    commandRows(lineTokens, codeWidth, theme).map((line, index) => {
      const label = index === 0 ? String(sourceIndex + 1) : "↪";
      const marker = gutter
        ? theme.fg(
            "muted",
            numbered ? `${label.padStart(numberWidth)} │ ` : index === 0 ? "  " : "↪ ",
          )
        : "";
      const content = `${" ".repeat(padding)}${marker}${line}`;
      return theme.bg(
        "userMessageBg",
        content + " ".repeat(Math.max(0, width - visibleWidth(content))),
      );
    }),
  );
  const fit = (lines: string[]) => lines.flatMap((line) => wrapTextWithAnsi(line, width));
  return {
    header: fit([
      theme.fg("warning", " Run this bash command?"),
      theme.fg("warning", metadata(request.concern)),
      theme.fg("muted", `Working directory: ${metadata(request.cwd)}`),
      "",
    ]),
    body: [
      ...fit([
        theme.fg("accent", escaped ? "Command (escaped)" : "Command"),
        ...(escaped ? [theme.fg("muted", "Each source line below is a JSON string.")] : []),
      ]),
      ...rows,
    ],
    footer: renderPermissionPromptActions(
      [
        { label: "Run command", selected: request.allowSelected },
        { label: "Cancel", selected: !request.allowSelected },
      ],
      width,
      theme,
      "cancel",
    ),
  };
}

export function renderCommandPermissionLines(
  request: CommandPresentation,
  width: number,
  theme: CommandTheme,
): string[] {
  const { header, body, footer } = renderCommandPermissionSections(request, width, theme);
  return [...header, ...body, ...footer];
}
