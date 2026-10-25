import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { buildSessionProjection, type SessionEntry } from "@earendil-works/pi-coding-agent";

// Offline evaluation of compaction strategies at recorded compaction points.
// "Needed" tokens are distinctive tokens (paths, identifiers, hashes, codes) that the agent
// itself wrote in the first turns after compaction before any new tool result or user message
// supplied them, that existed only in the summarized history. A strategy covers a token when
// its retained text contains it. Output holds only counts and ratios.

export const POST_TURNS = 10;
/** Tool results this large and older than the masking window are assumed masked and indexed. */
export const MASK_MIN_CHARS = 800;
export const MASK_PROTECT_TURNS = 10;
const PLACEHOLDER = "[masked]";

type Projected = ReturnType<typeof buildSessionProjection>["entries"][number];
type Message = Projected["messages"][number];

export interface Block {
  kind: "user" | "exchange" | "summary";
  text: string;
  /** Position in the summarized range, oldest first. */
  index: number;
}

// Paths, dotted/underscored/camelCase identifiers, long numbers, hex hashes, and flags.
const TOKEN_RE =
  /(?:[\w.-]*\/[\w./-]+)|(?:\b[A-Za-z_][\w]*(?:[._][\w]+)+\b)|(?:\b[a-z]+[A-Z][\w]*\b)|(?:\b\d{4,}\b)|(?:\b[0-9a-f]{7,40}\b)|(?:--[a-z][\w-]{2,})/gu;

export function distinctiveTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.matchAll(TOKEN_RE)) {
    const token = match[0].replace(/[.,:;)]+$/u, "");
    if (token.length >= 5 && !/^\/+$/u.test(token)) tokens.add(token);
  }
  return tokens;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string; arguments?: unknown }) =>
      block.type === "text"
        ? (block.text ?? "")
        : block.type === "toolCall"
          ? JSON.stringify(block.arguments ?? {})
          : "",
    )
    .join("\n");
}

function messageText(message: Message): string {
  switch (message.role) {
    case "user":
    case "custom":
    case "assistant":
    case "toolResult":
      return contentText(message.content);
    case "compactionSummary":
    case "branchSummary":
      return message.summary;
    default:
      return "";
  }
}

/** Groups messages into user, summary, and assistant-plus-tool-results blocks, masking old large results. */
export function toBlocks(messages: readonly Message[], maskBefore: number): Block[] {
  const blocks: Block[] = [];
  let exchange: string[] | undefined;
  const flush = () => {
    if (exchange !== undefined)
      blocks.push({ kind: "exchange", text: exchange.join("\n"), index: blocks.length });
    exchange = undefined;
  };
  messages.forEach((message, i) => {
    if (message.role === "system") return;
    if (message.role === "assistant") {
      flush();
      exchange = [messageText(message)];
      return;
    }
    if (message.role === "toolResult") {
      const text = messageText(message);
      const masked = i < maskBefore && text.length >= MASK_MIN_CHARS;
      exchange = [...(exchange ?? []), masked ? PLACEHOLDER : text];
      return;
    }
    flush();
    const text = messageText(message);
    if (text) {
      blocks.push({
        kind:
          message.role === "compactionSummary" || message.role === "branchSummary"
            ? "summary"
            : "user",
        text,
        index: blocks.length,
      });
    }
  });
  flush();
  return blocks;
}

export interface CompactionCase {
  blocks: Block[];
  summary: string;
  needed: Set<string>;
  /** Latest user request at compaction time, for relevance judgments. */
  currentRequest: string;
}

/** Index of the first message older than the masking window, counted in assistant turns. */
function maskBoundary(messages: readonly Message[]): number {
  let turns = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant" && ++turns === MASK_PROTECT_TURNS) return i;
  }
  return 0;
}

