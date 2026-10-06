import type { Usage } from "@earendil-works/pi-ai";
import * as PiSDK from "@earendil-works/pi-coding-agent";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { DEFAULT_CLASSIFIER_TIMEOUT_MS } from "../../lib/classifier";
import {
  type DiscoveryRankingOptions,
  type DiscoveryRankingResult,
  MAX_DISCOVERY_CLASSIFIER_CANDIDATES,
  rankDiscovery,
  rankDiscoveryWithClassifier,
} from "../../lib/discovery-ranking";
import { activeAgentName } from "../shared/active-agent";
import { isRecord } from "../shared/is-record";
import {
  createNativeDiscoveryRanker,
  hasNativeToolSearchHooks,
  type NativeToolSearchHooks,
} from "./native-ranking";

const DEFAULT_MATCHES = 3;
const MAX_MATCHES = 10;
const MAX_SUMMARY_CHARS = 180;
const MAX_DEFERRED_PREFIXES = 32;
const MAX_DEFERRED_PREFIX_LENGTH = 120;
const MAX_CLASSIFIER_TIMEOUT_MS = DEFAULT_CLASSIFIER_TIMEOUT_MS;
const DEFAULT_CLASSIFIER_TOOL_DISCOVERY_CONFIG = {
  enabled: true,
  timeoutMs: DEFAULT_CLASSIFIER_TIMEOUT_MS,
} as const;

const DEFAULT_DEFERRED_TOOL_PREFIXES = [] as const;

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
  rankingSource: "classifier" | "lexical";
}

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

export interface ClassifierToolDiscoveryConfig {
  readonly enabled: boolean;
  readonly timeoutMs: number;
}

function readClassifierToolDiscoverySection(
  settings: unknown,
): Record<string, unknown> | null | undefined {
  if (!isRecord(settings) || settings.classifier === undefined) return undefined;
  if (!isRecord(settings.classifier)) return null;
  const section = settings.classifier.toolDiscovery;
  return section === undefined || isRecord(section) ? section : null;
}

function readClassifierToolDiscoveryConfig(
  section: Record<string, unknown> | null | undefined,
  current: ClassifierToolDiscoveryConfig,
): ClassifierToolDiscoveryConfig {
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
    timeoutMs > MAX_CLASSIFIER_TIMEOUT_MS
  ) {
    return { enabled: false, timeoutMs: current.timeoutMs };
  }
  return { enabled, timeoutMs };
}

export function resolveClassifierToolDiscoveryConfig(
  globalSettings: unknown,
  projectSettings?: unknown,
): ClassifierToolDiscoveryConfig {
  const global = readClassifierToolDiscoveryConfig(
    readClassifierToolDiscoverySection(globalSettings),
    DEFAULT_CLASSIFIER_TOOL_DISCOVERY_CONFIG,
  );
  return readClassifierToolDiscoveryConfig(
    readClassifierToolDiscoverySection(projectSettings),
    global,
  );
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
  if (name === "tool_load") return false;
  return prefixes.some((prefix) => name.startsWith(prefix));
}

