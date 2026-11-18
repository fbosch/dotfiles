import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifierImage, readImageArtifact, saveImageArtifact, saveImageArtifacts } from "../evidence-archive";
import { validateImageInputs } from "../image-artifact";
import { solidImage } from "./image-fixtures";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), "image-batch-archive-"));
  roots.push(path);
  return path;
}
const image = (bytes: Buffer) => ({ data: bytes.toString("base64"), mimeType: "image/png" });

test("batch validation preserves good pixels around malformed parent and native inputs", async () => {
  const good = await solidImage();
  const truncated = good.subarray(0, good.length - 20);
  const result = await validateImageInputs([image(good), { data: "!!!!", mimeType: "image/png" }, image(truncated), image(good)]);
  expect(result.map(item => item.ok)).toEqual([true, false, false, true]);
  for (const item of result) if (item.ok) expect(item.bytes).toEqual(good);
});

test("batch archives validate source IDs and retain exact original bytes", async () => {
  const archive = await root();
  const good = await solidImage();
  const results = await saveImageArtifacts(archive, "session", [
    { entryId: "../outside", blockIndex: 0, image: image(good) },
    { entryId: "good", blockIndex: 1, image: image(good) },
    { entryId: "bad", blockIndex: 2, image: { data: "AA==", mimeType: "image/png" } },
    { entryId: "later", blockIndex: 3, image: image(good) },
  ]);
  expect(results.map(item => item.ok)).toEqual([false, true, false, true]);
  for (const item of results) if (item.ok) {
    expect((await readFile(item.record.path)).toString("base64")).toBe(good.toString("base64"));
    expect((await readImageArtifact(archive, "session", item.record)).data).toBe(good.toString("base64"));
  }
  expect((await readdir(join(archive, "session"))).length).toBe(2);
});

test("a normalization cache hit cannot bypass changed archive bytes or forged paths", async () => {
  const archive = await root();
  const original = await solidImage("purple", 701, 137);
  const record = await saveImageArtifact(archive, "session", "source", 0, image(original));
  const first = await classifierImage(archive, "session", record);
  expect(first.mimeType).toBe("image/png");
  expect((await classifierImage(archive, "session", record)).data).toBe(first.data);
  await expect(classifierImage(archive, "session", { ...record, path: "/etc/passwd" })).rejects.toThrow("path");
  const changed = Buffer.from(original);
  changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;
  await writeFile(record.path, changed);
  await expect(classifierImage(archive, "session", record)).rejects.toThrow("digest");
});
