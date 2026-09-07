import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const PERMISSION_TITLE = "Permission Required";
const WARNING_ICON = "△";
const REQUEST_ARROW = "←";
const OPTION_GAP = "    ";

type PermissionPromptTheme = Pick<Theme, "fg" | "inverse">;

interface ParsedFact {
  label: string;
  value: string;
}

interface ParsedOption {
  label: string;
  selected: boolean;
}

const FACT_PATTERN = /^\s*([^:]+?)\s+:\s(.*)$/;
const OPTION_PATTERN = /^\s*(▶)?\s*\([a-z]\)\s+(.*)$/;
const SURFACE_ACTION_SUFFIXES = [
  "_read",
  "_write",
  "_edit",
  "_execute",
  "_delete",
  "_network",
] as const;

const ACTION_LABELS: Record<string, string> = {
  bash: "Execute",
  delete: "Delete",
  edit: "Edit",
  execute: "Execute",
  find: "Find",
  grep: "Search",
  ls: "List",
  powershell: "Execute",
  read: "Read",
  webfetch: "Network",
  websearch: "Network",
  write: "Write",
};

const SURFACE_NOUNS: Record<string, string> = {
  bash: "command",
  external_directory: "external directory",
  mcp: "MCP target",
  path: "path",
  skill: "skill",
  tool: "tool",
};

/** Render the permission component as a compact inline approval prompt. */
export function renderPermissionPromptLines(
  lines: readonly string[],
  width: number,
  theme: PermissionPromptTheme,
): string[] {
  if (!isPermissionPrompt(lines)) return [...lines];
  if (width <= 0) return [];

  const facts = lines
    .slice(1)
    .map(parseFact)
    .filter((fact): fact is ParsedFact => fact !== undefined);
  const optionStart = lines.findIndex(
    (line, index) => index > 0 && parseOption(line) !== undefined,
  );
  const base = renderPromptBase(lines[0] ?? "", facts, theme);

  if (optionStart === -1) {
    const tail = renderTail(lines, facts);
    return fitLinesToWidth([...base, ...(tail.length > 0 ? ["", ...tail] : [])], width);
  }

  const options = lines
    .slice(optionStart)
    .map(parseOption)
    .filter((option): option is ParsedOption => option !== undefined)
    .filter((option) => compactOptionLabel(option.label) !== "Allow both");
  const hint = theme.fg("muted", "↑/↓ select · enter confirm · esc deny");
  const optionRows = renderOptionRows(options, width, theme);
  const actionRows =
    optionRows.length === 1
      ? [fitColumns(optionRows[0] ?? "", hint, width)]
      : [...optionRows, hint];

  return fitLinesToWidth(
    [...base, "", theme.fg("borderMuted", "─".repeat(width)), ...actionRows],
    width,
  );
}

export function isPermissionDecisionPromptLines(lines: readonly string[]): boolean {
  return (
    isPermissionPrompt(lines) &&
    lines.some((line, index) => index > 0 && parseOption(line) !== undefined)
  );
}

function isPermissionPrompt(lines: readonly string[]): boolean {
  const title = lines[0];
  return title !== undefined && stripTerminalSequences(title).startsWith(PERMISSION_TITLE);
}

function parseFact(line: string): ParsedFact | undefined {
  const match = FACT_PATTERN.exec(stripTerminalSequences(line));
  if (!match) return undefined;

  return {
    label: match[1]?.trim() ?? "",
    value: match[2] ?? "",
  };
}

function parseOption(line: string): ParsedOption | undefined {
  const match = OPTION_PATTERN.exec(stripTerminalSequences(line));
  if (!match) return undefined;

  return {
    label: match[2] ?? "",
    selected: match[1] !== undefined,
  };
}

function renderPromptBase(
  titleLine: string,
  facts: readonly ParsedFact[],
  theme: PermissionPromptTheme,
): string[] {
  const title = stripTerminalSequences(titleLine).replace(PERMISSION_TITLE, "Permission required");
  const lines = [theme.fg("warning", `${WARNING_ICON} ${title}`), ...renderRequest(facts, theme)];
  const patterns = facts.filter((fact) => fact.label.toLowerCase() === "rule");

  if (patterns.length > 0) {
    lines.push(theme.fg("muted", "Patterns"));
    lines.push(...patterns.map((pattern) => `- ${pattern.value}`));
  }

  return lines;
}

