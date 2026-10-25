import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Aggregates context, cache, and compaction metrics from Pi session files.
// Output contains only counts and token/cost aggregates, never conversation text.

export const CACHE_WINDOW_TURNS = 3;
export const REPEAT_WINDOW_TURNS = 10;
const RECALL_TOOLS = new Set(["tool_output_search", "vcc_recall"]);

type JsonObject = Record<string, unknown>;

export interface Usage {
  uncachedInput: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  cost: number;
}

export interface CompactionCycle {
  /** Model of the first assistant turn after the compaction, or "(no later turn)". */
  model: string;
  tokensBefore: number;
  fromHook: boolean;
  summaryUsage: Usage;
  /** Assistant turns after the compaction before the next one on the same path. */
  cycleTurns: number;
  beforeCacheReadRatio: number | null;
  afterCacheReadRatio: number | null;
  /** Prompt tokens of the first request after compaction. */
  firstPromptTokens: number | null;
  afterWindowUsage: Usage;
  afterWindowTurns: number;
  preWindowCalls: number;
  preWindowRepeats: number;
  postWindowCalls: number;
  postWindowRepeats: number;
}

export interface ModelUsage {
  turns: number;
  usage: Usage;
}

export interface SessionAnalysis {
  startedAt: string | null;
  turnsByModel: Record<string, ModelUsage>;
  /** Usage entries outside assistant messages, such as cache warming. */
  nonMessageUsage: Usage;
  toolResultChars: number;
  otherMessageChars: number;
  recallCalls: number;
  compactions: CompactionCycle[];
  malformedLines: number;
}

interface AssistantTurn {
  usage: Usage;
  callKeys: string[];
}

interface EntryState {
  parentId: string | null;
  compactionId: string | null;
  turnsSinceCompaction: number;
  turn?: AssistantTurn;
}

