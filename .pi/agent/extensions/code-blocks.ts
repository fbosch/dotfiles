import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  type MarkdownTheme,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  GENERIC_FILE_ICON,
  LANGUAGE_ICONS,
  LANGUAGE_LABELS,
  languageFromPath,
  normaliseLanguage,
} from "../lib/code-languages";

interface MarkdownToken {
  type: string;
  lang?: string;
  text?: string;
}

interface MarkdownInternals {
  theme: MarkdownTheme;
  renderToken: RenderToken;
}

type CodeBlockComponent = Pick<MarkdownInternals, "theme">;

type RenderToken = (
  this: MarkdownInternals,
  token: MarkdownToken,
  width: number,
  nextTokenType?: string,
  styleContext?: unknown,
) => string[];

interface PatchState {
  prototype: MarkdownInternals;
  patchedRenderToken: RenderToken;
  originalRenderToken: RenderToken;
  restore: () => void;
}

export interface CodeBlockPatch {
  installed: boolean;
  reason?: string;
  restore: () => void;
}

type RowKind = "context" | "added" | "removed";

interface CodeRow {
  content: string;
  kind: RowKind;
  lineNumber: number;
  sign: " " | "+" | "-";
}

interface CodeBlockDescriptor {
  icon: string;
  isDiff: boolean;
  label: string;
  language?: string;
}

interface HunkHeader {
  oldCount: number;
  oldStart: number;
  newCount: number;
  newStart: number;
}

type CodeBlockTheme = Pick<Theme, "fg" | "getBgAnsi">;

const PATCH_KEY = Symbol.for("dotfiles:pi-code-block-renderer");
const BACKGROUND_RESET = "\u001b[49m";
let resolveActiveTheme: () => CodeBlockTheme | undefined = () => undefined;

function globalPatchState(): PatchState | undefined {
  return (globalThis as typeof globalThis & { [PATCH_KEY]?: PatchState })[PATCH_KEY];
}

function setGlobalPatchState(state: PatchState | undefined): void {
  const target = globalThis as typeof globalThis & { [PATCH_KEY]?: PatchState };
  if (state) {
    target[PATCH_KEY] = state;
    return;
  }

  delete target[PATCH_KEY];
}

function diffPath(code: string): string | undefined {
  let oldPath: string | undefined;
  for (const line of code.split("\n")) {
    if (parseHunkHeader(line)) break;

    const newMatch = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line);
    if (newMatch?.[1] && newMatch[1] !== "/dev/null") return newMatch[1];

    const oldMatch = /^---\s+(?:a\/)?(.+)$/.exec(line);
    if (oldMatch?.[1] && oldMatch[1] !== "/dev/null") oldPath = oldMatch[1];
  }

  return oldPath;
}

function isFilePath(value: string | undefined): value is string {
  if (!value || value.includes("://")) return false;
  const fileName = value.split(/[\\/]/).pop();
  return (
    fileName === "Dockerfile" || fileName === "Makefile" || /\.[A-Za-z0-9]+$/.test(fileName ?? "")
  );
}

function pathFromFenceInfo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const attribute = /(?:^|\s)(?:file|filename|title)=(?:"([^"]+)"|'([^']+)'|(\S+))(?=\s|$)/.exec(
    value,
  );
  const candidate = attribute ? (attribute[1] ?? attribute[2] ?? attribute[3]) : value;
  return isFilePath(candidate) ? candidate : undefined;
}

function pathFromLeadingComment(code: string): string | undefined {
  const firstLine = code.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) return undefined;

  const patterns = [
    /^\s*\/\/\s*(.+?)\s*$/,
    /^\s*#\s*(.+?)\s*$/,
    /^\s*--\s*(.+?)\s*$/,
    /^\s*\/\*\s*(.+?)\s*\*\/\s*$/,
    /^\s*<!--\s*(.+?)\s*-->\s*$/,
  ];
  for (const pattern of patterns) {
    const candidate = pattern.exec(firstLine)?.[1]?.trim();
    if (isFilePath(candidate)) return candidate;
  }

  return undefined;
}

