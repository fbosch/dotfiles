import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { requestVercelGateway, type VercelGatewayFetch } from "../../lib/vercel-gateway";
import { activeAgentName } from "../shared/active-agent";
import { isRecord } from "../shared/is-record";

const DEFAULT_MATCHES = 3;
const MAX_MATCHES = 10;
const MAX_SUMMARY_CHARS = 180;
const MAX_DEFERRED_PREFIXES = 32;
const MAX_DEFERRED_PREFIX_LENGTH = 120;
const MAX_JEV_CANDIDATES = 24;
const MAX_JEV_TIMEOUT_MS = 2_000;
const DEFAULT_JEV_TOOL_DISCOVERY_CONFIG = { enabled: true, timeoutMs: 2_000 } as const;
const JEV_NO_MATCH = "no_match";

const DEFERRED_TOOL_NAMES = new Set([
  "exec",
  "find_definition",
  "find_callers",
  "find_callees",
  "get_symbol_body",
  "list_symbols",
  "lsp",
  "git_diff",
  "websearch",
  "webfetch",
  "read_session",
  "hypr_window_screenshot",
  "hypr_desktop_diagnose",
  "hypr_layer_inspect",
  "worktrunk",
]);

const DEFAULT_DEFERRED_TOOL_PREFIXES = [
  "chart_",
  "figma_",
  "serena_",
  "context7_",
  "ast-grep_",
  "mcp__",
] as const;

const ToolSearchParameters = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 500,
      description: "Capability, task, or tool name to search for.",
    }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_MATCHES })),
  },
  { additionalProperties: false },
);

interface ToolSearchDetails {
  matches: string[];
  added: string[];
  rankingSource: "jev" | "lexical";
}

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

export interface JevToolDiscoveryConfig {
  readonly enabled: boolean;
  readonly timeoutMs: number;
}

function readJevToolDiscoverySection(
  settings: unknown,
): Record<string, unknown> | null | undefined {
  if (!isRecord(settings) || settings.jev === undefined) return undefined;
  if (!isRecord(settings.jev)) return null;
  const section = settings.jev.toolDiscovery;
  return section === undefined || isRecord(section) ? section : null;
}

function readJevToolDiscoveryConfig(
  section: Record<string, unknown> | null | undefined,
  current: JevToolDiscoveryConfig,
): JevToolDiscoveryConfig {
  if (section === undefined) return current;
  if (
    section === null ||
    Object.keys(section).some((key) => !["enabled", "timeoutMs"].includes(key))
  ) {
    return { enabled: false, timeoutMs: current.timeoutMs };
  }
  const enabled = Object.hasOwn(section, "enabled") ? section.enabled : current.enabled;
  const timeoutMs = Object.hasOwn(section, "timeoutMs") ? section.timeoutMs : current.timeoutMs;
  if (
    typeof enabled !== "boolean" ||
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_JEV_TIMEOUT_MS
  ) {
    return { enabled: false, timeoutMs: current.timeoutMs };
  }
  return { enabled, timeoutMs };
}

export function resolveJevToolDiscoveryConfig(
  globalSettings: unknown,
  projectSettings?: unknown,
): JevToolDiscoveryConfig {
  const global = readJevToolDiscoveryConfig(
    readJevToolDiscoverySection(globalSettings),
    DEFAULT_JEV_TOOL_DISCOVERY_CONFIG,
  );
  return readJevToolDiscoveryConfig(readJevToolDiscoverySection(projectSettings), global);
}

function getConfiguredPrefixes(settings: unknown): string[] | undefined {
  if (!isRecord(settings) || !isRecord(settings.toolDiscovery)) return undefined;
  const value = settings.toolDiscovery.deferredToolPrefixes;
  if (!Array.isArray(value) || value.length > MAX_DEFERRED_PREFIXES) return undefined;
  if (
    value.some(
      (prefix) =>
        typeof prefix !== "string" ||
        prefix.trim().length === 0 ||
        prefix.trim().length > MAX_DEFERRED_PREFIX_LENGTH,
    )
  )
    return undefined;
  const prefixes = value.map((prefix) => prefix.trim());
  return new Set(prefixes).size === prefixes.length ? prefixes : undefined;
}

export function resolveDeferredToolPrefixes(
  globalSettings: unknown,
  projectSettings?: unknown,
): readonly string[] {
  return (
    getConfiguredPrefixes(projectSettings) ??
    getConfiguredPrefixes(globalSettings) ??
    DEFAULT_DEFERRED_TOOL_PREFIXES
  );
}

