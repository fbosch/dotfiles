import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const PERMISSION_TITLE = "Permission Required";
const WARNING_ICON = "\uf071";

/** Keep the icon treatment sparse: the title and requested action are the only icons. */
type PermissionPromptTheme = Pick<Theme, "fg">;
type FactLabel =
  | "subagent"
  | "tool"
  | "surface"
  | "rule"
  | "path"
  | "working directory"
  | "command"
  | "external path";

interface ParsedFact {
  label: FactLabel;
  plainValue: string;
  rawValue: string;
}

interface DisplayFact {
  label: string;
  icon?: string;
  labelColor: ThemeColor;
  value: string;
  valueColor?: ThemeColor;
}

const FACT_PATTERN =
  /^\s*(subagent|tool|surface|rule|path|working directory|command|external path)\s+:\s(.*)$/;
const SURFACE_ACTION_SUFFIXES = [
  "_read",
  "_write",
  "_edit",
  "_execute",
  "_delete",
  "_network",
] as const;

const ACTIONS: Record<string, { label: string; icon: string; color: ThemeColor }> = {
  bash: { label: "Execute", icon: "\uf120", color: "warning" },
  edit: { label: "Edit", icon: "\uf044", color: "warning" },
  find: { label: "Find", icon: "\uf002", color: "success" },
  grep: { label: "Search", icon: "\uf002", color: "success" },
  ls: { label: "List", icon: "\uf07b", color: "success" },
  powershell: { label: "Execute", icon: "\uf120", color: "warning" },
  read: { label: "Read", icon: "\uf06e", color: "success" },
  webfetch: { label: "Network", icon: "\uf0ac", color: "accent" },
  websearch: { label: "Network", icon: "\uf0ac", color: "accent" },
  write: { label: "Write", icon: "\uf044", color: "warning" },
};

type MetadataFactLabel = Exclude<FactLabel, "tool" | "surface">;

const FACT_DISPLAY: Record<MetadataFactLabel, Omit<DisplayFact, "value">> = {
  "working directory": { label: "cwd", labelColor: "muted" },
  command: { label: "command", labelColor: "muted" },
  "external path": { label: "external path", labelColor: "muted" },
  path: { label: "path", labelColor: "muted" },
  rule: { label: "rule", labelColor: "muted" },
  subagent: { label: "agent", labelColor: "muted" },
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
      return theme.fg("warning", `${WARNING_ICON} ${stripTerminalSequences(line)}`);
    }

    const fact = displayFacts[index];
    if (!fact) return line;

    const label = theme.fg(fact.labelColor, fact.label.padEnd(labelWidth));
    const valueColor = fact.valueColor ?? fact.labelColor;
    const icon = fact.icon === undefined ? "" : `${theme.fg(valueColor, fact.icon)} `;
    const value =
      fact.valueColor === undefined ? fact.value : theme.fg(fact.valueColor, fact.value);
    return `${label} : ${icon}${value}`;
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
      labelColor: "muted",
      value: humanizeSurface(fact.plainValue),
      valueColor: "accent",
    };
  }

  const display = FACT_DISPLAY[fact.label];
  const wildcard = fact.label === "rule" && fact.plainValue === "*";
  return {
    ...display,
    value: wildcard ? `${fact.rawValue} (wildcard)` : fact.rawValue,
    ...(wildcard ? { valueColor: "warning" as const } : {}),
  };
}

function displayAction(value: string): DisplayFact {
  const trimmed = value.trim();
  const nameEnd = trimmed.search(/[\s(]/);
  const name = (nameEnd === -1 ? trimmed : trimmed.slice(0, nameEnd)).toLowerCase();
  const action = ACTIONS[name] ?? {
    label: humanize(name || trimmed),
    icon: "",
    color: "accent" as const,
  };
  const suffix = nameEnd === -1 ? "" : trimmed.slice(nameEnd);
  return {
    label: "action",
    icon: action.icon,
    labelColor: "muted",
    value: `${action.label}${suffix}`,
    valueColor: action.color,
  };
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
