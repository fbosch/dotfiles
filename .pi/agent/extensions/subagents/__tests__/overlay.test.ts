import { afterEach, expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { type Component, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";
import { SubagentTranscriptFrame } from "../../prompt-ui/subagent-transcript-frame";

initTheme("dark", false);

import { WorkerDelivery } from "../delivery";
import { SubagentOverlay } from "../overlay";
import {
  type ChildDriver,
  type ChildDriverCallbacks,
  type ChildExecutionOutcome,
  WorkerOwner,
} from "../owner";
import { ParentRuntime } from "../parent-runtime";
import type { ResolvedSpecialist } from "../specialist";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
const config: ResolvedSpecialist = {
  name: "fixture",
  description: "Fixture",
  prompt: "Fixture",
  model: "fixture/model",
  maxTurns: 12,
  tools: [],
  excludeTools: [],
  extensions: [],
  skills: [],
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(confirmed = false, holdClose = false) {
  const runs = new Map<
    string,
    { callbacks: ChildDriverCallbacks; finish: (result: ChildExecutionOutcome) => void }
  >();
  let releaseClose = () => {};
  const closeGate = new Promise<void>((resolve) => {
    releaseClose = resolve;
  });
  let starts = 0;
  const driver: ChildDriver = {
    start(input, callbacks) {
      starts++;
      return new Promise((finish) => {
        runs.set(input.workerId, { callbacks, finish });
      });
    },
    prompt(input, callbacks) {
      return this.start(input, callbacks);
    },
    async steer() {},
    async abort(id) {
      runs.get(id)?.finish({ kind: "failed", turnsUsed: 0, error: "Aborted" });
    },
    async close() {
      if (holdClose) await closeGate;
      return { confirmed: true };
    },
  };
  const owner = new WorkerOwner({
    parentSessionId: "parent",
    driver,
    persistence: { async save() {} },
    cleanupHealth: { isBlocked: () => false, markUncertain() {} },
  });
  const notices: unknown[] = [];
  const runtime = new ParentRuntime(
    new WorkerDelivery(
      owner,
      (notice) => {
        notices.push(notice);
      },
      (error) => {
        throw error;
      },
    ),
    { resolve: async () => config, messages: () => [] },
  );
  const first = await owner.launch({ config: { ...config, name: "first" }, prompt: "First task" });
  const second = await owner.launch({
    config: { ...config, name: "second" },
    prompt: "Second task",
  });
  let closed = false;
  let confirmations = 0;
  let lastConfirmation: { title: string; message: string } | undefined;
  let redraws = 0;
  const overlay = new SubagentOverlay(runtime, {
    theme,
    observation: () => undefined,
    height: () => 16,
    requestRender: () => {
      redraws++;
    },
    close: () => {
      closed = true;
    },
    confirm: async (title, message) => {
      confirmations++;
      lastConfirmation = { title, message };
      return confirmed;
    },
  });
  cleanup.push(async () => {
    releaseClose();
    overlay.dispose();
    await runtime.shutdown();
  });
  return {
    overlay,
    owner,
    runtime,
    runs,
    first,
    second,
    notices,
    releaseClose,
    starts: () => starts,
    closed: () => closed,
    confirmations: () => confirmations,
    confirmation: () => lastConfirmation,
    redraws: () => redraws,
  };
}
const enter = "\r";
const down = "\u001b[B";
const up = "\u001b[A";
const esc = "\u001b";

test("Enter inspects and Escape closes immediately without model work", async () => {
  const f = await fixture();
  f.overlay.handleInput(down);
  f.overlay.handleInput(enter);
  expect(f.overlay.render(100).join("\n")).toContain("second");
  f.overlay.handleInput(esc);
  expect(f.closed()).toBe(true);
  expect(f.starts()).toBe(2);
  expect(f.notices).toEqual([]);
});

test("manual scrolling pauses following and reinspection preserves its position", async () => {
  const f = await fixture();
  const run = f.runs.get(f.first.workerId)!;
  run.callbacks.onTranscript({
    role: "tool",
    text: Array.from({ length: 70 }, (_, index) => `evidence-${index}`).join("\n"),
  });
  f.overlay.handleInput(enter);
  expect(f.overlay.render(100).join("\n")).toContain("evidence-69");
  for (let i = 0; i < 25; i++) f.overlay.handleInput(up);
  const before = f.overlay.render(100).slice(1, -2);
  run.callbacks.onTranscript({ role: "tool", text: "LATEST_EVIDENCE" });
  run.callbacks.onTurn(1);
  expect(f.overlay.render(100).slice(1, -2)).toEqual(before);
  for (let index = 0; index < 3; index++) f.overlay.handleInput("\t");
  f.overlay.handleInput(enter);
  expect(f.closed()).toBe(false);
  expect(f.overlay.render(100).some((line) => line.startsWith("> first"))).toBe(true);
  f.overlay.handleInput(enter);
  expect(f.overlay.render(100).slice(1, -2)).toEqual(before);
  f.overlay.handleInput("\t");
  f.overlay.handleInput(enter);
  expect(f.overlay.render(100).join("\n")).toContain("LATEST_EVIDENCE");
  expect(f.redraws()).toBeGreaterThan(0);
});

test("declining the labeled cancel-all action leaves every worker running", async () => {
  const f = await fixture(false);
  f.overlay.handleInput(down);
  f.overlay.handleInput(down);
  expect(f.overlay.render(100).join("\n")).toContain("> Cancel all active workers");
  f.overlay.handleInput(enter);
  await tick();
  expect(f.confirmations()).toBe(1);
  expect(f.owner.list().every((worker) => worker.status === "running")).toBe(true);
});

test("confirmed cancellation remains stopping until child shutdown confirms", async () => {
  const f = await fixture(true, true);
  f.overlay.handleInput(down);
  f.overlay.handleInput(down);
  f.overlay.handleInput(enter);
  await tick();
  expect(f.owner.list().every((worker) => worker.status === "stopping")).toBe(true);
  expect(f.overlay.render(100).join("\n")).toContain("stopping");
  f.releaseClose();
  await tick();
  expect(f.owner.list().every((worker) => worker.status === "cancelled")).toBe(true);
  expect(f.overlay.render(100).join("\n")).not.toContain("Cancel all active workers");
});

test("detail cancellation uses a labeled action and confirmation rather than a destructive key", async () => {
  const f = await fixture(false);
  f.overlay.handleInput(enter);
  f.overlay.handleInput("c");
  expect(f.confirmations()).toBe(0);
  f.overlay.handleInput("\t");
  f.overlay.handleInput("\t");
  expect(f.overlay.render(100).join("\n")).toContain("[Cancel worker…]");
  f.overlay.handleInput(enter);
  await tick();
  expect(f.confirmations()).toBe(1);
  expect(f.confirmation()).toEqual({
    title: "Cancel this worker?",
    message: "Cancelled workers cannot continue.",
  });
  expect(f.owner.inspect(f.first.workerId).status).toBe("running");
});

test("overlay frames fit narrow and wide terminals without changing worker state", async () => {
  const f = await fixture();
  expect(f.overlay.render(100)[0]).toBe("Subagents");
  for (const width of [12, 40, 100]) {
    const lines = f.overlay.render(width);
    expect(lines).toHaveLength(16);
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  }
  expect(f.owner.list().every((worker) => worker.status === "running")).toBe(true);
});

test("direct inspection opens the chosen worker without executing or cancelling work", async () => {
  const f = await fixture();
  f.runs
    .get(f.second.workerId)!
    .callbacks.onTranscript({ role: "tool", text: "SECOND_WORKER_EVIDENCE" });
  f.overlay.inspect(f.second.workerId);
  expect(f.overlay.render(100).join("\n")).toContain("SECOND_WORKER_EVIDENCE");
  expect(f.starts()).toBe(2);
  expect(f.confirmations()).toBe(0);
  expect(() => f.overlay.inspect("foreign-worker")).toThrow();
  f.overlay.handleInput(esc);
  expect(f.closed()).toBe(true);
  expect(f.owner.list().every((worker) => worker.status === "running")).toBe(true);
});

test("wheel events cross the transcript frame, pause following, and stay inside the modal", async () => {
  const f = await fixture();
  const run = f.runs.get(f.first.workerId)!;
  run.callbacks.onTranscript({
    role: "tool",
    text: Array.from({ length: 70 }, (_, index) => `wheel-evidence-${index}`).join("\n"),
  });
  f.overlay.inspect(f.first.workerId);
  const frame: Component = new SubagentTranscriptFrame(f.overlay, theme, "Subagents");
  const wheel = (delta: number): TuiMouseEvent => ({
    type: "wheel",
    button: "none",
    x: 8,
    y: 6,
    screenX: 18,
    screenY: 16,
    width: 100,
    height: 18,
    shift: false,
    alt: false,
    ctrl: false,
    wheelDelta: delta,
  });
  const bottom = frame.render(100);
  expect(bottom.join("\n")).toContain("wheel-evidence-69");
  expect(frame.handleMouse?.(wheel(-4))?.handled).toBe(true);
  const scrolled = frame.render(100);
  expect(scrolled).not.toEqual(bottom);
  run.callbacks.onTranscript({ role: "tool", text: "WHEEL_LATEST" });
  expect(frame.render(100)).toEqual(scrolled);
  expect(frame.handleMouse?.(wheel(10000))?.handled).toBe(true);
  expect(frame.render(100).join("\n")).toContain("WHEEL_LATEST");
  expect(frame.handleMouse?.(wheel(4))?.handled).toBe(true);
  run.callbacks.onTranscript({ role: "tool", text: "WHEEL_FOLLOWING" });
  expect(frame.render(100).join("\n")).toContain("WHEEL_FOLLOWING");
  frame.handleInput?.(esc);
  expect(f.closed()).toBe(true);
  expect(f.starts()).toBe(2);
  expect(f.confirmations()).toBe(0);
});

test("wheel navigation selects workers without launching or cancelling them", async () => {
  const f = await fixture();
  const frame: Component = new SubagentTranscriptFrame(f.overlay, theme, "Subagents");
  frame.render(100);
  const event: TuiMouseEvent = {
    type: "wheel",
    button: "none",
    x: 8,
    y: 3,
    screenX: 8,
    screenY: 3,
    width: 100,
    height: 18,
    shift: false,
    alt: false,
    ctrl: false,
    wheelDelta: 1,
  };
  expect(frame.handleMouse?.(event)?.handled).toBe(true);
  expect(frame.render(100).join("\n")).toContain("> second");
  expect(f.starts()).toBe(2);
  expect(f.confirmations()).toBe(0);
  f.overlay.dispose();
  expect(f.overlay.handleMouse?.(event)).toBeUndefined();
});

test("metadata details expand without changing worker state or losing the summary", async () => {
  const f = await fixture();
  f.overlay.inspect(f.first.workerId);
  for (let index = 0; index < 4; index++) f.overlay.handleInput("\t");
  expect(f.overlay.render(140).join("\n")).toContain("[Show details]");
  f.overlay.handleInput(enter);
  expect(f.overlay.render(140).join("\n")).toContain("Worker ID");
  expect(f.overlay.render(140).join("\n")).toContain("[Hide details]");
  f.overlay.handleInput(enter);
  expect(f.overlay.render(140).join("\n")).toContain("[Show details]");
  expect(f.owner.inspect(f.first.workerId).status).toBe("running");
  expect(f.starts()).toBe(2);
});
