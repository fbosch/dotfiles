import { expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { WorkerSnapshot } from "../owner";
import { cancellable, terminalText, widgetLines, workerDetails } from "../presentation";

function worker(id: string, status: WorkerSnapshot["status"], createdAt = 0): WorkerSnapshot {
  return {
    id,
    status,
    createdAt,
    specialist: id,
    parentSessionId: "parent",
    currentAssignmentId: "assignment",
    liveSession: "available",
    config: {
      name: id,
      description: "Fixture",
      prompt: "Fixture",
      model: "fixture/model",
      maxTurns: 12,
      tools: [],
      excludeTools: [],
      extensions: [],
      skills: [],
    },
    assignments: [
      {
        id: "assignment",
        prompt: "Task",
        outcome: "running",
        maxTurns: 12,
        turnsUsed: 2,
        remainingTurns: 10,
        persistence: "not-attempted",
        transcript: [],
      },
    ],
  };
}
const defaults = { observation: () => undefined, width: 100, terminalRows: 30, now: 65_000 };

test("widget prioritizes questions and preserves launch order within each state", () => {
  const workers = [
    worker("queued-1", "queued"),
    worker("run-3", "running", 3),
    worker("ask-2", "waiting-question", 2),
    worker("run-1", "running", 1),
    worker("ask-1", "waiting-question", 1),
    worker("run-2", "running", 2),
    worker("queued-2", "queued"),
  ];
  const rows = widgetLines({ ...defaults, workers });
  expect(rows[0]).toBe("● Agents");
  expect(rows.filter((row) => /[├└]─ [!◍]/u.test(row)).map((row) => row.split(" ")[2])).toEqual([
    "ask-1",
    "ask-2",
    "run-1",
    "run-2",
  ]);
  expect(rows.at(-1)).toBe("└─ +3 more · /subagents");
  expect(rows.filter((row) => row.includes("⎿"))).toHaveLength(4);
});

test("short terminals retain cleanup warnings while reducing ordinary rows", () => {
  const workers = [
    worker("uncertain", "cleanup-unknown"),
    worker("active", "running"),
    worker("queued", "queued"),
  ];
  const rows = widgetLines({ ...defaults, workers, terminalRows: 10 });
  expect(rows).toEqual(["! Delegation blocked: cleanup unknown", "+2 more · /subagents"]);
  for (const width of [1, 8, 20, 60]) {
    const narrow = widgetLines({ ...defaults, workers, width, terminalRows: 8 });
    expect(narrow[0]).toStartWith("!");
    expect(narrow.every((line) => visibleWidth(line) <= width)).toBe(true);
  }
});

test("completed workers leave the widget while stopping remains visible", () => {
  const rows = widgetLines({
    ...defaults,
    workers: [worker("completed", "idle"), worker("stopping", "stopping")],
  });
  expect(rows).toHaveLength(3);
  expect(rows[1]).toContain("stopping");
  expect(rows[1]).toContain("1m 5s");
});

test("budget warning clears on release or continuation while history retains partial evidence", () => {
  const base = worker("exhausted", "idle");
  const assignment = base.assignments[0];
  if (!assignment) throw new Error("Expected fixture assignment");
  const exhausted: WorkerSnapshot = {
    ...base,
    assignments: [
      { ...assignment, outcome: "budget-exhausted", partialReport: "Partial findings" },
    ],
  };
  expect(widgetLines({ ...defaults, workers: [exhausted] })).toEqual([
    "! Turn budget exhausted; inspect partial evidence",
  ]);

  const released: WorkerSnapshot = { ...exhausted, status: "released", liveSession: "released" };
  expect(widgetLines({ ...defaults, workers: [released] })).toEqual([]);
  expect(workerDetails(released)).toContain("Partial findings");

  const continued: WorkerSnapshot = {
    ...exhausted,
    status: "running",
    currentAssignmentId: "next",
    assignments: [...exhausted.assignments, { ...assignment, id: "next" }],
  };
  const rows = widgetLines({ ...defaults, workers: [continued] });
  expect(rows[0]).toBe("● Agents");
  expect(rows.some((line) => line.includes("Turn budget exhausted"))).toBe(false);
  expect(workerDetails(continued)).toContain("Partial findings");
});

test("releasing an exhausted worker does not hide a history save failure", () => {
  const base = worker("released", "released");
  const assignment = base.assignments[0];
  if (!assignment) throw new Error("Expected fixture assignment");
  expect(
    widgetLines({
      ...defaults,
      workers: [
        {
          ...base,
          liveSession: "released",
          assignments: [{ ...assignment, outcome: "budget-exhausted", persistence: "failed" }],
        },
      ],
    }),
  ).toEqual(["! History save failed; inspect in-memory evidence"]);
});

test("row count is configurable and foreground rows can be excluded", () => {
  const rows = widgetLines({
    ...defaults,
    workers: [worker("foreground", "running"), worker("a", "running"), worker("b", "queued")],
    hiddenWorkers: new Set(["foreground"]),
    maxRows: 1,
  });
  expect(rows).toHaveLength(4);
  expect(rows[1]).toStartWith("├─ ◍ a");
  expect(rows[3]).toStartWith("└─ +1 more");
  expect(() => widgetLines({ ...defaults, workers: [], maxRows: 0 })).toThrow();
});

test("details keep full evidence and distinguish missing metrics and storage failure", () => {
  const base = worker("done", "idle");
  const report = "report ".repeat(10_000) + "FINAL_CAVEAT";
  const view = workerDetails({
    ...base,
    assignments: [
      {
        ...base.assignments[0]!,
        outcome: "completed",
        persistence: "failed",
        persistenceError: "disk full",
        report,
        transcript: [{ role: "tool", text: "Full investigation", timestamp: 0 }],
      },
    ],
  });
  expect(view).toContain("Execution: completed | Storage: failed");
  expect(view).toContain("Storage error: disk full");
  expect(view).toContain("Input tokens: unavailable");
  expect(view).toContain("Cost: unavailable");
  expect(view).toContain(report);
  expect(view).toContain("Full investigation");
  expect(
    workerDetails(base, { startedAt: 0, activity: "Done", liveText: "", cost: 0, inputTokens: 0 }),
  ).toContain("Cost: 0");
});

test("historical, released, stopping, and cancelled workers do not expose cancellation", () => {
  expect(cancellable(worker("active", "running"))).toBe(true);
  expect(cancellable(worker("question", "waiting-question"))).toBe(true);
  for (const state of [
    "historical",
    "released",
    "stopping",
    "cancelled",
    "cleanup-unknown",
  ] as const)
    expect(cancellable(worker(state, state))).toBe(false);
});

test("widget prompt truncation keeps a Unicode ellipsis inside the gray foreground", () => {
  const base = worker("active", "running");
  const prompt = "æøå".repeat(100);
  const rows = widgetLines({
    ...defaults,
    workers: [{ ...base, assignments: [{ ...base.assignments[0]!, prompt }] }],
    theme: {
      bold: (text) => text,
      fg: (color, text) => (color === "muted" ? `\u001b[90m${text}\u001b[39m` : text),
    },
  });
  expect(rows[1]).toContain(`\u001b[90m${prompt.slice(0, 32)}…\u001b[39m`);
  expect(rows.every((line) => visibleWidth(line) <= defaults.width)).toBe(true);
});

test("terminal content strips control sequences while preserving Danish text and line breaks", () => {
  const esc = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  expect(
    terminalText(`${esc}[31mæ ø å${esc}[0m\n${esc}]0;spoofed title${bell}evidence${bell}`),
  ).toBe("æ ø å\nevidence");
});