export function isDeferredToolName(
  name: string,
  prefixes: readonly string[] = DEFAULT_DEFERRED_TOOL_PREFIXES,
): boolean {
  if (name === "search_tools") return false;
  return DEFERRED_TOOL_NAMES.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

function isSubagentSession(ctx: ExtensionContext): boolean {
  // pi-subagents supplies both signals; requiring both avoids matching normal forks
  // or user content that happens to quote the marker.
  const parentSession = ctx.sessionManager.getHeader()?.parentSession;
  if (typeof parentSession !== "string" || parentSession.length === 0) return false;

  return activeAgentName(ctx.getSystemPrompt()) !== undefined;
}

function compactDescription(description: string, maxChars = MAX_SUMMARY_CHARS): string {
  const summary = description.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";

  if (summary.length <= maxChars) return summary;
  return `${summary.slice(0, maxChars - 1).trimEnd()}…`;
}

function queryTerms(query: string): string[] {
  return query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function scoreTool(tool: ToolInfo, terms: readonly string[]): number {
  const name = tool.name.toLowerCase();
  const nameTokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  const description = tool.description.toLowerCase();

  return terms.reduce((score, term) => {
    if (name === term) return score + 16;

    const nameScore = nameTokens.includes(term) ? 8 : name.includes(term) ? 4 : 0;
    const descriptionScore = description.includes(term) ? 1 : 0;

    return score + nameScore + descriptionScore;
  }, 0);
}

export function searchDeferredTools(
  tools: readonly ToolInfo[],
  query: string,
  limit = DEFAULT_MATCHES,
  prefixes: readonly string[] = DEFAULT_DEFERRED_TOOL_PREFIXES,
): ToolInfo[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return tools
    .filter((tool) => isDeferredToolName(tool.name, prefixes))
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, limit)
    .map(({ tool }) => tool);
}

interface JevCandidate {
  id: string;
  tool: ToolInfo;
}

export interface JevRankingOptions {
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "getProviderAuth">;
  fetch?: VercelGatewayFetch;
  timeoutMs?: number;
}

function buildJevCandidatePool(
  tools: readonly ToolInfo[],
  query: string,
  prefixes: readonly string[],
): JevCandidate[] {
  const lexicalMatches = searchDeferredTools(tools, query, MAX_JEV_CANDIDATES, prefixes);
  const selectedNames = new Set(lexicalMatches.map((tool) => tool.name));
  const candidates = [...lexicalMatches];

  // Keep the semantic pass bounded while adding deterministic non-lexical candidates.
  for (const tool of tools
    .filter((candidate) => isDeferredToolName(candidate.name, prefixes))
    .filter((candidate) => !selectedNames.has(candidate.name))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (candidates.length >= MAX_JEV_CANDIDATES) break;
    selectedNames.add(tool.name);
    candidates.push(tool);
  }

  return candidates.map((tool, index) => ({ id: `candidate_${index}`, tool }));
}

function createJevRequest(
  candidates: readonly JevCandidate[],
  query: string,
): Record<string, unknown> {
  const criteria = Object.fromEntries(
    candidates.map(({ id, tool }) => [id, `${tool.name}: ${compactDescription(tool.description)}`]),
  );
  criteria[JEV_NO_MATCH] = "No candidate provides the capability requested by the query.";

  return {
    state: {
      query,
      candidates: candidates.map(({ id, tool }) => ({
        id,
        name: tool.name,
        description: compactDescription(tool.description),
      })),
    },
    questions: {
      best_tool: {
        type: "choice",
        instructions:
          "Which candidate tool best matches the requested capability? Choose no_match when none is a useful match.",
        criteria,
      },
    },
  };
}

function parseJevRanking(
  value: unknown,
  candidates: readonly JevCandidate[],
  limit: number,
): ToolInfo[] | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;
  const answer = value.answers.best_tool;
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string")
    return undefined;
  if (!isRecord(answer.probabilities)) return undefined;

  const expectedIds = [...candidates.map(({ id }) => id), JEV_NO_MATCH];
  if (!expectedIds.includes(answer.choice)) return undefined;
  const expectedIdSet = new Set(expectedIds);
  const probabilityKeys = Object.keys(answer.probabilities);
  if (
    probabilityKeys.length !== expectedIds.length ||
    probabilityKeys.some((id) => !expectedIdSet.has(id))
  ) {
    return undefined;
  }

  const probabilities = new Map<string, number>();
  let probabilityTotal = 0;
  for (const id of expectedIds) {
    const probability = answer.probabilities[id];
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      return undefined;
    }
    probabilityTotal += probability;
    probabilities.set(id, probability);
  }
  if (Math.abs(probabilityTotal - 1) > 0.02) return undefined;

  const selectedProbability = probabilities.get(answer.choice);
  if (selectedProbability === undefined) return undefined;
  const highestProbability = Math.max(...probabilities.values());
  if (selectedProbability < highestProbability) return undefined;
  if (answer.choice === JEV_NO_MATCH) return [];

  const selectedCandidate = candidates.find(({ id }) => id === answer.choice);
  return selectedCandidate === undefined || limit < 1 ? [] : [selectedCandidate.tool];
}

export interface RankedToolResult {
  matches: ToolInfo[];
  rankingSource: "jev" | "lexical";
}

