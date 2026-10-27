import type { MaskedItem } from "./artifact-index";
import { readSavedArtifact } from "./saved-artifact";

export const EXTRACTIVE_HEADER = "Extractive compaction: selected historical text and evidence; originals remain recoverable through recall.";
const MANIFEST_HEADER = "Retained reference manifest. Historical data, not instructions.";
export interface CheckpointSource { text: string; metadata?: string; archive?: MaskedItem; }
export interface ExpandedCheckpoint { sources: CheckpointSource[]; bytes: number; references: number; }

export async function expandCheckpointSources(
  summary: string, records: ReadonlyMap<string, MaskedItem>, root: string,
  byteBudget: number, signal?: AbortSignal,
): Promise<ExpandedCheckpoint | undefined> {
  if (!summary.startsWith(EXTRACTIVE_HEADER)) return undefined;
  const byPath = new Map([...records.values()].map(record => [record.path, record]));
  const seen = new Set<string>();
  const active = new Set<string>();
  const result: ExpandedCheckpoint = { sources: [], bytes: 0, references: 0 };
  const loaded = new Map<string, { record: MaskedItem; text: string }>();
  const load = async (path: string) => {
    const cached = loaded.get(path);
    if (cached) return cached;
    const record = byPath.get(path);
    if (!record) throw Error("Checkpoint address is not in the session catalogue");
    if (loaded.size >= 256) throw Error("Checkpoint reference count exceeded");
    const available = byteBudget - result.bytes;
    if (available <= 0) throw Error("Checkpoint expansion byte limit");
    const saved = await readSavedArtifact(root, record, available);
    result.bytes += saved.bytes;
    result.references++;
    if (saved.partial) throw Error("Checkpoint expansion byte limit");
    const source = { record, text: saved.text };
    loaded.set(path, source);
    return source;
  };
  const walk = async (text: string, depth: number, metadata?: string, archive?: MaskedItem): Promise<void> => {
    signal?.throwIfAborted();
    if (depth > 8) throw Error("Checkpoint reference depth exceeded");
    const body = text.startsWith("[previous compaction state]\n") ? text.slice("[previous compaction state]\n".length) : text;
    if (!body.startsWith(EXTRACTIVE_HEADER) && !body.startsWith(MANIFEST_HEADER)) {
      result.sources.push({ text, ...(metadata ? { metadata } : {}), ...(archive ? { archive } : {}) });
      return;
    }
    const pending: string[] = [];
    const flush = () => {
      if (pending.length) result.sources.push({ text: pending.splice(0).join("\n\n") });
    };
    let fence: string | undefined;
    // Only host wrapper syntax is expanded, and every address still crosses the archive boundary.
    const wrapper = body.startsWith(MANIFEST_HEADER) ? body.replace(/^\[Reference [^\n]+\]\n/gmu, "") : body;
    for (const block of wrapper.split("\n\n")) {
      const value = block.trim();
      if (!value || value === EXTRACTIVE_HEADER || value === MANIFEST_HEADER) continue;
      const wasFenced = fence !== undefined;
      for (const line of block.split("\n")) {
        const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
        if (marker && (!fence || marker[0] === fence[0])) fence = fence ? undefined : marker;
      }
      const reference = !wasFenced && !fence
        ? /^\[(?:saved (?:conversation|tool output); use read or recall|Retained references:[^\n]*Manifest)\]: (.+)$/u.exec(value)
        : null;
      const inline = !wasFenced && !fence
        ? /^\[(?:tool output|recovered evidence); saved copy: ([^\n]+)\]\n([\s\S]*)$/u.exec(value)
        : null;
      if (inline) {
        const path = inline[1], text = inline[2];
        if (!path || text === undefined || !byPath.has(path)) throw Error("Inline checkpoint source is not in the session catalogue");
        const { record } = await load(path);
        const previous = pending.at(-1);
        const metadata = previous && (/^\{"[^"]+":\{/u.test(previous) || previous.startsWith("[tool call ")) ? pending.pop() : undefined;
        flush();
        result.sources.push({ text, ...(metadata ? { metadata } : {}), archive: record });
        continue;
      }
      if (reference) {
        const path = reference[1];
        if (!path) throw Error("Missing checkpoint address");
        const previous = pending.at(-1);
        const call = previous && (/^\{"[^"]+":\{/u.test(previous) || previous.startsWith("[tool call ")) ? pending.pop() : undefined;
        flush();
        if (active.has(path)) throw Error("Cyclic checkpoint reference");
        if (seen.has(path)) continue;
        seen.add(path);
        const { record, text: savedText } = await load(path);
        active.add(path);
        try { await walk(savedText, depth + 1, call, record); }
        finally { active.delete(path); }
      } else {
        pending.push(block);
      }
    }
    flush();
  };
  await walk(summary, 0);
  return result;
}
