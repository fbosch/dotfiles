import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST_HEADER, parseReferenceManifest } from "../checkpoint-format";
import { packCheckpoint } from "../checkpoint-packing";
import { EXTRACTIVE_HEADER, expandCheckpointSources } from "../checkpoint-sources";
import { type MaskedItem, saveConversationArtifact } from "../evidence-archive";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(limit: number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "checkpoint-format-")));
  roots.push(root);
  const leaf = {
    ...(await saveConversationArtifact(
      root,
      "session",
      "Approved value: æøå.\nOriginal evidence.",
    )),
    text: "Approved value: æøå.\nOriginal evidence.",
  };
  const call = `[tool call codemode] ${JSON.stringify({ code: `// ${"preserve exact æøå ".repeat(100)}\nreturn tools.read({path:"fixture.txt"});` })}`;
  const packed = await packCheckpoint(
    [
      { text: EXTRACTIVE_HEADER },
      { reference: "r0", text: call, summary: "read fixture.txt" },
      { reference: "r0", text: `[saved conversation; use read or recall]: ${leaf.path}` },
    ],
    limit,
    root,
    "session",
  );
  const records = new Map<string, MaskedItem>(
    [leaf, ...packed.savedItems].map((record) => [record.entryId, record]),
  );
  return { root, leaf, call, packed, records };
}

for (const limit of [450, 10000]) {
  test(`compact references recover exact call arguments and evidence at a ${limit}-byte budget`, async () => {
    const f = await fixture(limit);
    expect(f.packed.fits).toBe(true);
    const result = await expandCheckpointSources(f.packed.text, f.records, f.root, {
      windowBytes: 20000,
      totalBytes: 20000,
    });
    expect(result?.sources).toEqual([
      { text: f.leaf.text, metadata: f.call, archive: f.leaf, referenceOnly: true },
    ]);
    const args = f.packed.savedItems.find((record) => record.toolName === "compaction:calls");
    if (!args?.text) throw Error("Missing exact arguments");
    expect(args.text).toBe(`${f.call}\n`);
    const manifest = f.packed.savedItems.find(
      (record) => record.toolName === "compaction:references",
    );
    if (manifest?.text) {
      expect(parseReferenceManifest(manifest.text)?.root).toBe(join(f.root, "session"));
      expect(manifest.text).toContain("Calls: ");
      expect(manifest.text).toContain("[r0 @1]");
    }
  });
}

test("manifest roots and original argument archives remain validated boundaries", async () => {
  const f = await fixture(450);
  const manifest = f.packed.savedItems.find(
    (record) => record.toolName === "compaction:references",
  );
  if (!manifest?.text) throw Error("Missing manifest");
  const badText = manifest.text.replace(`Root: ${join(f.root, "session")}`, "Root: /etc");
  const bad = { ...(await saveConversationArtifact(f.root, "session", badText)), text: badText };
  f.records.set(bad.entryId, bad);
  await expect(
    expandCheckpointSources(
      `${EXTRACTIVE_HEADER}\n\n[Retained references: 1 groups. Manifest]: ${bad.path}`,
      f.records,
      f.root,
      { windowBytes: 20000, totalBytes: 20000 },
    ),
  ).rejects.toThrow("root");
  const args = f.packed.savedItems.find((record) => record.toolName === "compaction:calls");
  if (!args) throw Error("Missing call arguments");
  await writeFile(args.path, '["changed"]');
  await expect(
    expandCheckpointSources(f.packed.text, f.records, f.root, {
      windowBytes: 20000,
      totalBytes: 20000,
    }),
  ).rejects.toThrow("changed");
});

test("persisted manifests retain original call metadata and ordering", () => {
  const text =
    MANIFEST_HEADER +
    '\n\n[Reference r0; checkpoint position 1]\n[tool call read] {"path":"æøå.txt"}\n\n[Reference r0; checkpoint position 2]\n[saved tool output; use read or recall]: /archive/original.txt\n';
  expect(parseReferenceManifest(text)?.parts).toEqual([
    { reference: "r0", text: '[tool call read] {"path":"æøå.txt"}' },
    { reference: "r0", text: "[saved tool output; use read or recall]: /archive/original.txt" },
  ]);
});