export function associateFilenamesWithCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  const transformed: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const path = /^\s*`\s*([^`]+?)\s*`\s*$/.exec(line)?.[1]?.trim();
    if (!isFilePath(path)) {
      transformed.push(line);
      continue;
    }

    let fenceIndex = index + 1;
    while (lines[fenceIndex]?.trim() === "") fenceIndex += 1;
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[fenceIndex] ?? "");
    if (!fence) {
      transformed.push(line);
      continue;
    }

    const indentation = fence[1] ?? "";
    const marker = fence[2] ?? "```";
    const info = fence[3]?.trim() || languageFromPath(path) || "text";
    transformed.push(`${indentation}${marker}${info} filename=${JSON.stringify(path)}`);
    index = fenceIndex;
  }

  return transformed.join("\n");
}

function describeCodeBlock(code: string, fenceInfo: string | undefined): CodeBlockDescriptor {
  const info = /^(\S+)(?:\s+(.+))?$/.exec(fenceInfo?.trim() ?? "");
  const rawLanguage = info?.[1];
  const extraInfo = info?.[2]?.trim();
  const explicitLanguage = normaliseLanguage(rawLanguage);
  const isDiff = explicitLanguage === "diff";
  const explicitPath = pathFromFenceInfo(extraInfo);
  const path = isDiff
    ? (explicitPath ?? diffPath(code))
    : (explicitPath ?? pathFromLeadingComment(code));
  const language = isDiff
    ? explicitPath
      ? languageFromPath(explicitPath)
      : (normaliseLanguage(extraInfo) ?? languageFromPath(path))
    : (explicitLanguage ?? languageFromPath(path));
  const languageLabel = LANGUAGE_LABELS[language ?? ""] ?? language ?? "Code";
  const icon = LANGUAGE_ICONS[language ?? ""] ?? (isDiff ? LANGUAGE_ICONS.diff : GENERIC_FILE_ICON);

  if (isDiff) {
    return {
      icon,
      isDiff,
      label: path ?? "Diff",
      ...(language ? { language } : {}),
    };
  }

  return {
    icon,
    isDiff,
    label: path ?? languageLabel,
    ...(language ? { language } : {}),
  };
}

function sourceLines(code: string): string[] {
  const lines = code.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines.length > 0 ? lines : [""];
}

function codeRows(code: string): CodeRow[] {
  return sourceLines(code).map((content, index) => ({
    content,
    kind: "context",
    lineNumber: index + 1,
    sign: " ",
  }));
}

function parseHunkHeader(line: string): HunkHeader | undefined {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
  if (!match) return undefined;

  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  };
}

function splitDiffSections(code: string): string[] {
  const sections: string[][] = [];
  let current: string[] = [];
  let hasFileHeader = false;
  let oldLinesRemaining = 0;
  let newLinesRemaining = 0;
  let inHunk = false;

  const lines = sourceLines(code);
  for (const [index, line] of lines.entries()) {
    const startsFileHeader =
      inHunk === false && line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ");
    if (
      current.length > 0 &&
      (line.startsWith("diff --git ") || (startsFileHeader && hasFileHeader))
    ) {
      sections.push(current);
      current = [];
      hasFileHeader = false;
      oldLinesRemaining = 0;
      newLinesRemaining = 0;
      inHunk = false;
    }
    current.push(line);

    if (startsFileHeader) hasFileHeader = true;
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLinesRemaining = hunk.oldCount;
      newLinesRemaining = hunk.newCount;
      inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
      continue;
    }
    if (inHunk === false || line === "\\ No newline at end of file") continue;

    if (line.startsWith("+")) newLinesRemaining -= 1;
    else if (line.startsWith("-")) oldLinesRemaining -= 1;
    else {
      oldLinesRemaining -= 1;
      newLinesRemaining -= 1;
    }
    inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
  }

  if (current.length > 0) sections.push(current);
  return sections.map((section) => section.join("\n"));
}

