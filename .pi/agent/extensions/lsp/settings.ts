export const DEFAULT_LSP_TIMEOUTS = {
  diagnosticsMs: 5_000,
  requestMs: 10_000,
  shutdownMs: 2_000,
  startupMs: 10_000,
} as const;

const MAX_TIMEOUT_MS = 300_000;
const MAX_SHUTDOWN_MS = 10_000;

export interface LspLanguage {
  readonly extensions: readonly string[];
  readonly fileNames: readonly string[];
  readonly languageId: string;
}

export interface LspServerSettings {
  readonly args: readonly string[];
  readonly command: string;
  readonly id: string;
  readonly initializationOptions?: Record<string, unknown>;
  readonly languages: readonly LspLanguage[];
  readonly rootMarkers: readonly string[];
  readonly settings?: Record<string, unknown>;
}

export interface LspTimeouts {
  readonly diagnosticsMs: number;
  readonly requestMs: number;
  readonly shutdownMs: number;
  readonly startupMs: number;
}

export interface ResolvedLspSettings {
  readonly servers: readonly LspServerSettings[];
  readonly timeouts: LspTimeouts;
  readonly warnings: readonly string[];
}

interface ParsedLayer {
  readonly servers: ReadonlyMap<string, LspServerSettings | null>;
  readonly timeouts: Partial<LspTimeouts>;
  readonly warnings: readonly string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value: unknown): readonly string[] | undefined {
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

function parseLanguage(value: unknown, path: string, warnings: string[]): LspLanguage | undefined {
  if (isObject(value) === false) {
    warnings.push(`${path}: expected an object`);
    return undefined;
  }
  const fields = unknownFields(value, new Set(["extensions", "fileNames", "languageId"]), path);
  warnings.push(...fields);
  if (isNonEmptyString(value.languageId) === false) {
    warnings.push(`${path}.languageId: expected a non-empty string`);
    return undefined;
  }
  const extensions = value.extensions === undefined ? [] : stringArray(value.extensions);
  const fileNames = value.fileNames === undefined ? [] : stringArray(value.fileNames);
  if (extensions === undefined) {
    warnings.push(`${path}.extensions: expected an array of non-empty strings`);
    return undefined;
  }
  if (fileNames === undefined) {
    warnings.push(`${path}.fileNames: expected an array of non-empty strings`);
    return undefined;
  }
  if (extensions.length === 0 && fileNames.length === 0) {
    warnings.push(`${path}: extensions or fileNames is required`);
    return undefined;
  }
  if (fields.length > 0) return undefined;
  return { extensions, fileNames, languageId: value.languageId };
}

function parseServer(
  id: string,
  value: unknown,
  path: string,
  warnings: string[],
): LspServerSettings | undefined {
  if (isObject(value) === false) {
    warnings.push(`${path}: expected an object or null`);
    return undefined;
  }
  const fields = unknownFields(
    value,
    new Set(["args", "command", "initializationOptions", "languages", "rootMarkers", "settings"]),
    path,
  );
  warnings.push(...fields);
  if (
    isNonEmptyString(value.command) === false ||
    value.command.includes("/") ||
    value.command.includes("\\")
  ) {
    warnings.push(`${path}.command: expected a bare executable name`);
    return undefined;
  }
  const args = value.args === undefined ? [] : stringArray(value.args);
  if (args === undefined) {
    warnings.push(`${path}.args: expected an array of non-empty strings`);
    return undefined;
  }
  const rootMarkers = stringArray(value.rootMarkers);
  if (rootMarkers === undefined || rootMarkers.length === 0) {
    warnings.push(`${path}.rootMarkers: expected a non-empty string array`);
    return undefined;
  }
  if (Array.isArray(value.languages) === false || value.languages.length === 0) {
    warnings.push(`${path}.languages: expected a non-empty array`);
    return undefined;
  }
  const languages = value.languages.map((language, index) =>
    parseLanguage(language, `${path}.languages[${index}]`, warnings),
  );
  for (const field of ["initializationOptions", "settings"] as const) {
    if (value[field] !== undefined && isObject(value[field]) === false) {
      warnings.push(`${path}.${field}: expected an object`);
      return undefined;
    }
  }
  if (fields.length > 0 || languages.some((language) => language === undefined)) return undefined;
  return {
    args,
    command: value.command,
    id,
    languages: languages.filter((language): language is LspLanguage => language !== undefined),
    rootMarkers,
    ...(value.initializationOptions === undefined
      ? {}
      : { initializationOptions: value.initializationOptions as Record<string, unknown> }),
    ...(value.settings === undefined
      ? {}
      : { settings: value.settings as Record<string, unknown> }),
  };
}

function parseTimeouts(
  value: unknown,
  scope: "global" | "project",
  warnings: string[],
): Partial<LspTimeouts> {
  if (value === undefined) return {};
  if (isObject(value) === false) {
    warnings.push(`${scope} lsp.timeouts: expected an object`);
    return {};
  }
  const keys = ["diagnosticsMs", "requestMs", "shutdownMs", "startupMs"] as const;
  warnings.push(...unknownFields(value, new Set(keys), `${scope} lsp.timeouts`));
  const parsed: Partial<Record<keyof LspTimeouts, number>> = {};
  for (const key of keys) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    const maximum = key === "shutdownMs" ? MAX_SHUTDOWN_MS : MAX_TIMEOUT_MS;
    if (
      Number.isSafeInteger(candidate) === false ||
      Number(candidate) < 100 ||
      Number(candidate) > maximum
    ) {
      warnings.push(`${scope} lsp.timeouts.${key}: expected an integer between 100 and ${maximum}`);
      continue;
    }
    parsed[key] = Number(candidate);
  }
  return parsed;
}

