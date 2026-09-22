import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const CATALOG_KIND = "discovered-definitions" as const;
export const MAX_AGENT_ID_LENGTH = 96;
export const MAX_DESCRIPTION_LENGTH = 360;

export type AgentDefinitionSource = "builtin" | "global" | "project";

export interface AgentDefinition {
  readonly id: string;
  readonly description: string;
  readonly source: AgentDefinitionSource;
}

export interface AgentCatalog {
  readonly kind: typeof CATALOG_KIND;
  readonly definitions: readonly AgentDefinition[];
  readonly revision: string;
}

export type AgentDiscoveryFailure =
  | "global-directory-unavailable"
  | "project-directory-unavailable"
  | "reserved-agent-id"
  | "catalog-too-large";

export interface AgentDiscoveryResult {
  readonly catalog?: AgentCatalog;
  readonly failure?: AgentDiscoveryFailure;
}

export interface AgentDiscoveryOptions {
  readonly cwd: string;
  readonly projectTrusted: boolean;
  readonly agentDir?: string;
  readonly maxCandidates?: number;
}

/**
 * These are the documented built-in roles. Custom definitions are loaded over
 * them in the same defaults -> global -> trusted project order as the loader.
 */
const BUILTIN_DEFINITIONS: readonly AgentDefinition[] = [
  {
    id: "general-purpose",
    description: "A broadly capable agent for tasks without a narrower specialist.",
    source: "builtin",
  },
  {
    id: "Explore",
    description: "Fast codebase exploration agent (read-only).",
    source: "builtin",
  },
  {
    id: "Plan",
    description: "Software architect for implementation planning (read-only).",
    source: "builtin",
  },
];

const RESERVED_IDS = new Set(["stay", "abstain"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeMetadata(value: string, maxLength: number): string {
  const withoutControls = [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  return withoutControls
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu, "[redacted-credential]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/(?:^|\s)(?:~|\/Users\/|\/home\/|\/private\/|[A-Za-z]:\\)[^\s]*/gu, " [redacted-path]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function definitionFromFile(
  fileName: string,
  source: AgentDefinitionSource,
  agentDir: string,
): AgentDefinition | null {
  const id = basename(fileName, ".md").trim();
  if (id.length === 0 || id.length > MAX_AGENT_ID_LENGTH || RESERVED_IDS.has(id)) return null;

  try {
    const content = readFileSync(join(agentDir, fileName), "utf8");
    const parsed = parseFrontmatter(content);
    const frontmatter = isRecord(parsed.frontmatter) ? parsed.frontmatter : {};
    if (frontmatter.enabled === false) return { id, description: "", source };
    const rawDescription =
      typeof frontmatter.description === "string" ? frontmatter.description : id;
    const description = sanitizeMetadata(rawDescription, MAX_DESCRIPTION_LENGTH) || id;
    return { id, description, source };
  } catch {
    // The installed loader skips an unreadable or malformed definition; do the
    // same rather than exposing partial file contents or an exception string.
    return null;
  }
}

function loadDirectory(
  directory: string,
  source: AgentDefinitionSource,
): { definitions: AgentDefinition[]; unavailable: boolean } {
  if (!existsSync(directory)) return { definitions: [], unavailable: false };

  let entries: string[];
  try {
    entries = readdirSync(directory, { encoding: "utf8" })
      .filter((entry) => entry.endsWith(".md"))
      .sort();
  } catch {
    return { definitions: [], unavailable: true };
  }

  return {
    definitions: entries
      .map((entry) => definitionFromFile(entry, source, directory))
      .filter((definition): definition is AgentDefinition => definition !== null),
    unavailable: false,
  };
}

function revisionFor(definitions: readonly AgentDefinition[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        definitions.map(({ id, description, source }) => ({ id, description, source })),
      ),
    )
    .digest("hex");
}

export function discoverAgentDefinitions(options: AgentDiscoveryOptions): AgentDiscoveryResult {
  const maxCandidates = options.maxCandidates ?? 32;
  const merged = new Map<string, AgentDefinition | null>();
  for (const definition of BUILTIN_DEFINITIONS) merged.set(definition.id, definition);

  const globalDirectory = options.agentDir ?? getAgentDir();
  const global = loadDirectory(join(globalDirectory, "agents"), "global");
  if (global.unavailable) return { failure: "global-directory-unavailable" };
  for (const definition of global.definitions)
    merged.set(definition.id, definition.description === "" ? null : definition);

  if (options.projectTrusted) {
    const project = loadDirectory(join(options.cwd, CONFIG_DIR_NAME, "agents"), "project");
    if (project.unavailable) return { failure: "project-directory-unavailable" };
    for (const definition of project.definitions)
      merged.set(definition.id, definition.description === "" ? null : definition);
  }

  const definitions = [...merged.values()]
    .filter((definition): definition is AgentDefinition => definition !== null)
    .sort((left, right) => left.id.localeCompare(right.id));

  if (definitions.some(({ id }) => RESERVED_IDS.has(id))) return { failure: "reserved-agent-id" };
  if (definitions.length > maxCandidates) return { failure: "catalog-too-large" };

  return {
    catalog: {
      kind: CATALOG_KIND,
      definitions,
      revision: revisionFor(definitions),
    },
  };
}
