import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { saveConversationArtifact } from "../evidence-archive";
import { recallSaved } from "../recall";
import { readSavedArtifact, SavedArtifactSnapshotChanged } from "../saved-artifact";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(text: string) {
  const root = await mkdtemp(join(tmpdir(), "saved-evidence-"));
  roots.push(root);
  const record = { ...(await saveConversationArtifact(root, "session", text)), text };
  return { root, record };
}

test("reads complete and bounded prefixes of an unchanged archived original", async () => {
  const { root, record } = await fixture("Approval: æøå remains exact.");
  const complete = await readSavedArtifact(root, record, Buffer.byteLength(record.text));
  expect(complete).toMatchObject({
    text: record.text,
    bytes: Buffer.byteLength(record.text),
    partial: false,
  });
  const prefix = await readSavedArtifact(root, record, 9);
  expect(prefix).toMatchObject({ text: "Approval:", bytes: 9, partial: true });
});

test("rejects changed originals and reports the bytes already read", async () => {
  const { root, record } = await fixture("Approved: archived original");
  await writeFile(record.path, "Rejected: archived original");
  let error: unknown;
  try {
    await readSavedArtifact(root, record, 8);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(SavedArtifactSnapshotChanged);
  if (!(error instanceof SavedArtifactSnapshotChanged)) throw Error("Missing snapshot mismatch");
  expect(error.bytesRead).toBe(8);
  await expect(readSavedArtifact(root, record, 100)).rejects.toThrow("snapshot changed");
});

test("recall charges changed snapshots against its scan budget", async () => {
  const { root, record } = await fixture("Approved: archived original");
  const manager = SessionManager.inMemory(root);
  manager.appendCustomEntry("context-masking", { items: [record] });
  const changed = "Rejected: archived original";
  await writeFile(record.path, changed);

  const report = await recallSaved(manager.getBranch(), root, "Rejected");
  expect(report).toMatchObject({ scanned: 1, skipped: 1, bytes: Buffer.byteLength(changed) });
  expect(report.text).not.toContain(changed);
});

test("rejects a path that does not belong to its archived entry", async () => {
  const { root, record } = await fixture("Archived approval");
  await expect(readSavedArtifact(root, { ...record, path: "/etc/passwd" }, 100)).rejects.toThrow(
    "Invalid saved-result path",
  );
});
