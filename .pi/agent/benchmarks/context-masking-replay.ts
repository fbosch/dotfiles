import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Replays observation masking at each recorded compaction: rebuilds the context Pi held
// just before compacting, masks old tool results, and estimates what that would have freed.
// Output contains only counts, ratios, and tool names, never conversation text.

export interface MaskingPolicy {
  name: string;
  /** Tool results from the latest N assistant turns stay verbatim. */
  protectRecentTurns: number;
  /** Results shorter than this stay verbatim; masking them saves little. */
  minResultChars: number;
  /** Size of the placeholder that replaces a masked result. */
  placeholderChars: number;
}

const BASE = { minResultChars: 800, placeholderChars: 160 };
export const DEFAULT_POLICIES: readonly MaskingPolicy[] = [
  { name: "tail-5", protectRecentTurns: 5, ...BASE },
  { name: "tail-10", protectRecentTurns: 10, ...BASE },
  { name: "tail-20", protectRecentTurns: 20, ...BASE },
];
export const GROWTH_WINDOW_TURNS = 20;
export const REFETCH_WINDOW_TURNS = 10;

type JsonObject = Record<string, unknown>;
type Kind =
  | "system"
  | "user"
  | "assistant"
  | "toolResult"
  | "custom"
  | "compaction"
  | "edit"
  | "other";

interface Node {
  id: string;
  parentId: string | null;
  kind: Kind;
  chars: number;
  toolName?: string;
  toolCallId?: string;
  /** Assistant tool calls by call ID, keyed for `read`/`bash` re-fetch detection. */
  callKeys?: Map<string, string>;
  promptTokens?: number;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  targetId?: string;
  replacementChars?: number;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === "text") chars += str(block.text)?.length ?? 0;
    else if (block.type === "thinking") chars += str(block.thinking)?.length ?? 0;
    else if (block.type === "toolCall") chars += JSON.stringify(block.arguments ?? {}).length;
  }
  return chars;
}

function systemChars(message: JsonObject): number {
  let chars = str(message.content)?.length ?? 0;
  if (isObject(message.sections)) {
    for (const section of Object.values(message.sections)) chars += str(section)?.length ?? 0;
  }
  if (Array.isArray(message.toolsAdded)) chars += JSON.stringify(message.toolsAdded).length;
  return chars;
}

// shortcut: same keying as context-baseline; codemode-internal calls are invisible.
function callKey(name: string, args: unknown): string | undefined {
  if (!isObject(args)) return undefined;
  if (name === "read") return str(args.path) === undefined ? undefined : `read:${str(args.path)}`;
  const command = name === "bash" ? str(args.command)?.trim() : undefined;
  return command ? `bash:${command}` : undefined;
}

export function projectEntry(entry: unknown): Node | undefined {
  if (!isObject(entry)) return undefined;
  const id = str(entry.id);
  if (id === undefined) return undefined;
  const base = { id, parentId: str(entry.parentId) ?? null };
  if (entry.type === "compaction") {
    const firstKeptEntryId = str(entry.firstKeptEntryId);
    return {
      ...base,
      kind: "compaction",
      chars: str(entry.summary)?.length ?? 0,
      tokensBefore: num(entry.tokensBefore),
      ...(firstKeptEntryId === undefined ? {} : { firstKeptEntryId }),
    };
  }
  if (entry.type === "context_edit") {
    const targetId = str(entry.targetId);
    if (targetId === undefined) return { ...base, kind: "other", chars: 0 };
    const replacement = entry.replacement;
    return {
      ...base,
      kind: "edit",
      chars: 0,
      targetId,
      replacementChars:
        replacement === null ? 0 : isObject(replacement) ? contentChars(replacement.content) : 0,
    };
  }
  if (entry.type === "custom_message")
    return { ...base, kind: "custom", chars: contentChars(entry.content) };
  if (entry.type !== "message" || !isObject(entry.message))
    return { ...base, kind: "other", chars: 0 };
  const message = entry.message;
  switch (message.role) {
    case "system":
      return { ...base, kind: "system", chars: systemChars(message) };
    case "user":
      return { ...base, kind: "user", chars: contentChars(message.content) };
    case "toolResult": {
      const toolCallId = str(message.toolCallId);
      return {
        ...base,
        kind: "toolResult",
        chars: contentChars(message.content),
        toolName: str(message.toolName) ?? "unknown",
        ...(toolCallId === undefined ? {} : { toolCallId }),
      };
    }
    case "assistant": {
      const callKeys = new Map<string, string>();
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (!isObject(block) || block.type !== "toolCall") continue;
          const key = callKey(str(block.name) ?? "", block.arguments);
          const callId = str(block.id);
          if (key !== undefined && callId !== undefined) callKeys.set(callId, key);
        }
      }
      const usage = isObject(message.usage) ? message.usage : {};
      return {
        ...base,
        kind: "assistant",
        chars: contentChars(message.content),
        callKeys,
        promptTokens: num(usage.input) + num(usage.cacheRead) + num(usage.cacheWrite),
      };
    }
    default:
      return { ...base, kind: "other", chars: 0 };
  }
}

