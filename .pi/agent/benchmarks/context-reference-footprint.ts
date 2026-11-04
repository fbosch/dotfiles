import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { parseReferenceManifest } from "../extensions/context-masking/checkpoint-format";
import { manifestPointer, packCheckpoint } from "../extensions/context-masking/checkpoint-packing";
import {
  EXTRACTIVE_HEADER,
  expandCheckpointSources,
} from "../extensions/context-masking/checkpoint-sources";
import { savedItems } from "../extensions/context-masking/evidence-archive";
import { recallSaved, recallSavedBatch } from "../extensions/context-masking/recall";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const Input = P.array({ sourcePath: P.string, sessionFile: P.optional(P.string) });

async function main() {
  const inputPath = process.argv[2],
    output = process.argv[3];
  if (!inputPath || !output) throw Error("Pass input JSON and a fresh private output directory");
  let input: unknown;
  try {
    input = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (cause) {
    throw Error("Cannot parse footprint input JSON", { cause });
  }
  if (!isMatching(Input, input)) throw Error("Invalid footprint inputs");
  let probes: unknown = [];
  if (process.argv[4]) {
    try { probes = JSON.parse(await readFile(process.argv[4], "utf8")); }
    catch (cause) { throw Error("Cannot parse recorded probes", { cause }); }
  }
  if (!isMatching(P.array({ id: P.string, sessionFile: P.string, question: P.string, expected: P.string }), probes))
    throw Error("Invalid recorded probes");
  await mkdir(output, { recursive: false, mode: 0o700 });
  const rows = [];
  for (const [index, item] of input.entries()) {
    const path = resolve(item.sourcePath);
    const original = await readFile(path, "utf8");
    const parsed = parseReferenceManifest(original);
    if (!parsed || parsed.root) throw Error("Expected an original retained reference manifest");
    if (basename(path) !== `${hash(original)}.txt`)
      throw Error("Original manifest digest does not match its address");
    const root = dirname(dirname(path)),
      sessionId = basename(dirname(path));
    const packed = await packCheckpoint(
      [{ text: EXTRACTIVE_HEADER }, ...parsed.parts],
      400,
      root,
      sessionId,
    );
    if (!packed.fits) throw Error("Packed checkpoint did not fit its budget");
    const manifest = packed.savedItems.find(
      (record) => record.toolName === "compaction:references",
    );
    if (!manifest?.text) throw Error("Missing compacted manifest");
    const compactText = manifest.text;
    let archivedCalls: unknown = [];
    const calls = packed.savedItems.find((record) => record.toolName === "compaction:calls");
    if (calls?.text) {
      try {
        archivedCalls = JSON.parse(await readFile(calls.path, "utf8"));
      } catch (cause) {
        throw Error("Cannot recover exact archived calls", { cause });
      }
    }
    if (!isMatching(P.array(P.string), archivedCalls)) throw Error("Invalid exact call archive");
    const originals = parsed.parts.filter((part) => part.text.startsWith("[tool call codemode] "));
    const exactCalls = originals.every(
      (part) => archivedCalls.includes(part.text) || compactText.includes(part.text),
    );
    if (!exactCalls) throw Error("Original call metadata was lost");
    const recall: Array<{ id: string; hit3: boolean; batchHit: boolean }> = [];
    let replay: { verified: boolean; sources?: number; sha256?: string } = { verified: false };
    if (item.sessionFile) {
      const manager = SessionManager.open(item.sessionFile);
      const records = savedItems(manager.getBranch());
      const before = await expandCheckpointSources(
        `${EXTRACTIVE_HEADER}\n\n${manifestPointer(1, path)}`,
        records,
        root,
        { windowBytes: 4_000_000, totalBytes: 4_000_000 },
      );
      for (const record of packed.savedItems) records.set(record.entryId, record);
      const after = await expandCheckpointSources(packed.text, records, root, {
        windowBytes: 4_000_000,
        totalBytes: 4_000_000,
      });
      const project = (value: typeof before) =>
        value?.sources.map((source) => ({
          text: source.text,
          metadata: source.metadata,
          archive: source.archive?.path,
          referenceOnly: source.referenceOnly,
        }));
      const oldValue = JSON.stringify(project(before)),
        newValue = JSON.stringify(project(after));
      if (oldValue !== newValue) throw Error(`Evidence replay changed for ${path}`);
      replay = {
        verified: true,
        sources: after?.sources.length ?? 0,
        sha256: hash(newValue ?? ""),
      };
      const originalBranch = manager.getBranch();
      const branch = [...originalBranch, { type: "custom", id: `footprint-overlay-${index}`,
        parentId: originalBranch.at(-1)?.id ?? null, timestamp: new Date().toISOString(),
        customType: "context-masking", data: { items: packed.savedItems } } satisfies SessionEntry];
      const matching = probes.filter(probe => probe.sessionFile === item.sessionFile);
      for (let offset = 0; offset < matching.length; offset += 8) {
        const group = matching.slice(offset, offset + 8);
        const batch = await recallSavedBatch(branch, root, group.map(probe => probe.question), 3);
        for (const [queryIndex, probe] of group.entries()) {
          const single = await recallSaved(branch, root, probe.question, 3);
          recall.push({ id: probe.id, hit3: single.passages.some(p => p.text.includes(probe.expected)),
            batchHit: batch.queries[queryIndex]?.passages.some(p => p.text.includes(probe.expected)) ?? false });
        }
      }
    }
    if (hash(await readFile(path, "utf8")) !== hash(original))
      throw Error("Original manifest changed");
    await writeFile(
      join(output, `sample-${index}.json`),
      JSON.stringify(
        { source: path, original: original.split("\n"), compact: manifest.text.split("\n") },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    rows.push({
      source: path,
      originalSha256: hash(original),
      compactPath: manifest.path,
      originalBytes: Buffer.byteLength(original),
      compactBytes: Buffer.byteLength(manifest.text),
      originalCallCount: originals.length,
      recall,
      exactCallsVerified: exactCalls,
      replay,
    });
  }
  await writeFile(join(output, "results.json"), `${JSON.stringify({ rows }, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      rows.map((row) => ({
        source: basename(row.source),
        originalBytes: row.originalBytes,
        compactBytes: row.compactBytes,
        originalCallCount: row.originalCallCount,
        exactCallsVerified: row.exactCallsVerified,
        replay: row.replay,
        recall: row.recall,
      })),
    ),
  );
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
