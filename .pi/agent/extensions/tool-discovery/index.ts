import {
  defineTool,
  getAgentDir,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_MATCHES = 3;
const MAX_MATCHES = 10;
const MAX_SUMMARY_CHARS = 180;
const MAX_DEFERRED_PREFIXES = 32;
const MAX_DEFERRED_PREFIX_LENGTH = 120;

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

const ACTIVE_AGENT_MARKER = /^<active_agent\s+name=(?:"[^"\r\n]+"|'[^'\r\n]+')[^>]*\/>\s*$/u;

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
}

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

type SettingsRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

  return ctx
    .getSystemPrompt()
    .split("\n")
    .some((line) => ACTIVE_AGENT_MARKER.test(line));
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

function getConfiguredDeferredToolPrefixes(ctx: ExtensionContext): readonly string[] {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });
  return resolveDeferredToolPrefixes(settings.getGlobalSettings(), settings.getProjectSettings());
}
export default function toolDiscoveryExtension(pi: ExtensionAPI): void {
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

      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const matches = searchDeferredTools(
          pi.getAllTools(),
          params.query,
          params.limit ?? DEFAULT_MATCHES,
          getConfiguredDeferredToolPrefixes(ctx),
        );

        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No specialized tools found for: ${params.query}`,
              },
            ],
            details: { matches: [], added: [] },
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
          content: [{ type: "text", text: lines.join("\n") }],
          details: {
            matches: matches.map((tool) => tool.name),
            added,
          },
        };
      },
    }),
  );

  pi.on("resources_discover", (_event, ctx) => {
    if (isSubagentSession(ctx)) return;

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
