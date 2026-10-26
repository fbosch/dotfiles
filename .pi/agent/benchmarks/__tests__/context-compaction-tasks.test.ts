import { expect, test } from "bun:test";
import { codingCases, scoreCode } from "../context-compaction-task-fixtures";

test("reference implementations satisfy every task and critical constraint", () => {
  for (const task of codingCases()) expect(scoreCode(task, task.reference).taskSuccess).toBe(true);
});

test("superseded decisions fail task and critical-constraint checks", () => {
  const [task] = codingCases();
  if (!task) throw new Error("Missing task");
  const obsolete =
    'export function normalizeEvents(events) { return events.map(e => ({ id: e.id.toLowerCase(), label: e.label, route: "route-obsolete" })); }';
  expect(scoreCode(task, obsolete).taskSuccess).toBe(false);
  expect(scoreCode(task, obsolete).criticalViolations).toBeGreaterThan(0);
});

test("timeouts and syntax errors are scored as failures, not successful completions", () => {
  const task = codingCases()[1];
  if (!task) throw new Error("Missing task");
  expect(scoreCode(task, "invalid code").passed).toBe(0);
  expect(scoreCode(task, "export function retryDelays() { while(true) {} }").passed).toBe(0);
});

test("seeds change hidden archived values, not task structure", () => {
  const a = codingCases("a"),
    b = codingCases("b");
  expect(a.map((t) => t.name)).toEqual(b.map((t) => t.name));
  expect(a[0]?.reference).not.toBe(b[0]?.reference);
});

test("selection keeps whole evidence blocks within a UTF-8 byte cap", async () => {
  const { selectEvidence } = await import("../context-compaction-tasks");
  const text = selectEvidence(["æøå", "short", "too-long".repeat(100)], [1, 0.5, 1], 6);
  expect(text).toBe("æøå");
  expect(new TextEncoder().encode(text).length).toBe(6);
});

test("continuation input includes wrappers and retrieval, never hidden reference code", async () => {
  const { composeInput } = await import("../context-compaction-tasks");
  const task = codingCases()[0];
  if (!task) throw new Error("Missing task");
  const text = composeInput(task, "state", "verbatim", "restored");
  expect(text).toContain("COMPACTED STATE");
  expect(text).toContain("restored");
  expect(text).toContain(task.request);
  expect(text).not.toContain(task.reference);
});

test("object key order is not a routing requirement, but returning the input is forbidden", () => {
  const task = codingCases()[0];
  if (!task) throw new Error("Missing task");
  const reordered = task.reference.replace(
    "({ id: e.id, label: e.label, route:",
    "({ label: e.label, id: e.id, route:",
  );
  expect(scoreCode(task, reordered).taskSuccess).toBe(true);
  expect(
    scoreCode(task, "export function normalizeEvents(events) { return events; }").taskSuccess,
  ).toBe(false);
});
