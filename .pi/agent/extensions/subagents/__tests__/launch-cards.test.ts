import { expect, test } from "bun:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { stripTerminalSequences, type Terminal, TuiAltScreen } from "@earendil-works/pi-tui";
import type { workerStatus } from "../delivery";
import { registerParentTools } from "../tools";
import { createWorkerWidget } from "../widget";

initTheme("dark", false);
const terminal: Terminal = {
  columns: 100,
  rows: 30,
  kittyProtocolActive: false,
  start() {},
  stop() {},
  async drainInput() {},
  write() {},
  moveBy() {},
  hideCursor() {},
  showCursor() {},
  clearLine() {},
  clearFromCursor() {},
  clearScreen() {},
  setTitle() {},
  setProgramStatus() {},
  setProgress() {},
};
function fixture() {
  let worker: (ReturnType<typeof workerStatus> & { prompt?: string; report?: string }) | undefined =
    {
      workerId: "worker",
      parentSessionId: "parent",
      specialist: "quick",
      state: "running",
      liveSession: "available",
      currentAssignmentId: "first",
      assignments: [
        {
          assignmentId: "first",
          outcome: "running",
          turnsUsed: 0,
          maxTurns: 6,
          remainingTurns: 6,
          persistence: "pending",
        },
      ],
    };
  const registered = new Map<string, ConstructorParameters<typeof ToolExecutionComponent>[4]>();
  const cards = registerParentTools(
    {
      registerTool(tool) {
        registered.set(tool.name, tool);
      },
    },
    () => {
      throw new Error("Rendering must not start a runtime");
    },
    undefined,
    undefined,
    () => worker,
  );
  const receipt = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          kind: "launched",
          workerId: "worker",
          assignmentId: "first",
          worker,
        }),
      },
    ],
    isError: false,
  };
  const original = JSON.stringify(receipt);
  const tui = new TuiAltScreen(terminal, false);
  let redraws = 0;
  tui.requestRender = () => {
    redraws++;
  };
  const card = new ToolExecutionComponent(
    "subagent",
    "call",
    { specialist: "quick", prompt: "Task" },
    {},
    registered.get("subagent"),
    tui,
    "/tmp",
  );
  card.updateResult(receipt);
  const plain = () => card.render(100).map(stripTerminalSequences).join("\n");
  const inspection = (
    name: "subagent_result" | "subagent_control",
    callId: string,
    request: object,
    value: unknown,
    isError = false,
  ) => {
    const component = new ToolExecutionComponent(
      name,
      callId,
      { request },
      {},
      registered.get(name),
      tui,
      "/tmp",
    );
    component.updateResult({
      content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
      isError,
    });
    return component;
  };
  const pending = (name: "subagent" | "subagent_result" | "subagent_control") =>
    new ToolExecutionComponent(name, "streaming-call", {}, {}, registered.get(name), tui, "/tmp");
  return {
    cards,
    card,
    plain,
    receipt,
    original,
    inspection,
    pending,
    redraws: () => redraws,
    get worker() {
      return worker;
    },
    set worker(value) {
      worker = value;
    },
  };
}

test("a mounted launch card refreshes its outcome and turn count without rewriting the receipt", () => {
  const f = fixture();
  expect(f.plain()).toContain("running");
  f.worker = {
    ...f.worker!,
    state: "idle",
    assignments: [
      {
        ...f.worker!.assignments[0]!,
        outcome: "completed",
        turnsUsed: 4,
        remainingTurns: 2,
        persistence: "saved",
      },
    ],
  };
  const before = f.redraws();
  f.cards.refresh("worker");
  expect(f.plain()).toContain("completed");
  expect(f.plain()).toContain("↻4≤6");
  expect(f.redraws()).toBeGreaterThan(before);
  expect(JSON.stringify(f.receipt)).toBe(f.original);
});

test("status, wait, report, and transcript inspections share the existing worker card", () => {
  const f = fixture();
  for (const mode of ["status", "wait", "report", "transcript"]) {
    const value = mode === "report" ? "CARD_OK" : { worker: f.worker };
    const inspection = f.inspection("subagent_result", mode, { mode, workerId: "worker" }, value);
    expect(inspection.render(100)).toEqual([]);
  }
  expect(f.plain()).toContain("running");
  expect(JSON.stringify(f.receipt)).toBe(f.original);
});

