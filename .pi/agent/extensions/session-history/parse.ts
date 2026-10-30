import { isRecord } from "../shared/is-record";

export const CHUNK_CHARS = 1_500;
const CHUNK_OVERLAP_CHARS = 150;
const TOOL_ARGUMENT_CHARS = 2_000;
const FIRST_USER_CHARS = 600;
/** Pi writes the role within the first entry fields, so a prefix check avoids parsing large tool results. */
const PREFIX_BYTES = 320;

export type ChunkRole = "user" | "assistant" | "tool" | "summary";

export interface ParsedChunk {
  readonly messageId: string;
  readonly role: ChunkRole;
  readonly timestamp: string;
  readonly text: string;
}

export type ParsedLine =
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

/** Returns true when a JSONL line can be skipped without parsing it. */
export function skipWithoutParsing(prefix: string): boolean {
  if (prefix.startsWith('{"type":"custom') || prefix.startsWith('{"type":"model_change"'))
    return true;
  if (prefix.startsWith('{"type":"thinking_level_change"') || prefix.startsWith('{"type":"label"'))
    return true;
  return prefix.startsWith('{"type":"message"') && !/"role":"(?:user|assistant)"/.test(prefix);
}

export function linePrefix(line: Buffer): string {
  return line.subarray(0, PREFIX_BYTES).toString("utf8");
}

export function splitText(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length <= CHUNK_CHARS) return normalized ? [normalized] : [];
  const parts: string[] = [];
  for (let start = 0; start < normalized.length; start += CHUNK_CHARS - CHUNK_OVERLAP_CHARS) {
    parts.push(normalized.slice(start, start + CHUNK_CHARS));
    if (start + CHUNK_CHARS >= normalized.length) break;
  }
  return parts;
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
export function parseEntry(entry: unknown): ParsedLine {
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
