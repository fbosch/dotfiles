import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ChunkRole, ParsedChunk } from "./parse";
import { loadSqlite } from "./sqlite";

/** Bump when parsing or schema changes; a mismatch rebuilds the index from the session files. */
export const INDEX_FORMAT_VERSION = "1";
const BUSY_TIMEOUT_MS = 5_000;

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

export interface ChunkRow {
  readonly rowid: number;
  readonly sessionId: string;
  readonly ord: number;
  readonly messageId: string;
  readonly role: ChunkRole;
  readonly timestamp: string;
  readonly text: string;
}

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
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_session_ord ON chunks(session_id, ord);
CREATE INDEX IF NOT EXISTS chunks_session_message ON chunks(session_id, message_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='rowid', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
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

export function toChunk(row: Row): ChunkRow {
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

export class HistoryStore {
  private constructor(readonly db: DatabaseSync) {}

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
  transaction<T>(work: () => T): T {
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

  sessionByPath(path: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE path = ?").get(path);
    return row ? toSession(row) : undefined;
  }

  session(id: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
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

  removeSessionByPath(path: string): void {
    const session = this.sessionByPath(path);
    if (!session) return;
    this.db.prepare("DELETE FROM chunks WHERE session_id = ?").run(session.id);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
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
        "INSERT INTO chunks(session_id, ord, message_id, role, ts, text) VALUES (?, ?, ?, ?, ?, ?)",
      );
      for (const chunk of progress.chunks)
        insert.run(id, ord++, chunk.messageId, chunk.role, chunk.timestamp, chunk.text);
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