export interface ReplayResult {
  policy: string;
  tokensBefore: number;
  /** Masked characters net of placeholders, as a share of the rebuilt context. */
  freedShare: number;
  maskedResults: number;
  maskedCharsByTool: Record<string, number>;
  /** Median prompt growth per turn before compaction, in tokens. */
  growthPerTurn: number | null;
  /** Masked results whose read/command was requested again soon after the compaction. */
  maskedRefetched: number;
  maskedKeyed: number;
}

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
};

function pathTo(nodes: ReadonlyMap<string, Node>, fromId: string | null): Node[] {
  const path: Node[] = [];
  for (let id = fromId; id !== null; ) {
    const node = nodes.get(id);
    if (node === undefined) break;
    path.push(node);
    id = node.parentId;
  }
  return path.reverse();
}

// Mirrors Pi's context build: the latest earlier compaction's summary, its kept range,
// and everything after it, with the latest context edit per target applied.
function rebuildContext(path: readonly Node[]): { system: number; entries: Node[] } {
  const system = Math.max(0, ...path.filter((n) => n.kind === "system").map((n) => n.chars));
  let previous = -1;
  path.forEach((node, index) => {
    if (node.kind === "compaction") previous = index;
  });
  let entries: Node[];
  const summary = path[previous];
  if (summary !== undefined) {
    const kept = path.findIndex((n) => n.id === summary.firstKeptEntryId);
    const start = kept >= 0 && kept < previous ? kept : previous;
    entries = [summary, ...path.slice(start, previous), ...path.slice(previous + 1)];
  } else {
    entries = [...path];
  }
  const edits = new Map<string, number>();
  for (const node of path) {
    if (node.kind === "edit" && node.targetId !== undefined)
      edits.set(node.targetId, node.replacementChars ?? 0);
  }
  const visible = entries
    .filter((n) => n.kind !== "system" && n.kind !== "edit" && n.kind !== "other")
    .map((n) => (edits.has(n.id) ? { ...n, chars: edits.get(n.id) ?? 0 } : n));
  return { system, entries: visible };
}

