import { afterEach, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { savedItems } from "../../extensions/context-masking/evidence-archive";
import { readSavedLines, recordedBaseline, scoreAnswer } from "../context-recall-baseline";
import { recallSession } from "../context-recall-offline";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("scores exact values and explicit abstention, not missing keys or guesses", () => {
  const probes = [
    { id: "schema", expected: "skema_æøå" },
    { id: "unknown", expected: null },
  ];
  expect(
    scoreAnswer('{"schema":"skema_æøå","unknown":null}', probes).every((row) => row.correct),
  ).toBe(true);
  expect(scoreAnswer('{"schema":"skema_æøå"}', probes)[1]?.correct).toBe(false);
  expect(
    scoreAnswer('{"schema":"old","unknown":"guess"}', probes).every((row) => !row.correct),
  ).toBe(true);
  expect(scoreAnswer("not JSON", probes).every((row) => !row.correct)).toBe(true);
});

test("recorded baseline verifies sources, scores batch retrieval, and never appends to sessions", async () => {
  const session = await recallSession([
    { tool: "read", args: { path: "schema.txt" }, text: "Approved schema: skema_æøå_42." },
    { tool: "read", args: { path: "cursor.txt" }, text: "Approved restart cursor: cursor_0042." },
  ]);
  cleanups.push(session.cleanup);
  const path = join(session.root, "session.jsonl");
  const source = `${[session.manager.getHeader(), ...session.manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFile(path, source);
  const records = [...savedItems(session.manager.getBranch()).values()];
  const probes = records.map((record, index) => ({
    id: String(index),
    sessionFile: path,
    sourcePath: record.path,
    question: index === 0 ? "What schema was approved?" : "What restart cursor was approved?",
    expected: index === 0 ? "skema_æøå_42" : "cursor_0042",
  }));
  const result = await recordedBaseline(probes, session.root);
  expect(result[0]?.rows.every((row) => row.hit3 && row.expectedSourceCited)).toBe(true);
  expect(result[0]?.batches[0]?.hits.every((row) => row.hit)).toBe(true);
  expect(await readFile(path, "utf8")).toBe(source);
  const firstRecord = records[0];
  if (!firstRecord) throw Error("Missing source record");
  expect(
    await readSavedLines(session.manager.getBranch(), session.root, firstRecord.path, 1, 1),
  ).toBe("1│Approved schema: skema_æøå_42.");
  await expect(
    readSavedLines(
      session.manager.getBranch(),
      session.root,
      join(session.root, "unregistered.txt"),
      1,
      1,
    ),
  ).rejects.toThrow();
  await expect(
    readSavedLines(session.manager.getBranch(), session.root, firstRecord.path, 0, 1),
  ).rejects.toThrow("range");
  const first = probes[0];
  if (!first) throw Error("Missing fixture probe");
  await expect(
    recordedBaseline([{ ...first, expected: "unsupported" }], session.root),
  ).rejects.toThrow("not verified");
});