function isDiffMetadata(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("old mode ") ||
    line.startsWith("new mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("copy from ") ||
    line.startsWith("copy to ") ||
    line.startsWith("Binary files ") ||
    line === "GIT binary patch"
  );
}

function diffRows(code: string): CodeRow[] {
  const rows: CodeRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  let oldLinesRemaining = 0;
  let newLinesRemaining = 0;
  let inHunk = false;

  for (const line of sourceLines(code)) {
    const hunk = parseHunkHeader(line);
    if (hunk) {
      oldLine = hunk.oldStart;
      oldLinesRemaining = hunk.oldCount;
      newLine = hunk.newStart;
      newLinesRemaining = hunk.newCount;
      inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
      continue;
    }
    if (line === "\\ No newline at end of file") continue;
    if (inHunk === false && isDiffMetadata(line)) {
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ content: line.slice(1), kind: "added", lineNumber: newLine, sign: "+" });
      newLine += 1;
      newLinesRemaining -= 1;
      inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ content: line.slice(1), kind: "removed", lineNumber: oldLine, sign: "-" });
      oldLine += 1;
      oldLinesRemaining -= 1;
      inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
      continue;
    }

    rows.push({
      content: line.startsWith(" ") ? line.slice(1) : line,
      kind: "context",
      lineNumber: newLine,
      sign: " ",
    });
    oldLine += 1;
    newLine += 1;
    oldLinesRemaining -= 1;
    newLinesRemaining -= 1;
    inHunk = oldLinesRemaining > 0 || newLinesRemaining > 0;
  }

  return rows.length > 0 ? rows : codeRows("");
}

function highlightRows(
  component: CodeBlockComponent,
  rows: readonly CodeRow[],
  language: string | undefined,
): string[] {
  const fallback = rows.map((row) => component.theme.codeBlock(row.content));
  if (!component.theme.highlightCode) return fallback;

  try {
    const highlighted = component.theme.highlightCode(
      rows.map((row) => row.content).join("\n"),
      language,
    );
    return highlighted.length === rows.length ? highlighted : fallback;
  } catch {
    return fallback;
  }
}

function paintBackground(content: string, width: number, backgroundAnsi: string): string {
  const fitted = truncateToWidth(content, width, "");
  const padded = `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`
    .replaceAll("\u001b[0m", `\u001b[0m${backgroundAnsi}`)
    .replaceAll(BACKGROUND_RESET, `${BACKGROUND_RESET}${backgroundAnsi}`);
  return `${backgroundAnsi}${padded}${BACKGROUND_RESET}`;
}

function rowBackground(kind: RowKind, activeTheme: CodeBlockTheme | undefined): string {
  if (!activeTheme) return "";
  if (kind === "added") return activeTheme.getBgAnsi("toolSuccessBg");
  if (kind === "removed") return activeTheme.getBgAnsi("toolErrorBg");
  return activeTheme.getBgAnsi("userMessageBg");
}

function renderGutter(
  row: CodeRow,
  numberWidth: number,
  activeTheme: CodeBlockTheme | undefined,
): string {
  const style = (color: "muted" | "success" | "error", text: string) =>
    activeTheme?.fg(color, text) ?? text;
  const lineNumber = style("muted", String(row.lineNumber).padStart(numberWidth));
  if (row.sign === "+") return `${lineNumber}${style("success", "+")} `;
  if (row.sign === "-") return `${lineNumber}${style("error", "-")} `;
  return `${lineNumber}  `;
}

export function renderCodeBlock(
  component: CodeBlockComponent,
  token: MarkdownToken,
  width: number,
  nextTokenType?: string,
  activeTheme = resolveActiveTheme(),
): string[] {
  const code = token.text ?? "";
  const isDiff = normaliseLanguage(token.lang?.trim().split(/\s+/, 1)[0]) === "diff";
  const sections = isDiff ? splitDiffSections(code) : [code];
  const lines: string[] = [];

  for (const [sectionIndex, section] of sections.entries()) {
    if (sectionIndex > 0) lines.push("");
    lines.push(...renderCodePanel(component, section, token.lang, width, activeTheme));
  }

  if (nextTokenType && nextTokenType !== "space") lines.push("");
  return lines;
}

