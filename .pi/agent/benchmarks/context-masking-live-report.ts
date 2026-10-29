import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Reports how rolling masking behaved in real sessions: cache reuse, commits, held masks,
// classifier time, and compactions. Reads session logs only; output holds counts, never text.

type JsonObject = Record<string, unknown>;

export interface SessionReport {
  file: string;
  /** Sessions whose rolling records predate held masks use the older commit-every-batch rule. */
  policy: "pressure" | "rolling";
  requests: number;
  promptTokens: number;
  cachedTokens: number;
  /** Tokens the provider processed without a cache hit: uncached input plus cache writes. */
  uncachedTokens: number;
  peakPromptTokens: number;
  classifications: number;
  classifierRequests: number;
  classifierSeconds: number;
  commits: number;
  committedTokens: number;
  /** Commits made while classifiable output was still deferred. */
  commitsWithBacklog: number;
  heldMasksAtEnd: number;
  heldTokensAtEnd: number;
  compactions: number;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function reportSession(file: string, entries: readonly unknown[]): SessionReport | undefined {
  const report: SessionReport = {
    file, policy: "rolling", requests: 0, promptTokens: 0, cachedTokens: 0, uncachedTokens: 0,
    peakPromptTokens: 0, classifications: 0, classifierRequests: 0, classifierSeconds: 0,
    commits: 0, committedTokens: 0, commitsWithBacklog: 0, heldMasksAtEnd: 0, heldTokensAtEnd: 0,
    compactions: 0,
  };
  let rolling = false;
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    if (entry.type === "compaction") report.compactions++;
    if (entry.type === "message" && isObject(entry.message) && entry.message.role === "assistant") {
      const usage = entry.message.usage;
      if (!isObject(usage)) continue;
      const input = count(usage.input);
      const cached = count(usage.cacheRead);
      const written = count(usage.cacheWrite);
      const prompt = input + cached + written;
      if (prompt === 0) continue;
      report.requests++;
      report.promptTokens += prompt;
      report.cachedTokens += cached;
      report.uncachedTokens += input + written;
      report.peakPromptTokens = Math.max(report.peakPromptTokens, prompt);
    }
    if (entry.type !== "custom" || entry.customType !== "context-masking-rolling" || !isObject(entry.data)) continue;
    rolling = true;
    const data = entry.data;
    if (Array.isArray(data.pendingMasks)) {
      report.policy = "pressure";
      report.heldMasksAtEnd = data.pendingMasks.length;
      report.heldTokensAtEnd = count(data.pendingMaskTokens);
    }
    const requests = count(data.requestCount);
    if (requests > 0) report.classifications++;
    report.classifierRequests += requests;
    report.classifierSeconds += count(data.classifierDurationMs) / 1000;
    if (count(data.maskedCount) > 0) {
      report.commits++;
      report.committedTokens += count(data.estimatedSavedTokens);
      if (count(data.deferredCount) > 0) report.commitsWithBacklog++;
    }
  }
  return rolling ? report : undefined;
}

export type PolicyTotals = Omit<SessionReport, "file" | "policy" | "peakPromptTokens"> & {
  policy: SessionReport["policy"];
  sessions: number;
  cacheReadShare: number;
};

export function summarize(reports: readonly SessionReport[]): PolicyTotals[] {
  const totals = new Map<SessionReport["policy"], PolicyTotals>();
  for (const report of reports) {
    const total = totals.get(report.policy) ?? {
      policy: report.policy, sessions: 0, requests: 0, promptTokens: 0, cachedTokens: 0, uncachedTokens: 0,
      classifications: 0, classifierRequests: 0, classifierSeconds: 0, commits: 0, committedTokens: 0,
      commitsWithBacklog: 0, heldMasksAtEnd: 0, heldTokensAtEnd: 0, compactions: 0, cacheReadShare: 0,
    };
    total.sessions++;
    for (const key of [
      "requests", "promptTokens", "cachedTokens", "uncachedTokens", "classifications", "classifierRequests",
      "classifierSeconds", "commits", "committedTokens", "commitsWithBacklog", "heldMasksAtEnd",
      "heldTokensAtEnd", "compactions",
    ] as const) total[key] += report[key];
    total.cacheReadShare = total.promptTokens ? total.cachedTokens / total.promptTokens : 0;
    totals.set(report.policy, total);
  }
  return [...totals.values()];
}

export function formatSummary(totals: readonly PolicyTotals[]): string {
  const rows = totals.map((t) =>
    `${t.policy.padEnd(9)} sessions=${t.sessions} requests=${t.requests} cacheRead=${(t.cacheReadShare * 100).toFixed(1)}%` +
    ` uncached=${(t.uncachedTokens / 1e6).toFixed(2)}M commits=${t.commits} commitsWithBacklog=${t.commitsWithBacklog}` +
    ` classifierSeconds=${t.classifierSeconds.toFixed(1)} heldAtEnd=${t.heldMasksAtEnd} compactions=${t.compactions}`);
  return ["Rolling masking in logged sessions", ...rows].join("\n");
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const agentDir = env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const args = { sessionsDir: join(agentDir, "sessions"), since: 0, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--json") args.json = true;
    else if (flag === "--sessions") args.sessionsDir = argv[++i] ?? args.sessionsDir;
    else if (flag === "--since") {
      const since = Date.parse(argv[++i] ?? "");
      if (!Number.isFinite(since)) throw new Error("--since needs a date, such as 2026-10-29");
      args.since = since;
    } else throw new Error(`Unknown argument: ${flag}`);
  }
  return args;
}

async function sessionFiles(dir: string, since: number): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(dir, { recursive: true })) {
    if (!item.endsWith(".jsonl")) continue;
    const path = join(dir, item);
    if ((await stat(path)).mtimeMs >= since) files.push(path);
  }
  return files.sort();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reports: SessionReport[] = [];
  for (const file of await sessionFiles(args.sessionsDir, args.since)) {
    const text = await readFile(file, "utf8");
    // Avoids parsing sessions that never ran rolling masking.
    if (!text.includes('"context-masking-rolling"')) continue;
    const entries = text.split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line) as unknown]; } catch { return []; }
    });
    const report = reportSession(file.slice(args.sessionsDir.length + 1), entries);
    if (report) reports.push(report);
  }
  const totals = summarize(reports);
  console.log(args.json ? JSON.stringify({ totals, sessions: reports }, null, 2) : formatSummary(totals));
}

if (import.meta.main) await main();