test("failed inspections remain visible even when their worker has a card", () => {
  const f = fixture();
  const failure = f.inspection(
    "subagent_result",
    "error",
    { mode: "report", workerId: "worker" },
    "Report unavailable",
    true,
  );
  expect(failure.render(100).map(stripTerminalSequences).join("\n")).toContain(
    "Report unavailable",
  );
});

for (const outcome of ["failed", "budget-exhausted", "cancelled"] as const) {
  test(`a launch card displays ${outcome} rather than running`, () => {
    const f = fixture();
    f.worker = {
      ...f.worker!,
      state: "idle",
      assignments: [{ ...f.worker!.assignments[0]!, outcome, turnsUsed: 6, remainingTurns: 0 }],
    };
    f.cards.refresh("worker");
    expect(f.plain()).toContain(outcome);
    expect(f.plain()).toContain("↻6≤6");
  });
}

test("the original card follows the latest assignment during a continuation", () => {
  const f = fixture();
  f.worker = {
    ...f.worker!,
    state: "running",
    currentAssignmentId: "second",
    assignments: [
      { ...f.worker!.assignments[0]!, outcome: "completed", turnsUsed: 4, remainingTurns: 2 },
      { ...f.worker!.assignments[0]!, assignmentId: "second", outcome: "running", turnsUsed: 1 },
    ],
  };
  f.cards.refresh("worker");
  expect(f.plain()).toContain("running");
  expect(f.plain()).toContain("↻1≤6");
  expect(
    f
      .inspection(
        "subagent_control",
        "continue",
        { action: "continue", workerId: "worker" },
        { kind: "launched", worker: f.worker, assignmentId: "second" },
      )
      .render(100),
  ).toEqual([]);
});

test("restored history updates the original card and keeps storage failures visible", () => {
  const f = fixture();
  f.worker = {
    ...f.worker!,
    state: "historical",
    liveSession: "historical",
    assignments: [
      {
        ...f.worker!.assignments[0]!,
        outcome: "completed",
        turnsUsed: 4,
        persistence: "failed",
        persistenceError: "disk full",
      },
    ],
  };
  f.card.invalidate();
  expect(f.plain()).toContain("completed");
  expect(f.plain()).toContain("History save failed: disk full");
});

test("cleanup uncertainty is not replaced with a successful assignment outcome", () => {
  const f = fixture();
  f.worker = {
    ...f.worker!,
    state: "cleanup-unknown",
    assignments: [{ ...f.worker!.assignments[0]!, outcome: "completed" }],
  };
  f.cards.refresh("worker");
  expect(f.plain()).toContain("cleanup-unknown");
});

test("missing or foreign history never presents a launch snapshot as live status", () => {
  const f = fixture();
  f.worker = { ...f.worker!, parentSessionId: "other-parent" };
  f.cards.refresh("worker");
  expect(f.plain()).toContain("Current assignment status unavailable");
  f.worker = undefined;
  f.cards.refresh("worker");
  expect(f.plain()).toContain("Current assignment status unavailable");
});

test("unrelated workers do not redraw a card and teardown drops redraw callbacks", () => {
  const f = fixture();
  const before = f.redraws();
  f.cards.refresh("other-worker");
  expect(f.redraws()).toBe(before);
  f.cards.clear();
  f.cards.refresh("worker");
  expect(f.redraws()).toBe(before);
});

test("the single worker card shows the current prompt and final report", () => {
  const f = fixture();
  f.worker = {
    ...f.worker!,
    state: "idle",
    prompt: "New assignment",
    report: "CARD_OK",
    assignments: [{ ...f.worker!.assignments[0]!, outcome: "completed" }],
  };
  f.cards.refresh("worker");
  expect(f.plain()).toContain("New assignment");
  expect(f.plain()).toContain("CARD_OK");
  expect(f.cards.has({ workerId: "worker", parentSessionId: "parent" })).toBe(true);
  expect(f.cards.has({ workerId: "worker", parentSessionId: "foreign" })).toBe(false);
});

test("reload rebuilds ownership and hides saved inspection cards", () => {
  const f = fixture();
  f.cards.clear();
  f.worker = {
    ...f.worker!,
    state: "historical",
    assignments: [{ ...f.worker!.assignments[0]!, outcome: "completed" }],
  };
  f.card.invalidate();
  expect(f.plain()).toContain("completed");
  expect(
    f
      .inspection(
        "subagent_result",
        "saved-status",
        { mode: "status", workerId: "worker" },
        f.worker,
      )
      .render(100),
  ).toEqual([]);
});

