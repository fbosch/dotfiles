import { expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { theme } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme";
import { inspectable, type WorkerRenderState, type WorkerTarget } from "../interaction";
import { renderCall, renderResult } from "../rendering";

initTheme("dark", false);
const click: TuiMouseEvent = { type: "click", button: "left", x: 1, y: 0, screenX: 1, screenY: 0, width: 100, height: 4, shift: false, alt: false, ctrl: false };
const worker = { workerId: "worker", parentSessionId: "parent", specialist: "adversarial", state: "idle", currentAssignmentId: "assignment", assignments: [{ assignmentId: "assignment", outcome: "completed", turnsUsed: 1, maxTurns: 4, persistence: "saved" }] };

test("a launch card shows the specialist once and clicking its result opens the exact worker", () => {
  const opened: WorkerTarget[] = [];
  const options = { expanded: false, isPartial: false, compact: true, open: (target: WorkerTarget) => opened.push(target) };
  const call = renderCall("launch", { specialist: "adversarial", prompt: "Smoke test" }, theme);
  const result = renderResult({ content: [{ type: "text", text: JSON.stringify({ worker, report: "Received the test." }) }] }, options, theme);
  const lines = [...call.render(100), ...result.render(100)].map(stripTerminalSequences).join("\n");
  expect(lines.match(/adversarial/g)).toHaveLength(1);
  expect(lines).toContain("↻1≤4");
  expect(lines).toContain("Received the test.");
  expect(result.handleMouse?.(click)?.handled).toBe(true);
  expect(opened).toEqual([{ workerId: "worker", parentSessionId: "parent" }]);
});

test("a call header uses the target that arrives with progress without taking selection gestures", () => {
  const state: WorkerRenderState = {};
  const opened: WorkerTarget[] = [];
  const component = inspectable(new Text("Header", 0, 0), () => state.target, (target) => opened.push(target));
  expect(component.handleMouse?.(click)).toBeUndefined();
  state.target = { workerId: "worker", parentSessionId: "parent" };
  for (const event of [{ ...click, type: "press" as const }, { ...click, type: "drag" as const }, { ...click, type: "release" as const }, { ...click, shift: true }, { ...click, button: "right" as const }]) expect(component.handleMouse?.(event)).toBeUndefined();
  expect(opened).toEqual([]);
  component.handleMouse?.(click);
  expect(opened).toEqual([state.target]);
});
