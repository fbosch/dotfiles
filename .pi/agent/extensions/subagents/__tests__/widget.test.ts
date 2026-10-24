import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { theme } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme";
import type { WorkerSnapshot } from "../owner";
import { createWorkerWidget } from "../widget";

initTheme("dark", false);
const click: TuiMouseEvent = {
  type: "click",
  button: "left",
  x: 3,
  y: 0,
  screenX: 3,
  screenY: 0,
  width: 100,
  height: 30,
  shift: false,
  alt: false,
  ctrl: false,
};
function worker(id: string): WorkerSnapshot {
  return {
    id,
    specialist: id,
    parentSessionId: "parent",
    createdAt: 0,
    status: "running",
    liveSession: "available",
    currentAssignmentId: "assignment",
    config: {
      name: id,
      description: id,
      prompt: "Role",
      model: "fixture/model",
      maxTurns: 4,
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
        maxTurns: 4,
        turnsUsed: 1,
        remainingTurns: 3,
        persistence: "not-attempted",
        transcript: [],
      },
    ],
  };
}
test("widget header and activity rows open the same worker across resize and state changes", () => {
  let workers = [worker("first"), worker("second")];
  const opened: string[] = [];
  const widget = createWorkerWidget(
    () => ({ workers, observation: () => undefined, terminalRows: 30, theme }),
    theme,
    (id) => opened.push(id),
  );
  for (const width of [100, 40]) {
    const lines = widget.render(width).map(stripTerminalSequences);
    const row = lines.findIndex((line) => line.includes("◍ second"));
    expect(row).toBeGreaterThan(0);
    for (const y of [row, row + 1])
      expect(widget.handleMouse?.({ ...click, width, y })?.handled).toBe(true);
    expect(widget.handleMouse?.({ ...click, y: 0 })).toBeUndefined();
  }
  expect(opened).toEqual(["second", "second", "second", "second"]);
  workers = [worker("second")];
  widget.render(100);
  widget.handleMouse?.({ ...click, y: 2 });
  expect(opened.at(-1)).toBe("second");
  widget.invalidate();
  expect(widget.handleMouse?.({ ...click, y: 2 })).toBeUndefined();
  workers = [];
  expect(widget.render(100)).toEqual([]);
  expect(widget.handleMouse?.({ ...click, y: 2 })).toBeUndefined();
});

test("activity clock runs only for visible running rows and stops on replacement and disposal", () => {
  let workers = [worker("run")];
  let tick: (() => void) | undefined;
  let starts = 0;
  let stops = 0;
  let renders = 0;
  const clock = {
    setInterval(callback: () => void, delay: number) {
      expect(delay).toBe(200);
      starts++;
      tick = callback;
      return {} as ReturnType<typeof setInterval>;
    },
    clearInterval(_id: ReturnType<typeof setInterval>) {
      stops++;
      tick = undefined;
    },
  };
  const widget = createWorkerWidget(
    () => ({ workers, observation: () => undefined, terminalRows: 30, theme, maxRows: 1 }),
    theme,
    () => {},
    () => {
      renders++;
    },
    clock,
  );
  const lines = () => widget.render(40).map(stripTerminalSequences);
  expect(lines().join(" ")).toContain("◍ run");
  expect(starts).toBe(1);
  tick?.();
  expect(renders).toBe(1);
  expect(lines().join(" ")).toContain("● run");
  expect(starts).toBe(1);
  for (const status of ["queued", "waiting-question", "stopping", "cancelled", "idle"] as const) {
    workers = [{ ...worker("run"), status }];
    expect(lines().join(" ")).not.toContain("● run");
    expect(tick).toBeUndefined();
  }
  workers = [worker("run"), { ...worker("question"), status: "waiting-question" }];
  widget.render(40);
  expect(tick).toBeUndefined(); // Row limit shows the question, not the running worker.
  workers = [worker("run")];
  const hiddenWidget = createWorkerWidget(
    () => ({
      workers,
      observation: () => undefined,
      terminalRows: 30,
      theme,
      hiddenWorkers: new Set(["run"]),
    }),
    theme,
    () => {},
    () => {
      renders++;
    },
    clock,
  );
  hiddenWidget.render(40);
  expect(tick).toBeUndefined();
  hiddenWidget.dispose();
  const shortWidget = createWorkerWidget(
    () => ({ workers, observation: () => undefined, terminalRows: 8, theme }),
    theme,
    () => {},
    () => {
      renders++;
    },
    clock,
  );
  shortWidget.render(40);
  expect(tick).toBeUndefined();
  shortWidget.dispose();
  workers = [worker("run")];
  widget.render(8);
  expect(tick).toBeUndefined();
  widget.render(40);
  expect(starts).toBe(2);
  widget.dispose();
  expect(stops).toBe(2);
  expect(tick).toBeUndefined();
  widget.render(40);
  expect(starts).toBe(2);
});
