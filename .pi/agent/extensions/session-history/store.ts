import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { identifierLexemes } from "../../lib/lexical";
import { ftsExpression, type MatchMode } from "./fts-query";
import { loadSqlite } from "./sqlite";

export type { MatchMode };

/** Bump when parsing, chunking, or schema changes; a mismatch rebuilds the index. */
export const INDEX_FORMAT_VERSION = "3";
const BUSY_TIMEOUT_MS = 5_000;

export type ChunkRole = "user" | "assistant" | "tool" | "summary";

export interface ParsedChunk {
  readonly messageId: string;
  readonly role: ChunkRole;
  readonly timestamp: string;
  readonly text: string;
}

export interface SessionRow {
  readonly id: string;
  readonly path: string;
  readonly cwd: string;
  readonly title: string | null;
  readonly firstUser: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly size: number;
  readonly mtimeMs: number;
  readonly offset: number;
  readonly nextOrd: number;
}

export interface ChunkRow extends ParsedChunk {
  readonly rowid: number;
  readonly sessionId: string;
  readonly ord: number;
}

export interface ChunkHit {
  readonly rowid: number;
  readonly sessionId: string;
  readonly messageId: string;
  /** BM25 score; lower is better. */
  readonly score: number;
}

/** Lines parsed from one session file since the stored offset. */
export interface FileProgress {
  readonly header?: { readonly id: string; readonly cwd: string; readonly timestamp: string };
  readonly title?: string;
  readonly firstUser?: string;
  readonly updatedAt?: string;
  readonly chunks: readonly ParsedChunk[];
  readonly size: number;
  readonly mtimeMs: number;
  readonly offset: number;
}

