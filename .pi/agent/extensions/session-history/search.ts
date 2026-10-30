import { isAbsolute, relative } from "node:path";
import type { ChunkHit, HistoryStore, MatchMode, SessionRow } from "./store";

export const SEARCH_LIMITS = {
  defaultResults: 8,
  maxResults: 20,
  chunkHits: 400,
  snippetChars: 240,
  titleChars: 80,
} as const;

const RECENCY_HALF_LIFE_DAYS = 30;
const RECENCY_WEIGHT = 0.3;
const PROJECT_BOOST = 1.3;
const DAY_MS = 86_400_000;

export interface SearchResult {
  readonly sessionId: string;
  readonly title: string;
  readonly date: string;
  readonly project: string;
  readonly messageId: string;
  readonly snippet: string;
  readonly hits: number;
  readonly score: number;
}

export interface SearchReport {
  readonly results: readonly SearchResult[];
  /** `partial` means no session matched every term. */
  readonly matchMode: Exclude<MatchMode, "any">;
}

export interface SearchOptions {
  readonly query: string;
  readonly cwd: string;
  readonly excludeSessionId: string;
  readonly limit?: number;
  readonly now?: number;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function sessionTitle(session: SessionRow): string {
  return clip(session.title ?? session.firstUser ?? "(untitled session)", SEARCH_LIMITS.titleChars);
}

function isRelatedProject(sessionCwd: string, cwd: string): boolean {
  if (!sessionCwd || !cwd) return false;
  const inside = (path: string) => path === "" || (!path.startsWith("..") && !isAbsolute(path));
  return inside(relative(cwd, sessionCwd)) || inside(relative(sessionCwd, cwd));
}

function rankScore(
  bm25: number,
  hits: number,
  session: SessionRow,
  cwd: string,
  now: number,
): number {
  const relevance = -bm25 * (1 + 0.1 * Math.log(hits));
  const updated = Date.parse(session.updatedAt);
  const ageDays = Number.isFinite(updated) ? Math.max(0, (now - updated) / DAY_MS) : Infinity;
  const recency = 1 + RECENCY_WEIGHT * 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS);
  const project = isRelatedProject(session.cwd, cwd) ? PROJECT_BOOST : 1;
  return relevance * recency * project;
}

/** Ranks sessions by their best-matching chunk, boosted for recency and the current project. */
export function searchSessions(store: HistoryStore, options: SearchOptions): SearchReport {
  const limit = Math.min(
    Math.max(options.limit ?? SEARCH_LIMITS.defaultResults, 1),
    SEARCH_LIMITS.maxResults,
  );
  const now = options.now ?? Date.now();
  const find = (mode: MatchMode) =>
    store.findChunks(options.query, {
      mode,
      limit: SEARCH_LIMITS.chunkHits,
      excludeSessionId: options.excludeSessionId,
    });
  let matchMode: SearchReport["matchMode"] = "all";
  let hits: ChunkHit[] | undefined = find("all");
  if (!hits) throw new Error("Query contains no searchable terms.");
  if (hits.length === 0) {
    matchMode = "partial";
    hits = find("partial") ?? [];
  }
  const grouped = new Map<string, { best: ChunkHit; count: number }>();
  for (const hit of hits) {
    const group = grouped.get(hit.sessionId);
    if (!group) grouped.set(hit.sessionId, { best: hit, count: 1 });
    else group.count++;
  }
  const ranked: (Omit<SearchResult, "snippet"> & { readonly rowid: number })[] = [];
  for (const [sessionId, { best, count }] of grouped) {
    const session = store.session(sessionId);
    if (!session) continue;
    ranked.push({
      rowid: best.rowid,
      sessionId,
      title: sessionTitle(session),
      date: session.updatedAt.slice(0, 10),
      project: session.cwd,
      messageId: best.messageId,
      hits: count,
      score: rankScore(best.score, count, session, options.cwd, now),
    });
  }
  ranked.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const results = ranked.slice(0, limit).map(({ rowid, ...result }) => ({
    ...result,
    snippet: clip(store.snippet(options.query, matchMode, rowid), SEARCH_LIMITS.snippetChars),
  }));
  return { results, matchMode };
}
