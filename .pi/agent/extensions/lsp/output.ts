import { readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type {
  Diagnostic,
  Hover,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent,
  Range,
} from "vscode-languageserver-protocol/node";
import { isInsideProject, MAX_DOCUMENT_BYTES, projectRelativePath } from "./paths";
import { fromProtocolPosition } from "./positions";

const MAX_RESULTS = 100;
const MAX_LOCATION_CANDIDATES = 200;

export interface ServerDiagnostic {
  readonly diagnostic: Diagnostic;
  readonly path: string;
  readonly serverId: string;
  readonly text: string;
}

export interface ServerHover {
  readonly hover: Hover | null;
  readonly serverId: string;
}

export interface ServerLocations {
  readonly locations: readonly (Location | LocationLink)[];
  readonly serverId: string;
}

const severityNames = ["unspecified", "error", "warning", "information", "hint"] as const;

function sanitized(text: string): string {
  return text.replaceAll(/[^\P{C}\n\t]/gu, "").trim();
}

function rangeText(text: string, range: Range): string {
  const start = fromProtocolPosition(text, range.start);
  const end = fromProtocolPosition(text, range.end);
  return `${start.line}:${start.column}-${end.line}:${end.column}`;
}

export function renderDiagnostics(
  projectRoot: string,
  diagnostics: readonly ServerDiagnostic[],
): string {
  if (diagnostics.length === 0) return "LSP diagnostics: none";
  const rows = diagnostics
    .flatMap(({ diagnostic, path, serverId, text }) => {
      try {
        const severity = severityNames[diagnostic.severity ?? 0] ?? "unspecified";
        const message =
          typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
        return [
          `${projectRelativePath(projectRoot, path)}:${rangeText(text, diagnostic.range)} [${severity}] ${sanitized(message)} (${serverId})`,
        ];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.localeCompare(right));
  if (rows.length === 0) return "LSP diagnostics: none";
  const shown = rows.slice(0, MAX_RESULTS);
  if (shown.length < rows.length) shown.push(`[truncated: ${rows.length - shown.length} omitted]`);
  return shown.join("\n");
}

function markedStringText(content: MarkedString): string {
  return typeof content === "string"
    ? content
    : `\`\`\`${content.language}\n${content.value}\n\`\`\``;
}

function hoverText(hover: Hover | null): string {
  if (hover === null) return "";
  const contents = hover.contents;
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((content) =>
        typeof content === "string" || "language" in content
          ? markedStringText(content as MarkedString)
          : (content as MarkupContent).value,
      )
      .join("\n\n");
  }
  if ("kind" in contents) return contents.value;
  return markedStringText(contents);
}

export function renderHovers(hovers: readonly ServerHover[]): string {
  const rows = hovers
    .map(({ hover, serverId }) => ({ serverId, text: sanitized(hoverText(hover)) }))
    .filter(({ text }) => text !== "")
    .sort((left, right) => left.serverId.localeCompare(right.serverId));
  if (rows.length === 0) return "LSP hover: none";
  return rows.map(({ serverId, text }) => `[${serverId}]\n${text}`).join("\n\n");
}

function locationParts(location: Location | LocationLink): {
  readonly range: Range;
  readonly uri: string;
} {
  return "uri" in location
    ? { range: location.range, uri: location.uri }
    : { range: location.targetSelectionRange, uri: location.targetUri };
}

export async function renderLocations(
  projectRoot: string,
  groups: readonly ServerLocations[],
  signal?: AbortSignal,
): Promise<string> {
  const rows: string[] = [];
  const paths = new Map<string, string>();
  const texts = new Map<string, string>();
  const candidateCount = groups.reduce((total, group) => total + group.locations.length, 0);
  let inspected = 0;
  locations: for (const { locations, serverId } of groups) {
    for (const location of locations) {
      if (inspected >= MAX_LOCATION_CANDIDATES) break locations;
      if (signal?.aborted) throw new Error("LSP location rendering cancelled");
      inspected += 1;
      try {
        const { range, uri } = locationParts(location);
        if (uri.startsWith("file:") === false) continue;
        let path = paths.get(uri);
        if (path === undefined) {
          path = await realpath(fileURLToPath(uri));
          paths.set(uri, path);
        }
        if (isInsideProject(projectRoot, path) === false) continue;
        let text = texts.get(path);
        if (text === undefined) {
          if ((await stat(path)).size > MAX_DOCUMENT_BYTES) continue;
          text = await readFile(path, { encoding: "utf8", signal });
          texts.set(path, text);
        }
        rows.push(
          `${projectRelativePath(projectRoot, path)}:${rangeText(text, range)} (${serverId})`,
        );
      } catch {
        if (signal?.aborted) throw new Error("LSP location rendering cancelled");
        // Ignore malformed or external server locations.
      }
    }
  }
  const unique = [...new Set(rows)].sort((left, right) => left.localeCompare(right));
  if (unique.length === 0) return "LSP locations: none";
  const shown = unique.slice(0, MAX_RESULTS);
  if (shown.length < unique.length) {
    shown.push(`[truncated: ${unique.length - shown.length} omitted]`);
  } else if (inspected < candidateCount) {
    shown.push(`[truncated: ${candidateCount - inspected} location candidates omitted]`);
  }
  return shown.join("\n");
}
