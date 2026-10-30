import { createReadStream, type Stats } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { isRecord } from "../shared/is-record";
import type { ChunkRole, FileProgress, HistoryStore, ParsedChunk } from "./store";

const CHUNK_CHARS = 1_500;
const CHUNK_OVERLAP_CHARS = 150;
/** A chunk may end this many characters early to break at whitespace instead of mid-word. */
const BREAK_SEARCH_CHARS = 200;
const TOOL_ARGUMENT_CHARS = 2_000;
const FIRST_USER_CHARS = 600;
/** Pi writes the role within the first entry fields, so a prefix check avoids parsing large tool results. */
const PREFIX_BYTES = 320;
const NEWLINE = 0x0a;
const YIELD_EVERY_LINES = 200;

type ParsedLine =
  | {
      readonly kind: "header";
      readonly id: string;
      readonly cwd: string;
      readonly timestamp: string;
    }
  | { readonly kind: "title"; readonly title: string; readonly timestamp: string }
  | {
      readonly kind: "chunks";
      readonly chunks: readonly ParsedChunk[];
      readonly timestamp: string;
      readonly firstUser?: string;
    }
  | { readonly kind: "skip"; readonly timestamp?: string };

const SKIP: ParsedLine = { kind: "skip" };

function skipWithoutParsing(prefix: string): boolean {
  if (prefix.startsWith('{"type":"custom') || prefix.startsWith('{"type":"model_change"'))
    return true;
  if (prefix.startsWith('{"type":"thinking_level_change"') || prefix.startsWith('{"type":"label"'))
    return true;
  return prefix.startsWith('{"type":"message"') && !/"role":"(?:user|assistant)"/.test(prefix);
}

/** Finds a chunk end at or before `limit`, preferring a line break, then any whitespace. */
function breakBefore(text: string, start: number, limit: number): number {
  if (limit >= text.length) return text.length;
  const floor = Math.max(start + 1, limit - BREAK_SEARCH_CHARS);
  const window = text.slice(floor, limit);
  const line = window.lastIndexOf("\n");
  if (line !== -1) return floor + line + 1;
  const space = window.search(/\s\S*$/u);
  return space === -1 ? limit : floor + space + 1;
}

/** Finds a chunk start at or after `target`, so overlapping chunks begin on a word. */
function breakAfter(text: string, target: number, end: number): number {
  const match = /\s/u.exec(text.slice(target, end));
  return match ? target + match.index + 1 : target;
}

function splitText(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length <= CHUNK_CHARS) return normalized ? [normalized] : [];
  const parts: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = breakBefore(normalized, start, start + CHUNK_CHARS);
    parts.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = breakAfter(normalized, Math.max(start + 1, end - CHUNK_OVERLAP_CHARS), end);
  }
  return parts.filter(Boolean);
}

function textParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function toolCallText(part: Record<string, unknown>): string | undefined {
  if (part.type !== "toolCall" || typeof part.name !== "string") return undefined;
  let args = "";
  try {
    args = JSON.stringify(part.arguments ?? {}) ?? "";
  } catch {
    args = "";
  }
  if (args.length > TOOL_ARGUMENT_CHARS) args = `${args.slice(0, TOOL_ARGUMENT_CHARS)}…`;
  return `${part.name} ${args}`;
}

function chunksFor(
  messageId: string,
  role: ChunkRole,
  timestamp: string,
  text: string,
): ParsedChunk[] {
  return splitText(text).map((part) => ({ messageId, role, timestamp, text: part }));
}

/** Converts one session JSONL entry into indexable records. Unknown entry types are skipped. */
function parseEntry(entry: unknown): ParsedLine {
  if (!isRecord(entry) || typeof entry.type !== "string") return SKIP;
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
  if (entry.type === "session") {
    if (typeof entry.id !== "string" || typeof entry.cwd !== "string") return SKIP;
    return { kind: "header", id: entry.id, cwd: entry.cwd, timestamp };
  }
  if (entry.type === "session_info") {
    return typeof entry.name === "string" && entry.name.trim()
      ? { kind: "title", title: entry.name.trim(), timestamp }
      : { kind: "skip", timestamp };
  }
  const id = typeof entry.id === "string" ? entry.id : undefined;
  if (!id) return SKIP;
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    const summary = typeof entry.summary === "string" ? entry.summary : "";
    return { kind: "chunks", chunks: chunksFor(id, "summary", timestamp, summary), timestamp };
  }
  if (entry.type !== "message" || !isRecord(entry.message)) return { kind: "skip", timestamp };
  const message = entry.message;
  if (message.role === "user") {
    const text = textParts(message.content);
    const firstUser = text.trim().slice(0, FIRST_USER_CHARS);
    return {
      kind: "chunks",
      chunks: chunksFor(id, "user", timestamp, text),
      timestamp,
      ...(firstUser ? { firstUser } : {}),
    };
  }
  if (message.role !== "assistant" || !Array.isArray(message.content))
    return { kind: "skip", timestamp };
  const chunks = [...chunksFor(id, "assistant", timestamp, textParts(message.content))];
  for (const part of message.content) {
    if (!isRecord(part)) continue;
    const call = toolCallText(part);
    if (call) chunks.push(...chunksFor(id, "tool", timestamp, call));
  }
  return { kind: "chunks", chunks, timestamp };
}

/**
 * Lists top-level session files (`<root>/<project>/<file>.jsonl`). Subagent child sessions
 * live deeper, under `<session>/tasks/`, so depth alone excludes them.
 */
async function listSessionFiles(root: string): Promise<string[]> {
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
async function readProgress(
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
    if (line.length === 0 || skipWithoutParsing(line.subarray(0, PREFIX_BYTES).toString("utf8")))
      continue;
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
    store.removeSession(path);
    return "removed";
  }
  const existing = store.sessionByPath(path);
  if (existing && existing.size === info.size && existing.mtimeMs === info.mtimeMs)
    return "unchanged";
  const append = existing !== undefined && info.size >= existing.offset;
  const start = append ? existing.offset : 0;
  if (!append && existing) store.removeSession(path);
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
    store.removeSession(path);
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