function isDiscoverableTool(
  tool: ToolInfo,
  prefixes: readonly string[] = DEFAULT_DEFERRED_TOOL_PREFIXES,
): boolean {
  return (
    tool.exposure === "deferred" ||
    tool.exposure === "codemode" ||
    isDeferredToolName(tool.name, prefixes)
  );
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
    .filter((tool) => isDiscoverableTool(tool, prefixes))
    .map((tool) => ({ tool, score: scoreTool(tool, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, limit)
    .map(({ tool }) => tool);
}

export type ClassifierRankingOptions = Omit<DiscoveryRankingOptions, "enabled">;

export interface RankedToolResult {
  matches: ToolInfo[];
  rankingSource: "classifier" | "lexical";
  usage?: Usage;
}

function lexicalDiscoveryMatches(
  tools: readonly ToolInfo[],
  query: string,
  prefixes: readonly string[],
) {
  const terms = queryTerms(query);
  return searchDeferredTools(tools, query, MAX_DISCOVERY_CLASSIFIER_CANDIDATES, prefixes).map(
    (tool) => ({ name: tool.name, score: scoreTool(tool, terms) }),
  );
}

function asToolRanking(
  ranking: DiscoveryRankingResult,
  tools: readonly ToolInfo[],
): RankedToolResult {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    matches: ranking.matches.map((item) => {
      const tool = byName.get(item.name);
      if (tool === undefined) throw new Error("Ranking selected an unknown discovery tool");
      return tool;
    }),
    rankingSource: ranking.rankingSource,
    ...(ranking.usage === undefined ? {} : { usage: ranking.usage }),
  };
}

export async function rankDeferredToolsWithClassifier(
  tools: readonly ToolInfo[],
  query: string,
  limit: number,
  prefixes: readonly string[],
  options: ClassifierRankingOptions,
  signal?: AbortSignal,
): Promise<RankedToolResult | undefined> {
  const candidates = tools.filter((tool) => isDiscoverableTool(tool, prefixes));
  const attempt = await rankDiscoveryWithClassifier(
    candidates,
    lexicalDiscoveryMatches(candidates, query, prefixes),
    query,
    limit,
    { ...options, ...(signal === undefined ? {} : { signal }) },
  );
  return attempt.ok ? asToolRanking(attempt.result, candidates) : undefined;
}

export async function searchDeferredToolsWithClassifierFallback(
  tools: readonly ToolInfo[],
  query: string,
  limit: number,
  prefixes: readonly string[],
  options: ClassifierRankingOptions,
  signal?: AbortSignal,
): Promise<RankedToolResult> {
  const candidates = tools.filter((tool) => isDiscoverableTool(tool, prefixes));
  const ranking = await rankDiscovery(
    candidates,
    lexicalDiscoveryMatches(candidates, query, prefixes),
    query,
    limit,
    { ...options, ...(signal === undefined ? {} : { signal }) },
  );
  return asToolRanking(ranking, candidates);
}

function getConfiguredSettings(ctx: ExtensionContext) {
  return SettingsManager.create(ctx.cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
}

function getConfiguredDeferredToolPrefixes(ctx: ExtensionContext): readonly string[] {
  const settings = getConfiguredSettings(ctx);
  return resolveDeferredToolPrefixes(settings.getGlobalSettings(), settings.getProjectSettings());
}

function getConfiguredClassifierToolDiscovery(
  ctx: ExtensionContext,
): ClassifierToolDiscoveryConfig {
  const settings = getConfiguredSettings(ctx);
  return resolveClassifierToolDiscoveryConfig(
    settings.getGlobalSettings(),
    settings.getProjectSettings(),
  );
}
export default function toolDiscoveryExtension(
  pi: ExtensionAPI,
  nativeHooks: NativeToolSearchHooks | undefined = hasNativeToolSearchHooks(PiSDK)
    ? PiSDK
    : undefined,
): void {
  let subagentAdmittedTools: ReadonlySet<string> | undefined;

  const searchableTools = (ctx: ExtensionContext): readonly ToolInfo[] => {
    const tools = pi.getAllTools().filter((tool) => tool.exposure !== "hidden");
    if (!isSubagentSession(ctx)) return tools;

    const admitted = subagentAdmittedTools ?? new Set(pi.getActiveTools());
    return tools.filter((tool) => admitted.has(tool.name));
  };

  let disposeNativeRanking: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    disposeNativeRanking?.();
    disposeNativeRanking = undefined;
    // Migration bridge: unpatched 0.99.1 keeps tool_load until the new binary is activated.
    if (nativeHooks === undefined) return;
    disposeNativeRanking = nativeHooks.installToolSearchRanker(
      ctx.modelRegistry,
      createNativeDiscoveryRanker(searchableTools, (context) => {
        const config = getConfiguredClassifierToolDiscovery(context);
        return {
          modelRegistry: context.modelRegistry,
          enabled: config.enabled,
          timeoutMs: config.timeoutMs,
          settingsContext: context,
        };
      }),
    );
  });
  pi.on("session_shutdown", () => {
    disposeNativeRanking?.();
    disposeNativeRanking = undefined;
  });

  pi.registerTool(
    defineTool<typeof ToolSearchParameters, ToolSearchDetails>({
      name: "tool_load",
      label: "Load tools",
      description: "Find and enable inactive specialized tools.",
      promptSnippet: "Find and activate specialized tools",
      promptGuidelines: [
        "Use tool_load when the current tools cannot perform the task or a needed tool is not active.",
      ],
      parameters: ToolSearchParameters,
      executionMode: "sequential",

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        let inferenceUsage: Usage | undefined;
        try {
          const tools = searchableTools(ctx);
          const prefixes = getConfiguredDeferredToolPrefixes(ctx);
          const classifierConfig = getConfiguredClassifierToolDiscovery(ctx);
          const ranked: RankedToolResult = classifierConfig.enabled
            ? await searchDeferredToolsWithClassifierFallback(
                tools,
                params.query,
                params.limit ?? DEFAULT_MATCHES,
                prefixes,
                {
                  modelRegistry: ctx.modelRegistry,
                  onUsage: (usage) => {
                    inferenceUsage = usage;
                  },
                  timeoutMs: classifierConfig.timeoutMs,
                  settingsContext: ctx,
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
          const { matches: rankedMatches, rankingSource } = ranked;
          const usage = ranked.usage === undefined ? {} : { usage: ranked.usage };
          const currentTools = searchableTools(ctx);
          const byName = new Map(currentTools.map((tool) => [tool.name, tool]));
          const currentMatches = rankedMatches.flatMap((tool) => {
            const current = byName.get(tool.name);
            return current === undefined ? [] : [current];
          });
          const matches = currentMatches;
          if (matches.length === 0) {
            return {
              ...usage,
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
            ...usage,
            content: [
              { type: "text", text: `${lines.join("\n")}\nRanking source: ${rankingSource}` },
            ],
            details: {
              matches: matches.map((tool) => tool.name),
              added,
              rankingSource,
            },
          };
        } catch (error) {
          if (inferenceUsage === undefined) throw error;
          // Agent-core discards usage on thrown failures; return an error result without accepting matches.
          return {
            isError: true,
            usage: inferenceUsage,
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            details: { matches: [], added: [], rankingSource: "classifier" },
          };
        }
      },
    }),
  );

  pi.on("resources_discover", (_event, ctx) => {
    if (isSubagentSession(ctx)) {
      // The subagent package has already reduced this set from its `tools:` frontmatter.
      // Preserve that admission boundary when tool_load inspects the global registry.
      subagentAdmittedTools = new Set(pi.getActiveTools());
      return;
    }

    const deferredPrefixes = getConfiguredDeferredToolPrefixes(ctx);
    const deferredNames = new Set(
      pi
        .getAllTools()
        .filter(
          (tool) =>
            (tool.exposure === "direct" || tool.exposure === "model-only") &&
            isDeferredToolName(tool.name, deferredPrefixes),
        )
        .map((tool) => tool.name),
    );
    const active = pi.getActiveTools();
    const initial = active.filter((name) => !deferredNames.has(name));

    if (initial.length !== active.length) {
      pi.setActiveTools(initial);
    }
  });
}