interface PendingCompaction {
  cycle: CompactionCycle;
  priorKeys: Set<string>;
  seenInWindow: Set<string>;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

export const emptyUsage = (): Usage => ({
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  cost: 0,
});

function addUsage(total: Usage, usage: Usage): void {
  total.uncachedInput += usage.uncachedInput;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.output += usage.output;
  total.cost += usage.cost;
}

export const promptTokens = (usage: Usage): number =>
  usage.uncachedInput + usage.cacheRead + usage.cacheWrite;

function cacheReadRatio(turns: readonly AssistantTurn[]): number | null {
  const total = emptyUsage();
  for (const turn of turns) addUsage(total, turn.usage);
  const prompt = promptTokens(total);
  return prompt > 0 ? total.cacheRead / prompt : null;
}

// Pi usage reports `input` as uncached input, separate from cache reads and writes.
function readUsage(value: unknown): Usage {
  if (!isObject(value)) return emptyUsage();
  return {
    uncachedInput: num(value.input),
    cacheRead: num(value.cacheRead),
    cacheWrite: num(value.cacheWrite),
    output: num(value.output),
    cost: isObject(value.cost) ? num(value.cost.total) : 0,
  };
}

// shortcut: only direct `read` and `bash` calls are keyed; calls made inside codemode
// scripts are invisible here. Extend when masking changes how codemode output is recalled.
function callKey(name: string, args: JsonObject): string | undefined {
  if (name === "read") {
    const path = str(args.path);
    return path === undefined ? undefined : `read:${path}`;
  }
  if (name === "bash") {
    const command = str(args.command)?.trim();
    return command ? `bash:${command}` : undefined;
  }
  return undefined;
}

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

export function createSessionAnalyzer() {
  const analysis: SessionAnalysis = {
    startedAt: null,
    turnsByModel: {},
    nonMessageUsage: emptyUsage(),
    toolResultChars: 0,
    otherMessageChars: 0,
    recallCalls: 0,
    compactions: [],
    malformedLines: 0,
  };
  const states = new Map<string, EntryState>();
  const pending = new Map<string, PendingCompaction>();

  const pathTurns = (fromId: string | null): AssistantTurn[] => {
    const turns: AssistantTurn[] = [];
    let id = fromId;
    while (id !== null) {
      const state = states.get(id);
      if (state === undefined) break;
      if (state.turn !== undefined) turns.push(state.turn);
      id = state.parentId;
    }
    return turns.reverse();
  };

  const startCompaction = (entry: JsonObject, id: string, parentId: string | null): void => {
    const before = pathTurns(parentId);
    const preWindow = before.slice(-REPEAT_WINDOW_TURNS);
    const earlierKeys = new Set(before.slice(0, -REPEAT_WINDOW_TURNS).flatMap((t) => t.callKeys));
    const seen = new Set<string>();
    let preWindowCalls = 0;
    let preWindowRepeats = 0;
    for (const key of preWindow.flatMap((t) => t.callKeys)) {
      preWindowCalls++;
      if (earlierKeys.has(key) && !seen.has(key)) preWindowRepeats++;
      seen.add(key);
    }
    const cycle: CompactionCycle = {
      model: "(no later turn)",
      tokensBefore: num(entry.tokensBefore),
      fromHook: entry.fromHook === true,
      summaryUsage: readUsage(entry.usage),
      cycleTurns: 0,
      beforeCacheReadRatio: cacheReadRatio(before.slice(-CACHE_WINDOW_TURNS)),
      afterCacheReadRatio: null,
      firstPromptTokens: null,
      afterWindowUsage: emptyUsage(),
      afterWindowTurns: 0,
      preWindowCalls,
      preWindowRepeats,
      postWindowCalls: 0,
      postWindowRepeats: 0,
    };
    analysis.compactions.push(cycle);
    pending.set(id, {
      cycle,
      priorKeys: new Set(before.flatMap((t) => t.callKeys)),
      seenInWindow: new Set(),
    });
  };

  // shortcut: turns from sibling branches after one compaction share its windows.
  // Branching after compaction is rare; split per branch if it skews results.
  const recordPostCompactionTurn = (
    state: EntryState,
    turn: AssistantTurn,
    model: string,
  ): void => {
    const open = state.compactionId === null ? undefined : pending.get(state.compactionId);
    if (open === undefined) return;
    const { cycle } = open;
    const index = state.turnsSinceCompaction;
    cycle.cycleTurns = Math.max(cycle.cycleTurns, index);
    if (index === 1 && cycle.firstPromptTokens === null) {
      cycle.firstPromptTokens = promptTokens(turn.usage);
      cycle.model = model;
    }
    if (index <= CACHE_WINDOW_TURNS) {
      addUsage(cycle.afterWindowUsage, turn.usage);
      cycle.afterWindowTurns++;
      const prompt = promptTokens(cycle.afterWindowUsage);
      cycle.afterCacheReadRatio = prompt > 0 ? cycle.afterWindowUsage.cacheRead / prompt : null;
    }
    if (index <= REPEAT_WINDOW_TURNS) {
      for (const key of turn.callKeys) {
        cycle.postWindowCalls++;
        if (open.priorKeys.has(key) && !open.seenInWindow.has(key)) cycle.postWindowRepeats++;
        open.seenInWindow.add(key);
      }
    }
  };

  const addMessage = (message: JsonObject, state: EntryState): void => {
    const role = message.role;
    if (role === "toolResult") {
      analysis.toolResultChars += contentChars(message.content);
      return;
    }
    if (role === "user") {
      analysis.otherMessageChars += contentChars(message.content);
      return;
    }
    if (role !== "assistant") return;
    analysis.otherMessageChars += contentChars(message.content);
    const usage = readUsage(message.usage);
    const model = `${str(message.provider) ?? "unknown"}/${str(message.model) ?? "unknown"}`;
    const callKeys: string[] = [];
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isObject(block) || block.type !== "toolCall") continue;
        const name = str(block.name) ?? "";
        if (RECALL_TOOLS.has(name)) analysis.recallCalls++;
        const key = isObject(block.arguments) ? callKey(name, block.arguments) : undefined;
        if (key !== undefined) callKeys.push(key);
      }
    }
    const turn: AssistantTurn = { usage, callKeys };
    state.turn = turn;
    state.turnsSinceCompaction++;
    const totals = analysis.turnsByModel[model] ?? { turns: 0, usage: emptyUsage() };
    analysis.turnsByModel[model] = totals;
    totals.turns++;
    addUsage(totals.usage, usage);
    recordPostCompactionTurn(state, turn, model);
  };

  const add = (entry: unknown): void => {
    if (!isObject(entry)) {
      analysis.malformedLines++;
      return;
    }
    if (entry.type === "session") {
      analysis.startedAt = str(entry.timestamp) ?? null;
      return;
    }
    const id = str(entry.id);
    if (id === undefined) return;
    const parentId = str(entry.parentId) ?? null;
    const parent = parentId === null ? undefined : states.get(parentId);
    const state: EntryState = {
      parentId,
      compactionId: parent?.compactionId ?? null,
      turnsSinceCompaction: parent?.turnsSinceCompaction ?? 0,
    };
    states.set(id, state);
    if (entry.type === "compaction") {
      startCompaction(entry, id, parentId);
      state.compactionId = id;
      state.turnsSinceCompaction = 0;
    } else if (entry.type === "message" && isObject(entry.message)) {
      addMessage(entry.message, state);
    } else if (entry.type === "custom_message") {
      analysis.otherMessageChars += contentChars(entry.content);
    } else if (entry.type === "usage") {
      addUsage(analysis.nonMessageUsage, readUsage(entry.usage));
    }
  };

  const addLine = (line: string): void => {
    if (line.trim() === "") return;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      analysis.malformedLines++;
      return;
    }
    add(entry);
  };

  return { add, addLine, finish: (): SessionAnalysis => analysis };
}