function renderRequest(facts: readonly ParsedFact[], theme: PermissionPromptTheme): string[] {
  const surface = factValue(facts, "surface") ?? factValue(facts, "tool") ?? "permission";
  const { base, action } = splitSurface(surface);
  const tool = factValue(facts, "tool");
  const value = requestValue(facts, base);
  const verb = requestVerb(base, action, tool);
  const noun = SURFACE_NOUNS[base] ?? humanize(base).toLowerCase();
  const prefix = theme.fg("muted", `    ${REQUEST_ARROW} ${verb} ${noun}`);
  const lines =
    value === undefined
      ? [prefix]
      : [`${prefix} ${theme.fg(base === "bash" ? "warning" : "accent", value)}`];
  const command = factValue(facts, "command");
  if (command !== undefined && base !== "bash") {
    lines.push(`${theme.fg("muted", "      ↳ command")} ${theme.fg("warning", command)}`);
  }
  return lines;
}

function requestValue(facts: readonly ParsedFact[], surface: string): string | undefined {
  const labels =
    surface === "external_directory"
      ? ["path", "external path"]
      : surface === "bash"
        ? ["command"]
        : ["path", "target", "skill", "command", "input", "external path"];
  return labels
    .map((label) => factValue(facts, label))
    .find((candidate) => candidate !== undefined);
}

function requestVerb(base: string, action: string | undefined, tool: string | undefined): string {
  if (base === "external_directory") return "Access";
  return ACTION_LABELS[action ?? ""] ?? ACTION_LABELS[tool ?? ""] ?? "Access";
}

function splitSurface(value: string): { base: string; action?: string } {
  const normalized = value.trim().toLowerCase();
  const suffix = SURFACE_ACTION_SUFFIXES.find((candidate) => normalized.endsWith(candidate));
  return suffix === undefined
    ? { base: normalized }
    : { base: normalized.slice(0, -suffix.length), action: suffix.slice(1) };
}

function factValue(facts: readonly ParsedFact[], label: string): string | undefined {
  return facts.find((fact) => fact.label.toLowerCase() === label)?.value;
}

function renderTail(lines: readonly string[], facts: readonly ParsedFact[]): string[] {
  let lastFactIndex = 0;
  for (const [index, line] of lines.entries()) {
    if (parseFact(line) !== undefined) lastFactIndex = index;
  }
  if (facts.length === 0) return lines.slice(1).filter((line) => line.trim().length > 0);
  return lines.slice(lastFactIndex + 1).filter((line) => line.trim().length > 0);
}

/** Pad each action label horizontally so the selected background reads as a button. */
function renderOptionRows(
  options: readonly ParsedOption[],
  width: number,
  theme: PermissionPromptTheme,
): string[] {
  const rendered = options.map((option) => {
    const label = truncateToWidth(compactOptionLabel(option.label), Math.max(0, width - 2));
    const paddedLabel = truncateToWidth(` ${label} `, width);
    const text = theme.fg(option.selected ? "accent" : "muted", paddedLabel);
    return option.selected ? theme.inverse(text) : text;
  });
  const rows: string[] = [];
  let current = "";

  for (const option of rendered) {
    const candidate = current.length === 0 ? option : `${current}${OPTION_GAP}${option}`;
    if (current.length > 0 && visibleWidth(candidate) > width) {
      rows.push(current);
      current = option;
    } else {
      current = truncateToWidth(candidate, width);
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}
function fitColumns(left: string, right: string, width: number): string {
  const leftText = truncateToWidth(left, width, "");
  const remaining = Math.max(0, width - visibleWidth(leftText));
  const rightText = truncateToWidth(right, remaining, "");
  const gap = Math.max(0, remaining - visibleWidth(rightText));
  return `${leftText}${" ".repeat(gap)}${rightText}`;
}

/** Keep repeated grant details out of the action row; the pattern is already above it. */
function compactOptionLabel(label: string): string {
  const normalized = label.trim();
  if (normalized === "Allow once") return normalized;
  if (normalized === "Allow in future sessions…") return "Allow always";
  if (normalized === "Deny") return "Reject";
  if (normalized === "Deny with reason") return "Reject + reason";
  if (/^(?:Yes, )?allow .+ and .+ for this session$/i.test(normalized)) return "Allow both";
  if (/^(?:Yes, )?allow .+ for this session$/i.test(normalized)) return "Allow session";
  if (normalized === "Allow for this session") return "Allow session";
  if (normalized === "Allow both directions for this session") return "Allow both";
  return normalized;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function fitLinesToWidth(lines: readonly string[], width: number): string[] {
  return lines.flatMap((line) =>
    wrapTextWithAnsi(line, width).map((wrapped) => truncateToWidth(wrapped, width)),
  );
}