export function replayCompaction(
  nodes: ReadonlyMap<string, Node>,
  compaction: Node,
  laterKeys: ReadonlySet<string>,
  policy: MaskingPolicy,
): ReplayResult {
  const path = pathTo(nodes, compaction.parentId);
  const { system, entries } = rebuildContext(path);
  const callKeys = new Map<string, string>();
  for (const node of entries) for (const [id, key] of node.callKeys ?? []) callKeys.set(id, key);

  const assistantIndexes = entries.flatMap((n, i) => (n.kind === "assistant" ? [i] : []));
  const boundary =
    assistantIndexes.length > policy.protectRecentTurns
      ? (assistantIndexes[assistantIndexes.length - policy.protectRecentTurns] ?? 0)
      : 0;

  let total = system;
  let freed = 0;
  let maskedResults = 0;
  let maskedKeyed = 0;
  let maskedRefetched = 0;
  const maskedCharsByTool: Record<string, number> = {};
  entries.forEach((node, index) => {
    total += node.chars;
    if (node.kind !== "toolResult" || index >= boundary || node.chars < policy.minResultChars)
      return;
    freed += node.chars - policy.placeholderChars;
    maskedResults++;
    const tool = node.toolName ?? "unknown";
    maskedCharsByTool[tool] = (maskedCharsByTool[tool] ?? 0) + node.chars;
    const key = node.toolCallId === undefined ? undefined : callKeys.get(node.toolCallId);
    if (key === undefined) return;
    maskedKeyed++;
    if (laterKeys.has(key)) maskedRefetched++;
  });

  const prompts = path
    .filter((n) => n.kind === "assistant" && (n.promptTokens ?? 0) > 0)
    .slice(-(GROWTH_WINDOW_TURNS + 1))
    .map((n) => n.promptTokens ?? 0);
  const growth = prompts
    .slice(1)
    .map((prompt, i) => prompt - (prompts[i] ?? 0))
    .filter((d) => d > 0);

  return {
    policy: policy.name,
    tokensBefore: compaction.tokensBefore ?? 0,
    freedShare: total > 0 ? freed / total : 0,
    maskedResults,
    maskedCharsByTool,
    growthPerTurn: median(growth),
    maskedRefetched,
    maskedKeyed,
  };
}

/** Read/bash keys requested in the first turns after each compaction, on its own path. */
function laterKeysByCompaction(order: readonly Node[]): Map<string, Set<string>> {
  const state = new Map<string, { compactionId: string | null; turns: number }>();
  const keys = new Map<string, Set<string>>();
  for (const node of order) {
    const parent = node.parentId === null ? undefined : state.get(node.parentId);
    let compactionId = parent?.compactionId ?? null;
    let turns = parent?.turns ?? 0;
    if (node.kind === "compaction") {
      compactionId = node.id;
      turns = 0;
      keys.set(node.id, new Set());
    } else if (node.kind === "assistant") {
      turns++;
      if (compactionId !== null && turns <= REFETCH_WINDOW_TURNS) {
        for (const key of node.callKeys?.values() ?? []) keys.get(compactionId)?.add(key);
      }
    }
    state.set(node.id, { compactionId, turns });
  }
  return keys;
}

export function replaySession(
  entries: readonly unknown[],
  policies: readonly MaskingPolicy[] = DEFAULT_POLICIES,
): ReplayResult[] {
  const order = entries.map(projectEntry).filter((node): node is Node => node !== undefined);
  const nodes = new Map(order.map((node) => [node.id, node]));
  const later = laterKeysByCompaction(order);
  return order
    .filter((node) => node.kind === "compaction")
    .flatMap((compaction) =>
      policies.map((policy) =>
        replayCompaction(nodes, compaction, later.get(compaction.id) ?? new Set(), policy),
      ),
    );
}

export interface PolicySummary {
  policy: string;
  compactions: number;
  freedShare: { median: number; p90: number } | null;
  /** Share of compactions where masking alone frees at least 25% / 50% of the context. */
  freesQuarter: number;
  freesHalf: number;
  extraTurns: { median: number; p90: number } | null;
  maskedResultsMedian: number | null;
  refetchedShare: number | null;
  toolShares: { tool: string; share: number }[];
}

function nearestRank(values: readonly number[]): { median: number; p90: number } | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { median: rank(0.5), p90: rank(0.9) };
}

