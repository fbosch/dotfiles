import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { WorkerSnapshot } from "../owner";
import { cancellable, terminalText, widgetLines, workerDetails } from "../presentation";

function worker(id: string, status: WorkerSnapshot["status"], createdAt = 0): WorkerSnapshot {
  return { id, status, createdAt, specialist: id, parentSessionId: "parent", currentAssignmentId: "assignment", liveSession: "available",
    config: { name: id, description: "Fixture", prompt: "Fixture", model: "fixture/model", maxTurns: 12, tools: [], excludeTools: [], extensions: [], skills: [] },
    assignments: [{ id: "assignment", prompt: "Task", outcome: "running", maxTurns: 12, turnsUsed: 2, remainingTurns: 10, persistence: "not-attempted", transcript: [] }],
  };
}
const defaults = { observation: () => undefined, width: 100, terminalRows: 30, now: 65_000 };

test("widget prioritizes questions and preserves launch order within each state", () => {
  const workers = [worker("queued-1", "queued"), worker("run-3", "running", 3), worker("ask-2", "waiting-question", 2), worker("run-1", "running", 1), worker("ask-1", "waiting-question", 1), worker("run-2", "running", 2), worker("queued-2", "queued")];
  const rows = widgetLines({ ...defaults, workers });
  expect(rows[0]).toBe("● Agents");
  expect(rows.filter((row) => /[├└]─ [!◍]/u.test(row)).map((row) => row.split(" ")[2])).toEqual(["ask-1", "ask-2", "run-1", "run-2"]);
  expect(rows.at(-1)).toBe("└─ +3 more · /subagents");
  expect(rows.filter((row) => row.includes("⎿"))).toHaveLength(4);
});

test("short terminals retain cleanup warnings while reducing ordinary rows", () => {
  const workers = [worker("uncertain", "cleanup-unknown"), worker("active", "running"), worker("queued", "queued")];
  const rows = widgetLines({ ...defaults, workers, terminalRows: 10 });
  expect(rows).toEqual(["! Delegation blocked: cleanup unknown", "+2 more · /subagents"]);
  for (const width of [1, 8, 20, 60]) {
    const narrow = widgetLines({ ...defaults, workers, width, terminalRows: 8 });
    expect(narrow[0]).toStartWith("!");
    expect(narrow.every((line) => visibleWidth(line) <= width)).toBe(true);
  }
});

test("completed workers leave the widget while stopping remains visible", () => {
  const rows = widgetLines({ ...defaults, workers: [worker("completed", "idle"), worker("stopping", "stopping")] });
  expect(rows).toHaveLength(3);
  expect(rows[1]).toContain("stopping");
  expect(rows[1]).toContain("1m 5s");
});

test("row count is configurable and foreground rows can be excluded", () => {
  const rows = widgetLines({ ...defaults, workers: [worker("foreground", "running"), worker("a", "running"), worker("b", "queued")], hiddenWorkers: new Set(["foreground"]), maxRows: 1 });
  expect(rows).toHaveLength(4);
  expect(rows[1]).toStartWith("├─ ◍ a");
  expect(rows[3]).toStartWith("└─ +1 more");
  expect(() => widgetLines({ ...defaults, workers: [], maxRows: 0 })).toThrow();
});

test("details keep full evidence and distinguish missing metrics and storage failure", () => {
  const base = worker("done", "idle");
  const report = "report ".repeat(10_000) + "FINAL_CAVEAT";
  const view = workerDetails({ ...base, assignments: [{ ...base.assignments[0]!, outcome: "completed", persistence: "failed", persistenceError: "disk full", report, transcript: [{ role: "tool", text: "Full investigation", timestamp: 0 }] }] });
  expect(view).toContain("Execution: completed | Storage: failed");
  expect(view).toContain("Storage error: disk full");
  expect(view).toContain("Input tokens: unavailable");
  expect(view).toContain("Cost: unavailable");
  expect(view).toContain(report);
  expect(view).toContain("Full investigation");
  expect(workerDetails(base, { startedAt: 0, activity: "Done", liveText: "", cost: 0, inputTokens: 0 })).toContain("Cost: 0");
});

test("historical, released, stopping, and cancelled workers do not expose cancellation", () => {
  expect(cancellable(worker("active", "running"))).toBe(true);
  expect(cancellable(worker("question", "waiting-question"))).toBe(true);
  for (const state of ["historical", "released", "stopping", "cancelled", "cleanup-unknown"] as const) expect(cancellable(worker(state, state))).toBe(false);
});

test("terminal content strips control sequences while preserving Danish text and line breaks", () => {
  const esc = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  expect(terminalText(`${esc}[31mæ ø å${esc}[0m\n${esc}]0;spoofed title${bell}evidence${bell}`)).toBe("æ ø å\nevidence");
});