export function buildCase(
  entries: SessionEntry[],
  byId: Map<string, SessionEntry>,
  compaction: SessionEntry,
): CompactionCase | undefined {
  if (compaction.type !== "compaction" || compaction.parentId === null) return undefined;
  const projection = buildSessionProjection(entries, compaction.parentId, byId);
  const keptAt = projection.entries.findIndex(
    (e) => e.sourceEntry.id === compaction.firstKeptEntryId,
  );
  const split = keptAt < 0 ? projection.entries.length : keptAt;
  const all = projection.entries.flatMap((e) => e.messages);
  const summarizedMessages = projection.entries.slice(0, split).flatMap((e) => e.messages);
  const keptMessages = projection.entries.slice(split).flatMap((e) => e.messages);
  const blocks = toBlocks(summarizedMessages, maskBoundary(all));
  if (blocks.length === 0) return undefined;

  const available = new Set<string>();
  for (const message of [...keptMessages, ...all.filter((m) => m.role === "system")]) {
    for (const token of distinctiveTokens(messageText(message))) available.add(token);
  }
  const source = new Set<string>();
  for (const block of blocks) for (const token of distinctiveTokens(block.text)) source.add(token);

  // Walk the entries after the compaction on its branch, in order.
  const children = new Map<string, SessionEntry[]>();
  for (const entry of entries) {
    if (entry.parentId !== null)
      children.set(entry.parentId, [...(children.get(entry.parentId) ?? []), entry]);
  }
  const needed = new Set<string>();
  const supplied = new Set<string>();
  let turns = 0;
  // shortcut: follows the first child at each step; post-compaction branching is rare.
  for (
    let next = children.get(compaction.id)?.[0];
    next !== undefined && turns < POST_TURNS;
    next = children.get(next.id)?.[0]
  ) {
    if (next.type === "compaction") break;
    if (next.type !== "message" && next.type !== "custom_message") continue;
    const message = next.type === "message" ? next.message : undefined;
    const text = message
      ? messageText(message as Message)
      : contentText((next as { content?: unknown }).content);
    const tokens = distinctiveTokens(text);
    if (message?.role === "assistant") {
      turns++;
      for (const token of tokens) {
        if (source.has(token) && !available.has(token) && !supplied.has(token)) needed.add(token);
      }
    } else {
      for (const token of tokens) supplied.add(token);
    }
  }
  const lastUser = [...summarizedMessages, ...keptMessages]
    .reverse()
    .find((m) => m.role === "user");
  const currentRequest = lastUser ? messageText(lastUser) : "";
  return { blocks, summary: compaction.summary, needed, currentRequest };
}

export type Strategy = (
  blocks: readonly Block[],
  budget: number,
  needed: ReadonlySet<string>,
) => Block[];

export const fit = (ordered: readonly Block[], budget: number): Block[] => {
  const chosen: Block[] = [];
  let used = 0;
  for (const block of ordered) {
    if (used + block.text.length > budget) continue;
    chosen.push(block);
    used += block.text.length;
  }
  return chosen;
};

export const STRATEGIES: Record<string, Strategy> = {
  recency: (blocks, budget) => fit([...blocks].reverse(), budget),
  // pi-vcc-like: user requests and prior summaries first, then the newest exchanges.
  "user-first": (blocks, budget) =>
    fit(
      [
        ...blocks.filter((b) => b.kind !== "exchange"),
        ...blocks.filter((b) => b.kind === "exchange").reverse(),
      ],
      budget,
    ),
  // Hindsight-only greedy reference, not an optimal upper bound: needed tokens per character.
  oracle: (blocks, budget, needed) =>
    fit(
      [...blocks].sort((a, b) => {
        const score = (x: Block) =>
          [...distinctiveTokens(x.text)].filter((t) => needed.has(t)).length /
          Math.max(1, x.text.length);
        return score(b) - score(a);
      }),
      budget,
    ),
};

export function coverage(text: string, needed: ReadonlySet<string>): number {
  let hit = 0;
  for (const token of needed) if (text.includes(token)) hit++;
  return hit;
}

export interface CaseScore {
  needed: number;
  budget: number;
  summarizedChars: number;
  blocks: number;
  covered: Record<string, number>;
}

/** Budgets as multiples of the recorded summary's length. */
export const BUDGETS = [1, 2, 4] as const;