export function summarize(results: readonly ReplayResult[]): PolicySummary[] {
  const byPolicy = new Map<string, ReplayResult[]>();
  for (const result of results)
    byPolicy.set(result.policy, [...(byPolicy.get(result.policy) ?? []), result]);
  return [...byPolicy].map(([policy, list]) => {
    const toolChars = new Map<string, number>();
    for (const result of list) {
      for (const [tool, chars] of Object.entries(result.maskedCharsByTool)) {
        toolChars.set(tool, (toolChars.get(tool) ?? 0) + chars);
      }
    }
    const maskedTotal = [...toolChars.values()].reduce((a, b) => a + b, 0);
    const keyed = list.reduce((sum, r) => sum + r.maskedKeyed, 0);
    const extraTurns = list.flatMap((r) =>
      r.growthPerTurn !== null && r.growthPerTurn > 0 && r.tokensBefore > 0
        ? [(r.freedShare * r.tokensBefore) / r.growthPerTurn]
        : [],
    );
    return {
      policy,
      compactions: list.length,
      freedShare: nearestRank(list.map((r) => r.freedShare)),
      freesQuarter: list.filter((r) => r.freedShare >= 0.25).length / list.length,
      freesHalf: list.filter((r) => r.freedShare >= 0.5).length / list.length,
      extraTurns: nearestRank(extraTurns),
      maskedResultsMedian: median(list.map((r) => r.maskedResults)),
      refetchedShare:
        keyed > 0 ? list.reduce((sum, r) => sum + r.maskedRefetched, 0) / keyed : null,
      toolShares: [...toolChars]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([tool, chars]) => ({ tool, share: maskedTotal > 0 ? chars / maskedTotal : 0 })),
    };
  });
}

const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;

export function formatSummary(summaries: readonly PolicySummary[], sessions: number): string {
  const lines = [
    `Masking replay over ${summaries[0]?.compactions ?? 0} compactions from ${sessions} sessions`,
    "Sizes are character-proportional estimates; extra turns divide freed tokens by median pre-compaction growth.",
    "",
  ];
  for (const s of summaries) {
    lines.push(
      `${s.policy}: frees ${pct(s.freedShare?.median)} median / ${pct(s.freedShare?.p90)} p90 of context; ` +
        `>=25% in ${pct(s.freesQuarter)}, >=50% in ${pct(s.freesHalf)} of compactions`,
      `  extra turns before compaction: ${s.extraTurns === null ? "-" : `${Math.round(s.extraTurns.median)} median / ${Math.round(s.extraTurns.p90)} p90`}; ` +
        `masked results per compaction: ${s.maskedResultsMedian ?? "-"}; ` +
        `masked read/bash results requested again within ${REFETCH_WINDOW_TURNS} turns: ${pct(s.refetchedShare)}`,
      `  masked text by tool: ${s.toolShares.map((t) => `${t.tool} ${pct(t.share)}`).join(", ") || "-"}`,
    );
  }
  return lines.join("\n");
}

async function* sessionFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

// Avoids parsing the bulk of the corpus: only sessions with a compaction are replayed.
async function readCompactedSession(path: string): Promise<unknown[] | undefined> {
  const entries: unknown[] = [];
  let compacted = false;
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isObject(entry) && entry.type === "compaction") compacted = true;
      entries.push(entry);
    } catch {
      // Malformed lines are counted by context-baseline; replay skips them.
    }
  }
  return compacted ? entries : undefined;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const options = {
    sessionsDir: join(agentDir, "sessions"),
    since: null as string | null,
    json: null as string | null,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--sessions-dir") options.sessionsDir = value;
    else if (flag === "--since") options.since = value;
    else if (flag === "--json") options.json = value;
    else throw new Error(`Unknown option ${flag}`);
  }
  if (options.since !== null && Number.isNaN(Date.parse(options.since))) {
    throw new Error(`Invalid date ${options.since}`);
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const since = options.since === null ? null : Date.parse(options.since);
  const results: ReplayResult[] = [];
  let sessions = 0;
  for await (const path of sessionFiles(options.sessionsDir)) {
    if (since !== null && (await stat(path)).mtimeMs < since) continue;
    const entries = await readCompactedSession(path);
    if (entries === undefined) continue;
    const header = entries.find((e) => isObject(e) && e.type === "session");
    const started = isObject(header) ? Date.parse(str(header.timestamp) ?? "") : Number.NaN;
    if (since !== null && !(started >= since)) continue;
    sessions++;
    results.push(...replaySession(entries));
  }
  const summaries = summarize(results);
  console.log(formatSummary(summaries, sessions));
  if (options.json !== null)
    await writeFile(options.json, `${JSON.stringify(summaries, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