export function analyzeSession(entries: readonly unknown[]): SessionAnalysis {
  const analyzer = createSessionAnalyzer();
  for (const entry of entries) analyzer.add(entry);
  return analyzer.finish();
}

export interface Distribution {
  median: number;
  p90: number;
}

export function distribution(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  return { median: rank(0.5), p90: rank(0.9) };
}

const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
const present = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null);

export interface ModelReport extends Usage {
  model: string;
  sessions: number;
  turns: number;
  cacheReadRatio: number | null;
}

export interface CompactionReport {
  model: string;
  count: number;
  fromHookShare: number;
  tokensBefore: Distribution | null;
  cycleTurns: Distribution | null;
  /** 1 - first post-compaction prompt / tokensBefore. */
  firstPromptReduction: Distribution | null;
  beforeCacheReadRatio: Distribution | null;
  afterCacheReadRatio: Distribution | null;
  summaryUsage: Usage;
  /** Re-fetch of older reads/commands in the window before vs after compaction. */
  preWindowRepeatRate: number | null;
  postWindowRepeatRate: number | null;
}

export interface BaselineReport {
  filters: { since: string | null; until: string | null };
  windows: { cacheTurns: number; repeatTurns: number };
  sessions: {
    analyzed: number;
    withCompaction: number;
    malformedLines: number;
    toolResultShare: Distribution | null;
  };
  models: ModelReport[];
  compactions: CompactionReport[];
  nonMessageUsage: Usage;
  recallCalls: number;
}