function renderCodePanel(
  component: CodeBlockComponent,
  code: string,
  fenceInfo: string | undefined,
  width: number,
  activeTheme: CodeBlockTheme | undefined,
): string[] {
  const descriptor = describeCodeBlock(code, fenceInfo);
  const rows = descriptor.isDiff ? diffRows(code) : codeRows(code);
  const highlightedRows = highlightRows(component, rows, descriptor.language);
  const maxLineNumber = Math.max(...rows.map((row) => row.lineNumber));
  const numberWidth = Math.max(3, String(maxLineNumber).length);
  const gutterWidth = width > numberWidth + 2 ? numberWidth + 2 : 0;
  const contentWidth = Math.max(1, width - gutterWidth);
  const headerBackground = activeTheme?.getBgAnsi("customMessageBg") ?? "";
  const headerText = `${descriptor.icon} ${descriptor.label}`;
  const header = activeTheme?.fg("accent", headerText) ?? headerText;
  const lines = [
    paintBackground("", width, headerBackground),
    paintBackground(`  ${header}`, width, headerBackground),
    paintBackground("", width, headerBackground),
    paintBackground("", width, activeTheme?.getBgAnsi("userMessageBg") ?? ""),
  ];

  for (const [index, row] of rows.entries()) {
    const highlighted = highlightedRows[index] ?? component.theme.codeBlock(row.content);
    const wrapped = wrapTextWithAnsi(highlighted, contentWidth);
    const visualLines = wrapped.length > 0 ? wrapped : [""];
    const background = rowBackground(row.kind, activeTheme);

    for (const [visualIndex, visualLine] of visualLines.entries()) {
      const gutter =
        gutterWidth === 0
          ? ""
          : visualIndex === 0
            ? renderGutter(row, numberWidth, activeTheme)
            : " ".repeat(gutterWidth);
      lines.push(paintBackground(`${gutter}${visualLine}`, width, background));
    }
  }

  lines.push(paintBackground("", width, activeTheme?.getBgAnsi("userMessageBg") ?? ""));
  return lines;
}

export function installCodeBlockRenderer(): CodeBlockPatch {
  globalPatchState()?.restore();

  const prototype = Markdown.prototype as unknown as MarkdownInternals;
  const originalRenderToken = prototype.renderToken;
  if (typeof originalRenderToken !== "function") {
    return {
      installed: false,
      reason: "This Pi TUI version does not expose the expected Markdown renderer.",
      restore: () => {},
    };
  }

  const patchedRenderToken: RenderToken = function (
    token,
    width,
    nextTokenType,
    styleContext,
  ): string[] {
    if (token.type === "code") return renderCodeBlock(this, token, width, nextTokenType);
    return originalRenderToken.call(this, token, width, nextTokenType, styleContext);
  };

  prototype.renderToken = patchedRenderToken;
  let state: PatchState;
  const restore = (): void => {
    if (prototype.renderToken === patchedRenderToken) prototype.renderToken = originalRenderToken;
    if (globalPatchState() === state) setGlobalPatchState(undefined);
  };
  state = { prototype, patchedRenderToken, originalRenderToken, restore };
  setGlobalPatchState(state);

  return { installed: true, restore };
}

export default function codeBlocks(pi: ExtensionAPI): void {
  const patch = installCodeBlockRenderer();
  pi.registerMarkdownTransformer((markdown) => associateFilenamesWithCodeFences(markdown));

  pi.on("session_start", (_event, ctx) => {
    resolveActiveTheme = () => ctx.ui.theme;
    if (ctx.mode === "tui" && patch.installed === false) {
      ctx.ui.notify(patch.reason ?? "Pi could not patch Markdown code-block rendering.", "warning");
    }
  });

  pi.on("session_shutdown", () => {
    resolveActiveTheme = () => undefined;
    patch.restore();
  });
}
