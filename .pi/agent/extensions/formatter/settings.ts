export const DEFAULT_FORMATTER_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

export type FormatterMode = "first_available" | "pipeline";

export interface FormatterCommand {
  readonly args: readonly string[];
  readonly command: string;
  readonly requireRootMarker: boolean;
  readonly rootMarkers: readonly string[];
}

export interface FormatterRule {
  readonly commands: readonly FormatterCommand[];
  readonly extensions: readonly string[];
  readonly fileNames: readonly string[];
  readonly id: string;
  readonly mode: FormatterMode;
}

export interface ResolvedFormatterSettings {
  readonly rules: readonly FormatterRule[];
  readonly timeoutMs: number;
  readonly warnings: readonly string[];
}

interface ParsedFormatterLayer {
  readonly rules: ReadonlyMap<string, FormatterRule | null>;
  readonly timeoutMs?: number;
  readonly warnings: readonly string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseStringList(value: unknown): readonly string[] | undefined {
  if (Array.isArray(value) === false || value.every(isNonEmptyString) === false) return undefined;
  return value;
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): readonly string[] {
  return Object.keys(value)
    .filter((field) => allowed.has(field) === false)
    .map((field) => `${path}.${field}: unknown field`);
}

function parseCommand(
  value: unknown,
  path: string,
  warnings: string[],
): FormatterCommand | undefined {
  if (isObject(value) === false) {
    warnings.push(`${path}: expected an object`);
    return undefined;
  }

  const fieldWarnings = unknownFields(
    value,
    new Set(["args", "command", "requireRootMarker", "rootMarkers"]),
    path,
  );
  warnings.push(...fieldWarnings);

  if (isNonEmptyString(value.command) === false) {
    warnings.push(`${path}.command: expected a non-empty string`);
    return undefined;
  }

  const args = parseStringList(value.args);
  if (args === undefined) {
    warnings.push(`${path}.args: expected an array of non-empty strings`);
    return undefined;
  }
  if (args.some((argument) => argument.includes("$FILE")) === false) {
    warnings.push(`${path}.args: one argument must contain $FILE`);
    return undefined;
  }

  const rootMarkers = value.rootMarkers === undefined ? [] : parseStringList(value.rootMarkers);
  if (rootMarkers === undefined) {
    warnings.push(`${path}.rootMarkers: expected an array of non-empty strings`);
    return undefined;
  }
  if (value.requireRootMarker !== undefined && typeof value.requireRootMarker !== "boolean") {
    warnings.push(`${path}.requireRootMarker: expected a boolean`);
    return undefined;
  }

  const requireRootMarker = value.requireRootMarker ?? false;
  if (requireRootMarker && rootMarkers.length === 0) {
    warnings.push(`${path}.rootMarkers: required when requireRootMarker is true`);
    return undefined;
  }
  if (fieldWarnings.length > 0) return undefined;

  return {
    args,
    command: value.command,
    requireRootMarker,
    rootMarkers,
  };
}

function parseRule(
  id: string,
  value: unknown,
  path: string,
  warnings: string[],
): FormatterRule | undefined {
  if (isObject(value) === false) {
    warnings.push(`${path}: expected an object or null`);
    return undefined;
  }

  const fieldWarnings = unknownFields(value, new Set(["commands", "files", "mode"]), path);
  warnings.push(...fieldWarnings);
  if (value.mode !== "first_available" && value.mode !== "pipeline") {
    warnings.push(`${path}.mode: expected first_available or pipeline`);
    return undefined;
  }
  if (isObject(value.files) === false) {
    warnings.push(`${path}.files: expected an object`);
    return undefined;
  }

  const filesWarnings = unknownFields(
    value.files,
    new Set(["extensions", "fileNames"]),
    `${path}.files`,
  );
  warnings.push(...filesWarnings);
  const extensions =
    value.files.extensions === undefined ? [] : parseStringList(value.files.extensions);
  const fileNames =
    value.files.fileNames === undefined ? [] : parseStringList(value.files.fileNames);
  if (extensions === undefined) {
    warnings.push(`${path}.files.extensions: expected an array of non-empty strings`);
    return undefined;
  }
  if (fileNames === undefined) {
    warnings.push(`${path}.files.fileNames: expected an array of non-empty strings`);
    return undefined;
  }
  if (extensions.length === 0 && fileNames.length === 0) {
    warnings.push(`${path}.files: extensions or fileNames is required`);
    return undefined;
  }
  if (Array.isArray(value.commands) === false || value.commands.length === 0) {
    warnings.push(`${path}.commands: expected a non-empty array`);
    return undefined;
  }

  const commands = value.commands.map((command, index) =>
    parseCommand(command, `${path}.commands[${index}]`, warnings),
  );
  if (
    fieldWarnings.length > 0 ||
    filesWarnings.length > 0 ||
    commands.some((command) => command === undefined)
  ) {
    return undefined;
  }

  return {
    commands: commands.filter((command): command is FormatterCommand => command !== undefined),
    extensions,
    fileNames,
    id,
    mode: value.mode,
  };
}

function parseFormatterLayer(document: unknown, scope: "global" | "project"): ParsedFormatterLayer {
  if (document === undefined) return { rules: new Map(), warnings: [] };
  if (isObject(document) === false) {
    return { rules: new Map(), warnings: [`${scope} formatter: expected an object`] };
  }

  const formatter = document;
  const warnings = [
    ...unknownFields(formatter, new Set(["rules", "timeoutMs"]), `${scope} formatter`),
  ];
  let timeoutMs: number | undefined;
  if (formatter.timeoutMs !== undefined) {
    if (
      Number.isSafeInteger(formatter.timeoutMs) &&
      Number(formatter.timeoutMs) > 0 &&
      Number(formatter.timeoutMs) <= MAX_TIMEOUT_MS
    ) {
      timeoutMs = Number(formatter.timeoutMs);
    } else {
      warnings.push(
        `${scope} formatter.timeoutMs: expected an integer between 1 and ${MAX_TIMEOUT_MS}`,
      );
    }
  }

  const rules = new Map<string, FormatterRule | null>();
  if (formatter.rules === undefined) {
    return timeoutMs === undefined ? { rules, warnings } : { rules, timeoutMs, warnings };
  }
  if (isObject(formatter.rules) === false) {
    warnings.push(`${scope} formatter.rules: expected an object`);
    return timeoutMs === undefined ? { rules, warnings } : { rules, timeoutMs, warnings };
  }

  for (const [id, value] of Object.entries(formatter.rules)) {
    const path = `${scope} formatter.rules.${id}`;
    if (id.length === 0) {
      warnings.push(`${scope} formatter.rules: rule ID must not be empty`);
      continue;
    }
    if (value === null) {
      rules.set(id, null);
      continue;
    }
    rules.set(id, parseRule(id, value, path, warnings) ?? null);
  }

  return timeoutMs === undefined ? { rules, warnings } : { rules, timeoutMs, warnings };
}

export function resolveFormatterSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): ResolvedFormatterSettings {
  const globalLayer = parseFormatterLayer(globalSettings, "global");
  const projectLayer = parseFormatterLayer(projectSettings, "project");
  const rules = new Map<string, FormatterRule>();

  for (const [id, rule] of globalLayer.rules) {
    if (rule !== null) rules.set(id, rule);
  }
  for (const [id, rule] of projectLayer.rules) {
    if (rule === null) rules.delete(id);
    else rules.set(id, rule);
  }

  return {
    rules: [...rules.values()],
    timeoutMs: projectLayer.timeoutMs ?? globalLayer.timeoutMs ?? DEFAULT_FORMATTER_TIMEOUT_MS,
    warnings: [...globalLayer.warnings, ...projectLayer.warnings],
  };
}