test("an inspection becomes the single card when the launch row is absent", () => {
  const f = fixture();
  f.cards.clear();
  const first = f.inspection(
    "subagent_result",
    "first-status",
    { mode: "status", workerId: "worker" },
    f.worker,
  );
  expect(first.render(100).map(stripTerminalSequences).join("\n")).toContain("running");
  expect(
    f
      .inspection(
        "subagent_result",
        "second-status",
        { mode: "status", workerId: "worker" },
        f.worker,
      )
      .render(100),
  ).toEqual([]);
  f.card.invalidate();
  expect(f.card.render(100)).toEqual([]);
});

test("aggregate status omits workers already represented by their live cards", () => {
  const f = fixture();
  expect(
    f.inspection("subagent_result", "all-status", { mode: "status" }, [f.worker]).render(100),
  ).toEqual([]);
  const mixed = f.inspection("subagent_result", "mixed-status", { mode: "status" }, [
    f.worker,
    { ...f.worker!, workerId: "other-worker", specialist: "review" },
  ]);
  const lines = mixed.render(100).map(stripTerminalSequences).join("\n");
  expect(lines).toContain("review");
  expect(lines).not.toContain("quick");
});

test("worker cards keep one row of inner padding above and below their content", () => {
  const f = fixture();
  for (const width of [30, 100]) {
    const lines = f.card.render(width).map(stripTerminalSequences);
    expect(lines.findIndex((line) => line.includes("▸ quick"))).toBe(2);
    expect(lines.at(-1)?.trim()).toBe("");
    expect(lines.at(-2)?.trim().length).toBeGreaterThan(0);
  }
});

for (const name of ["subagent_result", "subagent_control"] as const) {
  test(`${name} stays hidden throughout argument streaming and execution`, () => {
    const f = fixture();
    const card = f.pending(name);
    expect(card.render(100)).toEqual([]);
    const operation = name === "subagent_result" ? { mode: "status" } : { action: "continue" };
    for (const request of [
      {},
      operation,
      { ...operation, workerId: "wor" },
      { ...operation, workerId: "worker" },
    ]) {
      card.updateArgs({ request });
      expect(card.render(100)).toEqual([]);
    }
    card.setArgsComplete();
    card.markExecutionStarted();
    expect(card.render(100)).toEqual([]);
    card.updateResult({
      content: [{ type: "text", text: JSON.stringify({ worker: f.worker }) }],
      isError: false,
    });
    expect(card.render(100)).toEqual([]);
  });
}

test("an invalid inspection exposes its error even with missing request arguments", () => {
  const f = fixture();
  const card = f.pending("subagent_result");
  card.updateResult({ content: [{ type: "text", text: "Invalid request" }], isError: true });
  expect(card.render(100).map(stripTerminalSequences).join("\n")).toContain("Invalid request");
});

test("the shared activity clock animates output-only workers and stops when settled", () => {
  const f = fixture();
  let tick: (() => void) | undefined;
  let stops = 0;
  const clock = {
    setInterval(callback: () => void, delay: number) {
      expect(delay).toBe(200);
      tick = callback;
      return {} as ReturnType<typeof setInterval>;
    },
    clearInterval() {
      stops++;
      tick = undefined;
    },
  };
  const widget = createWorkerWidget(
    () => ({ workers: [], observation: () => undefined, terminalRows: 30, theme }),
    theme,
    () => {},
    (frame) => f.cards.animate(frame),
    clock,
    () => f.cards.active(),
  );
  expect(widget.render(100)).toEqual([]);
  expect(tick).toBeDefined();
  expect(f.plain()).toContain("◍ running");
  tick?.();
  expect(f.plain()).toContain("● running");
  tick?.();
  expect(f.plain()).toContain("◍ running");
  for (const state of ["queued", "waiting-question", "stopping", "idle"] as const) {
    f.worker = { ...f.worker!, state };
    f.cards.refresh("worker");
    expect(f.cards.active()).toBe(false);
  }
  widget.render(100);
  expect(tick).toBeUndefined();
  expect(stops).toBe(1);
  f.worker = { ...f.worker!, state: "running" };
  f.cards.refresh("worker");
  widget.render(100);
  expect(tick).toBeDefined();
  widget.dispose();
  expect(stops).toBe(2);
  f.cards.clear();
  expect(f.cards.active()).toBe(false);
});
