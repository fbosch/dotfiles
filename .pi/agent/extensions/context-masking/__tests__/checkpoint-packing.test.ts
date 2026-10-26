import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packCheckpoint, type CheckpointPart } from "../checkpoint-packing";
import { MAX_IMAGE_BYTES } from "../image-artifact";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "checkpoint-packing-"));
  roots.push(root);
  return { root, sessionId: "packing-session" };
}
const parts: CheckpointPart[] = [
  { text: "Keep this constraint inline: preserve æøå." },
  ...Array.from({ length: 115 }, (_, i) => ({ reference: `r${i}`, text: `[tool call read] {"path":"source-${i}.txt"}\n[saved tool output]: /saved/original-${i}.txt` })),
  { text: "Continue the current task." },
];

test("packing preserves inline content, reference order and original call metadata", async () => {
  const f = await fixture();
  const result = await packCheckpoint(parts, 600, f.root, f.sessionId);
  expect(result.fits).toBe(true);
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(600);
  expect(result.unpackedBytes).toBeGreaterThan(600);
  expect(result.text).toContain(parts[0]?.text ?? "");
  expect(result.text).toContain(parts.at(-1)?.text ?? "");
  const manifest = result.savedItems[0];
  if (!manifest || manifest.text === undefined) throw Error("Missing reference manifest");
  const text = await readFile(manifest.path, "utf8");
  expect(text).toBe(manifest.text);
  let previous = -1;
  for (const part of parts.filter(part => part.reference !== undefined)) {
    const position = text.indexOf(part.text);
    expect(position).toBeGreaterThan(previous);
    previous = position;
  }
  expect((await stat(manifest.path)).mode & 0o777).toBe(0o600);
  expect((await stat(join(f.root, f.sessionId))).mode & 0o777).toBe(0o700);
  const again = await packCheckpoint(parts, 600, f.root, f.sessionId);
  expect(again.savedItems[0]?.path).toBe(manifest.path);
  expect(again.text).toBe(result.text);
});

test("fitting checkpoints retain their exact rendering without an archive", async () => {
  const f = await fixture();
  const result = await packCheckpoint(parts.slice(0, 2), 4000, f.root, f.sessionId);
  expect(result.fits).toBe(true);
  expect(result.text).toBe(parts.slice(0, 2).map(part => part.text).join("\n\n"));
  expect(result.savedItems).toEqual([]);
  expect(await readdir(f.root)).toEqual([]);
});

test("inline evidence cannot be demoted even when it contains reference-like markers", async () => {
  const f = await fixture();
  const inline = "Required æøå. [saved result]: /historical/data\n".repeat(40);
  const input = [{ text: inline }, ...parts.slice(1, 2)];
  const result = await packCheckpoint(input, 600, f.root, f.sessionId);
  expect(result.fits).toBe(false);
  expect(result.text).toBe(input.map(part => part.text).join("\n\n"));
  expect(result.savedItems).toEqual([]);
  expect(await readdir(f.root)).toEqual([]);
});

test("reused manifest paths reject symlinks and leave other files unchanged", async () => {
  const f = await fixture();
  const result = await packCheckpoint(parts, 600, f.root, f.sessionId);
  const path = result.savedItems[0]?.path;
  if (!path) throw Error("Missing manifest path");
  const outside = join(f.root, "private.txt");
  await writeFile(outside, "private external data");
  await unlink(path);
  await symlink(outside, path);
  await expect(packCheckpoint(parts, 600, f.root, f.sessionId)).rejects.toThrow();
  expect(await readFile(outside, "utf8")).toBe("private external data");
});

test("cancellation and archive-size bounds reject before creating manifest files", async () => {
  const f = await fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(packCheckpoint(parts, 600, f.root, f.sessionId, controller.signal)).rejects.toThrow();
  await expect(packCheckpoint([{ reference: "r0", text: "x".repeat(MAX_IMAGE_BYTES + 1) }], 600, f.root, f.sessionId)).rejects.toThrow("archive limit");
  expect(await readdir(f.root)).toEqual([]);
});