function parseLayer(document: unknown, scope: "global" | "project"): ParsedLayer {
  if (document === undefined) return { servers: new Map(), timeouts: {}, warnings: [] };
  if (isObject(document) === false) {
    return {
      servers: new Map(),
      timeouts: {},
      warnings: [`${scope} lsp: expected an object`],
    };
  }

  const lsp = document;
  const warnings = [...unknownFields(lsp, new Set(["servers", "timeouts"]), `${scope} lsp`)];
  const timeouts = parseTimeouts(lsp.timeouts, scope, warnings);
  const servers = new Map<string, LspServerSettings | null>();
  if (lsp.servers === undefined) return { servers, timeouts, warnings };
  if (isObject(lsp.servers) === false) {
    warnings.push(`${scope} lsp.servers: expected an object`);
    return { servers, timeouts, warnings };
  }
  for (const [id, value] of Object.entries(lsp.servers)) {
    const path = `${scope} lsp.servers.${id}`;
    if (id.length === 0) {
      warnings.push(`${scope} lsp.servers: server ID must not be empty`);
      continue;
    }
    if (value === null) {
      servers.set(id, null);
      continue;
    }
    servers.set(id, parseServer(id, value, path, warnings) ?? null);
  }
  return { servers, timeouts, warnings };
}

export function resolveLspSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): ResolvedLspSettings {
  const globalLayer = parseLayer(globalSettings, "global");
  const projectLayer = parseLayer(projectSettings, "project");
  const warnings = [...globalLayer.warnings, ...projectLayer.warnings];
  if (warnings.length > 0) {
    return { servers: [], timeouts: DEFAULT_LSP_TIMEOUTS, warnings };
  }

  const servers = new Map<string, LspServerSettings>();
  for (const [id, server] of globalLayer.servers) {
    if (server !== null) servers.set(id, server);
  }
  for (const [id, server] of projectLayer.servers) {
    if (server === null) servers.delete(id);
    else servers.set(id, server);
  }
  return {
    servers: [...servers.values()].sort((left, right) => left.id.localeCompare(right.id)),
    timeouts: {
      diagnosticsMs:
        projectLayer.timeouts.diagnosticsMs ??
        globalLayer.timeouts.diagnosticsMs ??
        DEFAULT_LSP_TIMEOUTS.diagnosticsMs,
      requestMs:
        projectLayer.timeouts.requestMs ??
        globalLayer.timeouts.requestMs ??
        DEFAULT_LSP_TIMEOUTS.requestMs,
      shutdownMs:
        projectLayer.timeouts.shutdownMs ??
        globalLayer.timeouts.shutdownMs ??
        DEFAULT_LSP_TIMEOUTS.shutdownMs,
      startupMs:
        projectLayer.timeouts.startupMs ??
        globalLayer.timeouts.startupMs ??
        DEFAULT_LSP_TIMEOUTS.startupMs,
    },
    warnings: [],
  };
}