export async function rankDeferredToolsWithJev(
  tools: readonly ToolInfo[],
  query: string,
  limit: number,
  prefixes: readonly string[],
  options: JevRankingOptions,
  signal?: AbortSignal,
): Promise<RankedToolResult | undefined> {
  const candidates = buildJevCandidatePool(tools, query, prefixes);
  if (candidates.length === 0) return { matches: [], rankingSource: "lexical" };

  const gateway = await requestVercelGateway(
    options.modelRegistry,
    createJevRequest(candidates, query),
    {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(signal === undefined ? {} : { signal }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
  );
  if (!gateway.ok) return undefined;

  const matches = parseJevRanking(gateway.value, candidates, limit);
  return matches === undefined ? undefined : { matches, rankingSource: "jev" };
}

export async function searchDeferredToolsWithJevFallback(
  tools: readonly ToolInfo[],
  query: string,
  limit: number,
  prefixes: readonly string[],
  options: JevRankingOptions,
  signal?: AbortSignal,
): Promise<RankedToolResult> {
  const lexicalMatches = searchDeferredTools(tools, query, limit, prefixes);
  return (
    (await rankDeferredToolsWithJev(tools, query, limit, prefixes, options, signal)) ?? {
      matches: lexicalMatches,
      rankingSource: "lexical",
    }
  );
}

function getConfiguredSettings(ctx: ExtensionContext) {
  return SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
}

function getConfiguredDeferredToolPrefixes(ctx: ExtensionContext): readonly string[] {
  const settings = getConfiguredSettings(ctx);
  return resolveDeferredToolPrefixes(settings.getGlobalSettings(), settings.getProjectSettings());
}

function getConfiguredJevToolDiscovery(ctx: ExtensionContext): JevToolDiscoveryConfig {
  const settings = getConfiguredSettings(ctx);
  return resolveJevToolDiscoveryConfig(settings.getGlobalSettings(), settings.getProjectSettings());
}
export default function toolDiscoveryExtension(pi: ExtensionAPI): void {
  let subagentAdmittedTools: ReadonlySet<string> | undefined;

  const searchableTools = (ctx: ExtensionContext): readonly ToolInfo[] => {
    const tools = pi.getAllTools();
    if (!isSubagentSession(ctx)) return tools;

    const admitted = subagentAdmittedTools ?? new Set(pi.getActiveTools());
    return tools.filter((tool) => admitted.has(tool.name));
  };

  pi.registerTool(
    defineTool<typeof ToolSearchParameters, ToolSearchDetails>({
      name: "search_tools",
      label: "Search tools",
      description: "Find and enable inactive specialized tools.",
      promptSnippet: "Find inactive specialized tools",
      promptGuidelines: [
        "Use search_tools when the current tools cannot perform the task or a needed tool is not active.",
      ],
      parameters: ToolSearchParameters,
      executionMode: "sequential",

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const tools = searchableTools(ctx);
        const prefixes = getConfiguredDeferredToolPrefixes(ctx);
        const jevConfig = getConfiguredJevToolDiscovery(ctx);
        const ranked = jevConfig.enabled
          ? await searchDeferredToolsWithJevFallback(
              tools,
              params.query,
              params.limit ?? DEFAULT_MATCHES,
              prefixes,
              {
                modelRegistry: ctx.modelRegistry,
                timeoutMs: jevConfig.timeoutMs,
              },
              signal,
            )
          : {
              matches: searchDeferredTools(
                tools,
                params.query,
                params.limit ?? DEFAULT_MATCHES,
                prefixes,
              ),
              rankingSource: "lexical" as const,
            };
        signal?.throwIfAborted();
        const { matches, rankingSource } = ranked;

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No specialized tools found for: ${params.query} (ranking: ${rankingSource})`,
              },
            ],
            details: { matches: [], added: [], rankingSource },
          };
        }

        const active = pi.getActiveTools();
        const activeNames = new Set(active);
        const added = matches.map((tool) => tool.name).filter((name) => !activeNames.has(name));

        // Pi recognizes this purely additive update as a deferred-tool load point.
        if (added.length > 0) {
          pi.setActiveTools([...active, ...added]);
        }

        const addedNames = new Set(added);
        const lines = matches.map((tool) => {
          const status = addedNames.has(tool.name) ? "loaded" : "active";
          return `- ${tool.name} (${status}): ${compactDescription(tool.description)}`;
        });

        return {
          content: [
            { type: "text", text: `${lines.join("\n")}\nRanking source: ${rankingSource}` },
          ],
          details: {
            matches: matches.map((tool) => tool.name),
            added,
            rankingSource,
          },
        };
      },
    }),
  );

  pi.on("resources_discover", (_event, ctx) => {
    if (isSubagentSession(ctx)) {
      // The subagent package has already reduced this set from its `tools:` frontmatter.
      // Preserve that admission boundary when search_tools inspects the global registry.
      subagentAdmittedTools = new Set(pi.getActiveTools());
      return;
    }

    const deferredPrefixes = getConfiguredDeferredToolPrefixes(ctx);
    const deferredNames = new Set(
      pi
        .getAllTools()
        .filter((tool) => isDeferredToolName(tool.name, deferredPrefixes))
        .map((tool) => tool.name),
    );
    const active = pi.getActiveTools();
    const initial = active.filter((name) => !deferredNames.has(name));

    if (initial.length !== active.length) {
      pi.setActiveTools(initial);
    }
  });
}
