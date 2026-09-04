import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PERMISSION_TITLE = "Permission Required";
const WARNING_ICON = "\uf071";

/** Nerd Font icons use the common Font Awesome codepoints available in the configured terminal font. */
const FACT_ICONS = {
  agent: "\uf007",
  action: "\uf06e",
  scope: "\uf07b",
  rule: "\uf1de",
  path: "\uf15b",
  cwd: "\uf3c5",
} as const;

type PermissionPromptTheme = Pick<Theme, "fg">;
type FactLabel = "subagent" | "tool" | "surface" | "rule" | "path" | "working directory";

interface ParsedFact {
  label: FactLabel;
  plainValue: string;
  rawValue: string;
}

interface DisplayFact {
  label: string;
  icon: string;
  value: string;
}

const FACT_PATTERN = /^\s*(subagent|tool|surface|rule|path|working directory)\s+:\s(.*)$/;
const SURFACE_ACTION_SUFFIXES = [
  "_read",
  "_write",
  "_edit",
  "_execute",
  "_delete",
  "_network",
] as const;

const ACTIONS: Record<string, { label: string; icon: string }> = {
  bash: { label: "Execute", icon: "\uf120" },
  edit: { label: "Edit", icon: "\uf044" },
  find: { label: "Find", icon: "\uf002" },
  grep: { label: "Search", icon: "\uf002" },
  ls: { label: "List", icon: "\uf07b" },
  powershell: { label: "Execute", icon: "\uf120" },
  read: { label: "Read", icon: "\uf06e" },
  webfetch: { label: "Network", icon: "\uf0ac" },
  websearch: { label: "Network", icon: "\uf0ac" },
  write: { label: "Write", icon: "\uf044" },
};

const FACT_DISPLAY: Record<Exclude<FactLabel, "tool" | "surface">, Omit<DisplayFact, "value">> = {
  "working directory": { label: "cwd", icon: FACT_ICONS.cwd },
  path: { label: "path", icon: FACT_ICONS.path },
  rule: { label: "rule", icon: FACT_ICONS.rule },
  subagent: { label: "agent", icon: FACT_ICONS.agent },
};

/**
 * Add a visual hierarchy to the third-party permission component's fact rows.
 *
 * The permission package owns the component and its interaction model. This
 * adapter changes only rendered lines, preserving original ANSI-highlighted
 * values and returning unrelated custom dialogs untouched.
 */
export function renderPermissionPromptLines(
  lines: readonly string[],
  width: number,
  theme: PermissionPromptTheme,
): string[] {
  if (!isPermissionPrompt(lines)) return [...lines];

  const facts = lines.map(parseFact);
  const displayFacts = facts.map((fact) => (fact ? displayFact(fact) : undefined));
  const labelWidth = Math.max(
    0,
    ...displayFacts
      .filter((fact): fact is DisplayFact => fact !== undefined)
      .map((fact) => fact.label.length),
  );

  const decorated = lines.map((line, index) => {
    if (index === 0) {
      return `${theme.fg("warning", WARNING_ICON)} ${line}`;
    }

    const fact = displayFacts[index];
    if (!fact) return line;

    return `${theme.fg("accent", fact.icon)} ${fact.label.padEnd(labelWidth)} : ${fact.value}`;
  });

  return fitLinesToWidth(decorated, width);
}

function isPermissionPrompt(lines: readonly string[]): boolean {
  const title = lines[0];
  return title !== undefined && stripTerminalSequences(title).startsWith(PERMISSION_TITLE);
}

function parseFact(line: string): ParsedFact | undefined {
  const plain = stripTerminalSequences(line);
  const match = FACT_PATTERN.exec(plain);
  if (!match) return undefined;

  const label = match[1] as FactLabel;
  const separator = line.indexOf(" : ");
  return {
    label,
    plainValue: match[2] ?? "",
    rawValue: separator === -1 ? (match[2] ?? "") : line.slice(separator + 3),
  };
}

function displayFact(fact: ParsedFact): DisplayFact {
  if (fact.label === "tool") {
    return displayAction(fact.plainValue);
  }

  if (fact.label === "surface") {
    return {
      label: "scope",
      icon: FACT_ICONS.scope,
      value: humanizeSurface(fact.plainValue),
    };
  }

  const display = FACT_DISPLAY[fact.label];
  const value =
    fact.label === "rule" && fact.plainValue === "*"
      ? `${fact.rawValue} (wildcard)`
      : fact.rawValue;
  return { ...display, value };
}

function displayAction(value: string): DisplayFact {
  const trimmed = value.trim();
  const nameEnd = trimmed.search(/[\s(]/);
  const name = (nameEnd === -1 ? trimmed : trimmed.slice(0, nameEnd)).toLowerCase();
  const action = ACTIONS[name] ?? {
    label: humanize(name || trimmed),
    icon: FACT_ICONS.action,
  };
  const suffix = nameEnd === -1 ? "" : trimmed.slice(nameEnd);
  return { label: "action", icon: action.icon, value: `${action.label}${suffix}` };
}

function humanizeSurface(value: string): string {
  const normalized = value.trim().toLowerCase();
  const suffix = SURFACE_ACTION_SUFFIXES.find((candidate) => normalized.endsWith(candidate));
  const base = suffix === undefined ? normalized : normalized.slice(0, -suffix.length);
  const names: Record<string, string> = {
    bash: "Shell",
    external_directory: "External directory",
    mcp: "MCP",
    path: "Path",
    skill: "Skill",
    tool: "Tool",
  };
  return names[base] ?? humanize(normalized);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function fitLinesToWidth(lines: readonly string[], width: number): string[] {
  if (width <= 0) return [];
  return lines.flatMap((line) =>
    wrapTextWithAnsi(line, width).map((wrapped) => truncateToWidth(wrapped, width)),
  );
}
