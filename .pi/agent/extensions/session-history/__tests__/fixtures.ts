import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureEntry {
  readonly [key: string]: unknown;
}

let counter = 0;

function nextId(): string {
  counter++;
  return counter.toString(16).padStart(8, "0");
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function header(
  id: string,
  cwd: string,
  timestamp = "2026-10-01T10:00:00.000Z",
): FixtureEntry {
  return { type: "session", version: 3, id, timestamp, cwd };
}

export function user(
  text: string,
  id = nextId(),
  timestamp = "2026-10-01T10:01:00.000Z",
): FixtureEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

export function assistant(
  parts: readonly Record<string, unknown>[],
  id = nextId(),
  timestamp = "2026-10-01T10:02:00.000Z",
): FixtureEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: { role: "assistant", content: parts },
  };
}

export function toolResult(text: string, id = nextId()): FixtureEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "2026-10-01T10:03:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: "call",
      toolName: "bash",
      content: [{ type: "text", text }],
    },
  };
}

export function title(name: string): FixtureEntry {
  return {
    type: "session_info",
    id: nextId(),
    parentId: null,
    timestamp: "2026-10-01T10:04:00.000Z",
    name,
  };
}

export function compaction(summary: string, id = nextId()): FixtureEntry {
  return { type: "compaction", id, parentId: null, timestamp: "2026-10-01T10:05:00.000Z", summary };
}

export function jsonl(entries: readonly FixtureEntry[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

/** Writes `<root>/<project>/<name>.jsonl`, the layout Pi uses for top-level sessions. */
export function writeSession(
  root: string,
  project: string,
  name: string,
  entries: readonly FixtureEntry[],
): string {
  const directory = join(root, project);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${name}.jsonl`);
  writeFileSync(path, jsonl(entries));
  return path;
}

export function appendEntries(path: string, entries: readonly FixtureEntry[]): void {
  appendFileSync(path, jsonl(entries));
}
