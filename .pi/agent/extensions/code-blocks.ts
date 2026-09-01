import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  Markdown,
  type MarkdownTheme,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

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
  isDiff: boolean;
  label: string;
  language?: string;
  path?: string;
}

type CodeBlockTheme = Pick<Theme, "fg" | "getBgAnsi">;

const PATCH_KEY = Symbol.for("dotfiles:pi-code-block-renderer");
const BACKGROUND_RESET = "\u001b[49m";
let resolveActiveTheme: () => CodeBlockTheme | undefined = () => undefined;

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  "c#": "csharp",
  "c++": "cpp",
  console: "shell",
  cs: "csharp",
  diff: "diff",
  docker: "dockerfile",
  golang: "go",
  js: "javascript",
  jsx: "javascript",
  jsonc: "json",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  typescriptreact: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  bash: "Shell",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  dockerfile: "Dockerfile",
  go: "Go",
  graphql: "GraphQL",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  json5: "JSON5",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "cpp",
  html: "html",
  java: "java",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

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

function normaliseLanguage(value: string | undefined): string | undefined {
  const language = value?.trim().toLowerCase();
  if (!language || language === "text" || language === "plaintext" || language === "txt") {
    return undefined;
  }

  return LANGUAGE_ALIASES[language] ?? language;
}

function languageFromPath(path: string | undefined): string | undefined {
  const fileName = path?.split(/[\\/]/).pop()?.toLowerCase();
  if (!fileName) return undefined;
  if (fileName === "dockerfile") return "dockerfile";

  const extension = fileName.includes(".") ? fileName.split(".").pop() : undefined;
  return extension ? EXTENSION_LANGUAGES[extension] : undefined;
}

function diffPath(code: string): string | undefined {
  for (const line of code.split("\n")) {
    const match = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line);
    if (match?.[1] && match[1] !== "/dev/null") return match[1];
  }

  return undefined;
}

function looksLikePath(value: string | undefined): boolean {
  return value?.includes("/") === true || value?.includes(".") === true;
}

function describeCodeBlock(code: string, fenceInfo: string | undefined): CodeBlockDescriptor {
  const [rawLanguage, extraInfo] = fenceInfo?.trim().split(/\s+/, 2) ?? [];
  const explicitLanguage = normaliseLanguage(rawLanguage);
  const isDiff = explicitLanguage === "diff";
  const path = isDiff ? (looksLikePath(extraInfo) ? extraInfo : diffPath(code)) : extraInfo;
  const language = isDiff
    ? looksLikePath(extraInfo)
      ? languageFromPath(extraInfo)
      : (normaliseLanguage(extraInfo) ?? languageFromPath(path))
    : (explicitLanguage ?? languageFromPath(path));
  const languageLabel = LANGUAGE_LABELS[language ?? ""] ?? language ?? "Code";

  if (isDiff) {
    return {
      isDiff,
      label: path ? `Diff ${path}` : "Diff",
      ...(language ? { language } : {}),
      ...(path ? { path } : {}),
    };
  }

  return {
    isDiff,
    label: path ? `${languageLabel} ${path}` : languageLabel,
    ...(language ? { language } : {}),
    ...(path ? { path } : {}),
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

function diffRows(code: string): CodeRow[] {
  const rows: CodeRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of sourceLines(code)) {
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (
      line.startsWith("diff --git ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line === "\\ No newline at end of file"
    ) {
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ content: line.slice(1), kind: "added", lineNumber: newLine, sign: "+" });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ content: line.slice(1), kind: "removed", lineNumber: oldLine, sign: "-" });
      oldLine += 1;
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
  const descriptor = describeCodeBlock(code, token.lang);
  const rows = descriptor.isDiff ? diffRows(code) : codeRows(code);
  const highlightedRows = highlightRows(component, rows, descriptor.language);
  const maxLineNumber = Math.max(...rows.map((row) => row.lineNumber));
  const numberWidth = Math.max(3, String(maxLineNumber).length);
  const gutterWidth = numberWidth + 2;
  const contentWidth = Math.max(1, width - gutterWidth);
  const headerBackground = activeTheme?.getBgAnsi("customMessageBg") ?? "";
  const header = activeTheme?.fg("accent", descriptor.label) ?? descriptor.label;
  const lines = [
    paintBackground("", width, headerBackground),
    paintBackground(`  ${header}`, width, headerBackground),
    paintBackground("", width, headerBackground),
  ];

  for (const [index, row] of rows.entries()) {
    const highlighted = highlightedRows[index] ?? component.theme.codeBlock(row.content);
    const wrapped = wrapTextWithAnsi(highlighted, contentWidth);
    const visualLines = wrapped.length > 0 ? wrapped : [""];
    const background = rowBackground(row.kind, activeTheme);

    for (const [visualIndex, visualLine] of visualLines.entries()) {
      const gutter =
        visualIndex === 0 ? renderGutter(row, numberWidth, activeTheme) : " ".repeat(gutterWidth);
      lines.push(paintBackground(`${gutter}${visualLine}`, width, background));
    }
  }

  lines.push(paintBackground("", width, activeTheme?.getBgAnsi("userMessageBg") ?? ""));
  if (nextTokenType && nextTokenType !== "space") lines.push("");
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