export interface FindChunksOptions {
  readonly mode: MatchMode;
  readonly limit: number;
  /** Restrict to one session. */
  readonly sessionId?: string;
  /** Exclude one session, such as the calling session. */
  readonly excludeSessionId?: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  cwd TEXT NOT NULL,
  title TEXT,
  first_user TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  offset INTEGER NOT NULL,
  next_ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks(
  rowid INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ts TEXT NOT NULL,
  text TEXT NOT NULL,
  terms TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_session_ord ON chunks(session_id, ord);
CREATE INDEX IF NOT EXISTS chunks_session_message ON chunks(session_id, message_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, terms, content='chunks', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, terms) VALUES (new.rowid, new.text, new.terms);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, terms) VALUES ('delete', old.rowid, old.text, old.terms);
END;
`;

const DROP = `
DROP TRIGGER IF EXISTS chunks_ai;
DROP TRIGGER IF EXISTS chunks_ad;
DROP TABLE IF EXISTS chunks_fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS meta;
`;

// Ranking weights both FTS5 columns: whole tokens in `text` outrank split identifier parts in
// `terms` (weight 0.4), as recall's whole-identifier bonus does.
const FIND_CHUNKS = `
  SELECT c.rowid AS rowid, c.session_id AS session_id, c.message_id AS message_id,
    bm25(chunks_fts, 1.0, 0.4) AS score
  FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid
  WHERE chunks_fts MATCH ?`;

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function num(row: Row, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

function toSession(row: Row): SessionRow {
  return {
    id: text(row, "id"),
    path: text(row, "path"),
    cwd: text(row, "cwd"),
    title: nullableText(row, "title"),
    firstUser: nullableText(row, "first_user"),
    startedAt: text(row, "started_at"),
    updatedAt: text(row, "updated_at"),
    size: num(row, "size"),
    mtimeMs: num(row, "mtime_ms"),
    offset: num(row, "offset"),
    nextOrd: num(row, "next_ord"),
  };
}

function isRole(value: string): value is ChunkRole {
  return value === "user" || value === "assistant" || value === "tool" || value === "summary";
}

function toChunk(row: Row): ChunkRow {
  const role = text(row, "role");
  return {
    rowid: num(row, "rowid"),
    sessionId: text(row, "session_id"),
    ord: num(row, "ord"),
    messageId: text(row, "message_id"),
    role: isRole(role) ? role : "assistant",
    timestamp: text(row, "ts"),
    text: text(row, "text"),
  };
}

/**
 * The FTS5 tokenizer keeps `createBrowserRouter` as one token, so each multi-part identifier's
 * parts are indexed separately, one identifier per line, for searches on a single part.
 */
function identifierTerms(value: string): string {
  return identifierLexemes(value)
    .flatMap((lexeme) => (lexeme.compound === undefined ? [] : [lexeme.parts.join(" ")]))
    .join("\n");
}

/** The history index: schema, full-text queries, and transactional writes behind one interface. */
export class HistoryStore {
  private constructor(private readonly db: DatabaseSync) {}

  static async open(directory: string): Promise<HistoryStore> {
    const { DatabaseSync } = await loadSqlite();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const path = join(directory, "index.db");
    const db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL;`);
    const store = new HistoryStore(db);
    store.migrate();
    return store;
  }

  private migrate(): void {
    this.transaction(() => {
      this.db.exec(SCHEMA);
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'format'").get();
      if (row && text(row, "value") === INDEX_FORMAT_VERSION) return;
      this.db.exec(DROP);
      this.db.exec(SCHEMA);
      this.db
        .prepare("INSERT INTO meta(key, value) VALUES ('format', ?)")
        .run(INDEX_FORMAT_VERSION);
    });
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  /** BEGIN IMMEDIATE serializes writers across Pi processes that share the index. */
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  // Sessions

  session(id: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    return row ? toSession(row) : undefined;
  }

  sessionByPath(path: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE path = ?").get(path);
    return row ? toSession(row) : undefined;
  }

  sessionsByPrefix(prefix: string): SessionRow[] {
    const escaped = prefix.replace(/[\\%_]/g, (match) => `\\${match}`);
    return this.db
      .prepare("SELECT * FROM sessions WHERE id LIKE ? ESCAPE '\\' LIMIT 3")
      .all(`${escaped}%`)
      .map(toSession);
  }

  sessionPaths(): string[] {
    return this.db
      .prepare("SELECT path FROM sessions")
      .all()
      .map((row) => text(row, "path"));
  }

  // Full-text queries

  /**
   * Ranks chunks matching free-text `query`, best first. Returns undefined when the query has no
   * searchable terms.
   */
  findChunks(query: string, options: FindChunksOptions): ChunkHit[] | undefined {
    const expression = ftsExpression(query, options.mode);
    if (!expression) return undefined;
    const filter =
      options.sessionId !== undefined
        ? { sql: " AND c.session_id = ?", value: options.sessionId }
        : options.excludeSessionId !== undefined
          ? { sql: " AND c.session_id != ?", value: options.excludeSessionId }
          : undefined;
    const statement = this.db.prepare(`${FIND_CHUNKS}${filter?.sql ?? ""} ORDER BY score LIMIT ?`);
    const rows = filter
      ? statement.all(expression, filter.value, options.limit)
      : statement.all(expression, options.limit);
    return rows.map((row) => ({
      rowid: num(row, "rowid"),
      sessionId: text(row, "session_id"),
      messageId: text(row, "message_id"),
      score: num(row, "score"),
    }));
  }

  /** Highlighted excerpt of one matched chunk; computed per result because snippet() is costly. */
  snippet(query: string, mode: MatchMode, rowid: number): string {
    const expression = ftsExpression(query, mode);
    if (!expression) return "";
    const row = this.db
      .prepare(
        "SELECT snippet(chunks_fts, 0, '«', '»', '…', 24) AS snippet FROM chunks_fts WHERE chunks_fts MATCH ? AND rowid = ?",
      )
      .get(expression, rowid);
    return row ? text(row, "snippet") : "";
  }

  /** Chunks for the given rowids, in the given order. */
  chunks(rowids: readonly number[]): ChunkRow[] {
    const statement = this.db.prepare("SELECT * FROM chunks WHERE rowid = ?");
    return rowids.flatMap((rowid) => {
      const row = statement.get(rowid);
      return row ? [toChunk(row)] : [];
    });
  }

  /** The first chunks of a session in order. */
  sessionStart(sessionId: string, limit: number): ChunkRow[] {
    return this.db
      .prepare("SELECT * FROM chunks WHERE session_id = ? ORDER BY ord LIMIT ?")
      .all(sessionId, limit)
      .map(toChunk);
  }

  /**
   * Chunks of the `size` messages before and after `messageId`, in order. Returns undefined when
   * the message is not indexed in that session.
   */
  messageWindow(sessionId: string, messageId: string, size: number): ChunkRow[] | undefined {
    const messages = this.db
      .prepare(
        "SELECT message_id, MIN(ord) AS first, MAX(ord) AS last FROM chunks WHERE session_id = ? GROUP BY message_id ORDER BY first",
      )
      .all(sessionId);
    const index = messages.findIndex((row) => text(row, "message_id") === messageId);
    if (index === -1) return undefined;
    const first = messages[Math.max(0, index - size)];
    const last = messages[Math.min(messages.length - 1, index + size)];
    if (!first || !last) return [];
    return this.db
      .prepare("SELECT * FROM chunks WHERE session_id = ? AND ord BETWEEN ? AND ? ORDER BY ord")
      .all(sessionId, num(first, "first"), num(last, "last"))
      .map(toChunk);
  }

  // Writes

  removeSession(path: string): void {
    this.transaction(() => {
      const session = this.sessionByPath(path);
      if (!session) return;
      this.db.prepare("DELETE FROM chunks WHERE session_id = ?").run(session.id);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    });
  }

  /**
   * Applies parsed lines read from `startOffset`. Returns false without writing when another
   * writer already advanced the session, so concurrent reconciliations never duplicate chunks.
   */
  applyProgress(path: string, startOffset: number, progress: FileProgress): boolean {
    return this.transaction(() => {
      const existing = this.sessionByPath(path);
      if ((existing?.offset ?? 0) !== startOffset) return false;
      if (!existing && !progress.header) return false;
      const id = existing?.id ?? progress.header?.id ?? "";
      const startedAt = existing?.startedAt ?? progress.header?.timestamp ?? "";
      const updatedAt = progress.updatedAt ?? existing?.updatedAt ?? startedAt;
      let ord = existing?.nextOrd ?? 0;
      if (!existing) this.db.prepare("DELETE FROM chunks WHERE session_id = ?").run(id);
      const insert = this.db.prepare(
        "INSERT INTO chunks(session_id, ord, message_id, role, ts, text, terms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const chunk of progress.chunks)
        insert.run(
          id,
          ord++,
          chunk.messageId,
          chunk.role,
          chunk.timestamp,
          chunk.text,
          identifierTerms(chunk.text),
        );
      this.db
        .prepare(`
        INSERT INTO sessions(id, path, cwd, title, first_user, started_at, updated_at, size, mtime_ms, offset, next_ord)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          path = excluded.path, title = excluded.title, first_user = excluded.first_user,
          updated_at = excluded.updated_at, size = excluded.size, mtime_ms = excluded.mtime_ms,
          offset = excluded.offset, next_ord = excluded.next_ord
      `)
        .run(
          id,
          path,
          existing?.cwd ?? progress.header?.cwd ?? "",
          progress.title ?? existing?.title ?? null,
          existing?.firstUser ?? progress.firstUser ?? null,
          startedAt,
          updatedAt,
          progress.size,
          progress.mtimeMs,
          progress.offset,
          ord,
        );
      return true;
    });
  }
}