export function scoreCase(c: CompactionCase): CaseScore {
  const budget = c.summary.length;
  const covered: Record<string, number> = { summary: coverage(c.summary, c.needed) };
  for (const [name, strategy] of Object.entries(STRATEGIES)) {
    for (const multiple of BUDGETS) {
      const text = strategy(c.blocks, budget * multiple, c.needed)
        .map((b) => b.text)
        .join("\n");
      covered[`${name}@${multiple}x`] = coverage(text, c.needed);
      // Keep the LLM summary and add verbatim blocks in (multiple - 1) extra summary-lengths.
      if (multiple > 1) {
        const extra = strategy(c.blocks, budget * (multiple - 1), c.needed)
          .map((b) => b.text)
          .join("\n");
        covered[`summary+${name}@${multiple}x`] = coverage(`${c.summary}\n${extra}`, c.needed);
      }
    }
  }
  return {
    needed: c.needed.size,
    budget,
    summarizedChars: c.blocks.reduce((sum, b) => sum + b.text.length, 0),
    blocks: c.blocks.length,
    covered,
  };
}

const quantile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0
    ? 0
    : (sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0);
};

export function summarize(scores: readonly CaseScore[]) {
  const withNeed = scores.filter((s) => s.needed > 0);
  const methods = Object.keys(scores[0]?.covered ?? {});
  const total = withNeed.reduce((sum, s) => sum + s.needed, 0);
  return {
    compactions: scores.length,
    withNeededTokens: withNeed.length,
    neededTokens: {
      total,
      median: quantile(
        withNeed.map((s) => s.needed),
        0.5,
      ),
      p90: quantile(
        withNeed.map((s) => s.needed),
        0.9,
      ),
    },
    budgetChars: {
      median: quantile(
        scores.map((s) => s.budget),
        0.5,
      ),
      p90: quantile(
        scores.map((s) => s.budget),
        0.9,
      ),
    },
    summarizedChars: {
      median: quantile(
        scores.map((s) => s.summarizedChars),
        0.5,
      ),
      p90: quantile(
        scores.map((s) => s.summarizedChars),
        0.9,
      ),
    },
    blocks: {
      median: quantile(
        scores.map((s) => s.blocks),
        0.5,
      ),
      p90: quantile(
        scores.map((s) => s.blocks),
        0.9,
      ),
      total: scores.reduce((sum, s) => sum + s.blocks, 0),
    },
    // Micro recall pools tokens; macro recall averages per compaction.
    recall: Object.fromEntries(
      methods.map((m) => [
        m,
        {
          micro: total > 0 ? withNeed.reduce((sum, s) => sum + (s.covered[m] ?? 0), 0) / total : 0,
          macro:
            withNeed.length > 0
              ? withNeed.reduce((sum, s) => sum + (s.covered[m] ?? 0) / s.needed, 0) /
                withNeed.length
              : 0,
        },
      ]),
    ),
  };
}

export async function* sessionFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

export async function readEntries(path: string): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"id"')) continue;
    try {
      const entry: { type?: unknown } = JSON.parse(line);
      if (entry.type !== "session") entries.push(entry as SessionEntry);
    } catch {
      // Malformed lines are counted by context-baseline.
    }
  }
  return entries;
}

async function main(): Promise<void> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const [sessionsDir = join(agentDir, "sessions"), jsonOut] = process.argv.slice(2);
  const scores: CaseScore[] = [];
  let failed = 0;
  for await (const path of sessionFiles(sessionsDir)) {
    const entries = await readEntries(path);
    if (!entries.some((e) => e.type === "compaction")) continue;
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const entry of entries) {
      if (entry.type !== "compaction") continue;
      try {
        const c = buildCase(entries, byId, entry);
        if (c !== undefined) scores.push(scoreCase(c));
      } catch {
        failed++;
      }
    }
  }
  const report = { ...summarize(scores), failedCases: failed };
  console.log(JSON.stringify(report, null, 2));
  if (jsonOut !== undefined) await writeFile(jsonOut, `${JSON.stringify(scores)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