export function aggregate(
  sessions: readonly SessionAnalysis[],
  filters: BaselineReport["filters"] = { since: null, until: null },
): BaselineReport {
  const models = new Map<string, ModelReport>();
  const cycles = new Map<string, CompactionCycle[]>();
  const nonMessageUsage = emptyUsage();
  const toolShares: number[] = [];
  let malformedLines = 0;
  let recallCalls = 0;

  for (const session of sessions) {
    malformedLines += session.malformedLines;
    recallCalls += session.recallCalls;
    addUsage(nonMessageUsage, session.nonMessageUsage);
    const share = ratio(
      session.toolResultChars,
      session.toolResultChars + session.otherMessageChars,
    );
    if (share !== null) toolShares.push(share);
    for (const [model, { turns, usage }] of Object.entries(session.turnsByModel)) {
      const report = models.get(model) ?? {
        model,
        sessions: 0,
        turns: 0,
        cacheReadRatio: null,
        ...emptyUsage(),
      };
      report.sessions++;
      report.turns += turns;
      addUsage(report, usage);
      models.set(model, report);
    }
    for (const cycle of session.compactions) {
      const list = cycles.get(cycle.model) ?? [];
      list.push(cycle);
      cycles.set(cycle.model, list);
    }
  }

  for (const report of models.values()) {
    report.cacheReadRatio = ratio(report.cacheRead, promptTokens(report));
  }

  const compactions = [...cycles].map(([model, list]): CompactionReport => {
    const summaryUsage = emptyUsage();
    for (const cycle of list) addUsage(summaryUsage, cycle.summaryUsage);
    const sum = (pick: (cycle: CompactionCycle) => number) =>
      list.reduce((total, cycle) => total + pick(cycle), 0);
    return {
      model,
      count: list.length,
      fromHookShare: list.filter((cycle) => cycle.fromHook).length / list.length,
      tokensBefore: distribution(
        present(list.map((c) => (c.tokensBefore > 0 ? c.tokensBefore : null))),
      ),
      cycleTurns: distribution(list.map((c) => c.cycleTurns)),
      firstPromptReduction: distribution(
        present(
          list.map((c) =>
            c.firstPromptTokens !== null && c.tokensBefore > 0
              ? 1 - c.firstPromptTokens / c.tokensBefore
              : null,
          ),
        ),
      ),
      beforeCacheReadRatio: distribution(present(list.map((c) => c.beforeCacheReadRatio))),
      afterCacheReadRatio: distribution(present(list.map((c) => c.afterCacheReadRatio))),
      summaryUsage,
      preWindowRepeatRate: ratio(
        sum((c) => c.preWindowRepeats),
        sum((c) => c.preWindowCalls),
      ),
      postWindowRepeatRate: ratio(
        sum((c) => c.postWindowRepeats),
        sum((c) => c.postWindowCalls),
      ),
    };
  });

  return {
    filters,
    windows: { cacheTurns: CACHE_WINDOW_TURNS, repeatTurns: REPEAT_WINDOW_TURNS },
    sessions: {
      analyzed: sessions.length,
      withCompaction: sessions.filter((session) => session.compactions.length > 0).length,
      malformedLines,
      toolResultShare: distribution(toolShares),
    },
    models: [...models.values()].sort((a, b) => promptTokens(b) - promptTokens(a)),
    compactions: compactions.sort((a, b) => b.count - a.count),
    nonMessageUsage,
    recallCalls,
  };
}

const pct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
const tokens = (value: number): string =>
  value >= 1e6
    ? `${(value / 1e6).toFixed(1)}M`
    : value >= 1e3
      ? `${(value / 1e3).toFixed(1)}k`
      : `${Math.round(value)}`;
const dist = (value: Distribution | null, format: (n: number) => string): string =>
  value === null ? "-" : `${format(value.median)} / ${format(value.p90)}`;

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

