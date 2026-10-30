import { createReadStream, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { linePrefix, type ParsedChunk, parseEntry, skipWithoutParsing } from "./parse";
import type { FileProgress, HistoryStore } from "./store";

const NEWLINE = 0x0a;
const YIELD_EVERY_LINES = 200;

/**
 * Lists top-level session files (`<root>/<project>/<file>.jsonl`). Subagent child sessions
 * live deeper, under `<session>/tasks/`, so depth alone excludes them.
 */
export async function listSessionFiles(root: string): Promise<string[]> {
  let projects: string[];
  try {
    projects = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const project of projects) {
    try {
      for (const entry of await readdir(project, { withFileTypes: true }))
        if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(join(project, entry.name));
    } catch {
      // A project directory removed during discovery has no sessions to index.
    }
  }
  return files.sort();
}

async function* completeLines(path: string, start: number, end: number): AsyncGenerator<Buffer> {
  if (end <= start) return;
  let pending: Buffer[] = [];
  for await (const data of createReadStream(path, { start, end: end - 1 })) {
    const buffer = typeof data === "string" ? Buffer.from(data) : data;
    let lineStart = 0;
    let newline = buffer.indexOf(NEWLINE, lineStart);
    while (newline !== -1) {
      const piece = buffer.subarray(lineStart, newline);
      yield pending.length === 0 ? piece : Buffer.concat([...pending, piece]);
      pending = [];
      lineStart = newline + 1;
      newline = buffer.indexOf(NEWLINE, lineStart);
    }
    if (lineStart < buffer.length) pending.push(buffer.subarray(lineStart));
  }
}

/**
 * Parses complete lines appended since `start`. A trailing line without a newline is left for a
 * later sync because Pi may still be writing it.
 */
export async function readProgress(
  path: string,
  start: number,
  size: number,
  mtimeMs: number,
  signal?: AbortSignal,
): Promise<FileProgress> {
  let offset = start;
  let header: FileProgress["header"];
  let title: string | undefined;
  let firstUser: string | undefined;
  let updatedAt: string | undefined;
  const chunks: ParsedChunk[] = [];
  let count = 0;
  for await (const line of completeLines(path, start, size)) {
    offset += line.length + 1;
    if (++count % YIELD_EVERY_LINES === 0) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
    }
    if (line.length === 0 || skipWithoutParsing(linePrefix(line))) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line.toString("utf8"));
    } catch {
      continue;
    }
    const parsed = parseEntry(entry);
    if (parsed.kind === "header") {
      header ??= { id: parsed.id, cwd: parsed.cwd, timestamp: parsed.timestamp };
      updatedAt = parsed.timestamp || updatedAt;
    } else if (parsed.kind === "title") {
      title = parsed.title;
      updatedAt = parsed.timestamp || updatedAt;
    } else if (parsed.kind === "chunks") {
      chunks.push(...parsed.chunks);
      firstUser ??= parsed.firstUser;
      updatedAt = parsed.timestamp || updatedAt;
    } else if (parsed.timestamp) {
      updatedAt = parsed.timestamp;
    }
  }
  return {
    ...(header ? { header } : {}),
    ...(title === undefined ? {} : { title }),
    ...(firstUser === undefined ? {} : { firstUser }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    chunks,
    size,
    mtimeMs,
    offset,
  };
}

export type SyncOutcome = "unchanged" | "appended" | "reindexed" | "removed" | "skipped";

/** Brings one session file's index rows up to date, appending when the file only grew. */
export async function syncFile(
  store: HistoryStore,
  path: string,
  signal?: AbortSignal,
): Promise<SyncOutcome> {
  let info: Stats;
  try {
    info = await stat(path);
  } catch {
    store.transaction(() => store.removeSessionByPath(path));
    return "removed";
  }
  const existing = store.sessionByPath(path);
  if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs)
    return "unchanged";
  const append = existing !== undefined && info.size >= existing.offset;
  const start = append ? existing.offset : 0;
  if (!append && existing) store.transaction(() => store.removeSessionByPath(path));
  const progress = await readProgress(path, start, info.size, info.mtimeMs, signal);
  signal?.throwIfAborted();
  if (!store.applyProgress(path, start, progress)) return "skipped";
  return append ? "appended" : "reindexed";
}

export interface ReconcileReport {
  readonly files: number;
  readonly changed: number;
  readonly removed: number;
}

/** Reconciles the index with the session tree: indexes changed files and drops deleted ones. */
export async function reconcile(
  store: HistoryStore,
  root: string,
  signal?: AbortSignal,
): Promise<ReconcileReport> {
  const files = await listSessionFiles(root);
  const present = new Set(files);
  let changed = 0;
  let removed = 0;
  for (const path of store.sessionPaths()) {
    if (present.has(path)) continue;
    store.transaction(() => store.removeSessionByPath(path));
    removed++;
  }
  for (const path of files) {
    signal?.throwIfAborted();
    const outcome = await syncFile(store, path, signal);
    if (outcome === "appended" || outcome === "reindexed") changed++;
    await yieldToEventLoop();
  }
  return { files: files.length, changed, removed };
}
