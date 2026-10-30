import { isAbsolute, relative } from "node:path";
import type { HistoryStore, SessionRow } from "./store";

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

export type MatchMode = "all" | "any";

/**
 * Converts free text into a safe FTS5 expression. Quoted phrases stay phrases and every other
 * token is quoted, so user input never reaches FTS5 operator syntax.
 */
export function ftsQuery(input: string, mode: MatchMode): string | undefined {
  const terms: string[] = [];
  const phrase = /"([^"]+)"/g;
  for (const match of input.matchAll(phrase)) {
    const value = match[1]?.trim();
    if (value) terms.push(value);
  }
  for (const token of input.replace(phrase, " ").match(/[\p{L}\p{N}_][\p{L}\p{N}_.\-/]*/gu) ?? [])
    terms.push(token.replace(/[.\-/]+$/, ""));
  const quoted = [...new Set(terms.filter(Boolean))].map(
    (term) => `"${term.replaceAll('"', '""')}"`,
  );
  if (quoted.length === 0) return undefined;
  return quoted.join(mode === "all" ? " " : " OR ");
}

export function isRelatedProject(sessionCwd: string, cwd: string): boolean {
  if (!sessionCwd || !cwd) return false;
  const down = relative(cwd, sessionCwd);
  const up = relative(sessionCwd, cwd);
  const inside = (path: string) => path === "" || (!path.startsWith("..") && !isAbsolute(path));
  return inside(down) || inside(up);
}

export function rankScore(
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
  readonly matchMode: MatchMode;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1).trimEnd()}…`;
}

export function sessionTitle(session: SessionRow): string {
  return clip(session.title ?? session.firstUser ?? "(untitled session)", SEARCH_LIMITS.titleChars);
}

interface Hit {
  readonly sessionId: string;
  readonly messageId: string;
  readonly score: number;
  readonly snippet: string;
}

function chunkHits(store: HistoryStore, expression: string, excludeSessionId: string): Hit[] {
  return store.db
    .prepare(`
    SELECT c.session_id AS session_id, c.message_id AS message_id, bm25(chunks_fts) AS score,
      snippet(chunks_fts, 0, '«', '»', '…', 24) AS snippet
    FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
    WHERE chunks_fts MATCH ? AND c.session_id != ?
    ORDER BY score
    LIMIT ?
  `)
    .all(expression, excludeSessionId, SEARCH_LIMITS.chunkHits)
    .map((row) => ({
      sessionId: String(row.session_id),
      messageId: String(row.message_id),
      score: Number(row.score),
      snippet: String(row.snippet ?? ""),
    }));
}

export interface SearchOptions {
  readonly query: string;
  readonly cwd: string;
  readonly excludeSessionId: string;
  readonly limit?: number;
  readonly now?: number;
}

/** Ranks sessions by their best-matching chunk, boosted for recency and the current project. */
export function searchSessions(store: HistoryStore, options: SearchOptions): SearchReport {
  const limit = Math.min(
    Math.max(options.limit ?? SEARCH_LIMITS.defaultResults, 1),
    SEARCH_LIMITS.maxResults,
  );
  const now = options.now ?? Date.now();
  let matchMode: MatchMode = "all";
  const all = ftsQuery(options.query, "all");
  if (!all) throw new Error("Query contains no searchable terms.");
  let hits = chunkHits(store, all, options.excludeSessionId);
  const any = ftsQuery(options.query, "any");
  if (hits.length === 0 && any && any !== all) {
    matchMode = "any";
    hits = chunkHits(store, any, options.excludeSessionId);
  }
  const grouped = new Map<string, { best: Hit; count: number }>();
  for (const hit of hits) {
    const group = grouped.get(hit.sessionId);
    if (!group) grouped.set(hit.sessionId, { best: hit, count: 1 });
    else group.count++;
  }
  const results: SearchResult[] = [];
  for (const [sessionId, { best, count }] of grouped) {
    const session = store.session(sessionId);
    if (!session) continue;
    results.push({
      sessionId,
      title: sessionTitle(session),
      date: session.updatedAt.slice(0, 10),
      project: session.cwd,
      messageId: best.messageId,
      snippet: clip(best.snippet, SEARCH_LIMITS.snippetChars),
      hits: count,
      score: rankScore(best.score, count, session, options.cwd, now),
    });
  }
  results.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  return { results: results.slice(0, limit), matchMode };
}