export function formatReport(report: BaselineReport): string {
  const { sessions } = report;
  const range = `${report.filters.since ?? "start"} .. ${report.filters.until ?? "now"}`;
  const sections = [
    `Sessions ${range}: ${sessions.analyzed} analyzed, ${sessions.withCompaction} with compaction, ${sessions.malformedLines} malformed lines`,
    `Tool-result share of raw message text (median / p90): ${dist(sessions.toolResultShare, pct)}`,
    "",
    "Usage by model (cost is the catalog estimate Pi recorded, not necessarily billed)",
    table(
      [
        "model",
        "sessions",
        "turns",
        "uncached",
        "cache read",
        "cache write",
        "output",
        "read ratio",
        "cost",
      ],
      report.models.map((m) => [
        m.model,
        `${m.sessions}`,
        `${m.turns}`,
        tokens(m.uncachedInput),
        tokens(m.cacheRead),
        tokens(m.cacheWrite),
        tokens(m.output),
        pct(m.cacheReadRatio),
        `$${m.cost.toFixed(2)}`,
      ]),
    ),
    "",
    `Compaction cycles by post-compaction model (median / p90; cache windows ${report.windows.cacheTurns} turns, repeat windows ${report.windows.repeatTurns} turns)`,
    table(
      [
        "model",
        "count",
        "hook",
        "tokens before",
        "cycle turns",
        "1st-prompt cut",
        "read before",
        "read after",
        "repeats pre",
        "repeats post",
        "summary cost",
      ],
      report.compactions.map((c) => [
        c.model,
        `${c.count}`,
        pct(c.fromHookShare),
        dist(c.tokensBefore, tokens),
        dist(c.cycleTurns, (n) => `${n}`),
        dist(c.firstPromptReduction, pct),
        dist(c.beforeCacheReadRatio, pct),
        dist(c.afterCacheReadRatio, pct),
        pct(c.preWindowRepeatRate),
        pct(c.postWindowRepeatRate),
        `$${c.summaryUsage.cost.toFixed(2)}`,
      ]),
    ),
    "",
    `Non-message usage (e.g. cache warming): ${tokens(promptTokens(report.nonMessageUsage))} prompt tokens, $${report.nonMessageUsage.cost.toFixed(2)}`,
    `Recall/artifact-search calls: ${report.recallCalls}`,
  ];
  return sections.join("\n");
}

async function* sessionFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sessionFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

async function analyzeFile(path: string): Promise<SessionAnalysis> {
  const analyzer = createSessionAnalyzer();
  const lines = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) analyzer.addLine(line);
  return analyzer.finish();
}

interface CliOptions {
  sessionsDir: string;
  since: string | null;
  until: string | null;
  json: string | null;
}

export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const options: CliOptions = {
    sessionsDir: join(agentDir, "sessions"),
    since: null,
    until: null,
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--sessions-dir") options.sessionsDir = value;
    else if (flag === "--since") options.since = value;
    else if (flag === "--until") options.until = value;
    else if (flag === "--json") options.json = value;
    else throw new Error(`Unknown option ${flag}`);
    i++;
  }
  for (const date of [options.since, options.until]) {
    if (date !== null && Number.isNaN(Date.parse(date))) throw new Error(`Invalid date ${date}`);
  }
  return options;
}

export function inRange(
  startedAt: string | null,
  since: string | null,
  until: string | null,
): boolean {
  if (since === null && until === null) return true;
  if (startedAt === null) return false;
  const time = Date.parse(startedAt);
  if (since !== null && time < Date.parse(since)) return false;
  if (until !== null && time >= Date.parse(until)) return false;
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sinceTime = options.since === null ? null : Date.parse(options.since);
  const sessions: SessionAnalysis[] = [];
  for await (const path of sessionFiles(options.sessionsDir)) {
    // A file last written before `since` cannot contain a session started after it.
    if (sinceTime !== null && (await stat(path)).mtimeMs < sinceTime) continue;
    const analysis = await analyzeFile(path);
    if (inRange(analysis.startedAt, options.since, options.until)) sessions.push(analysis);
  }
  const report = aggregate(sessions, { since: options.since, until: options.until });
  console.log(formatReport(report));
  if (options.json !== null) await writeFile(options.json, `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
