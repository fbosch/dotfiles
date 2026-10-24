import { expect, test } from "bun:test";
import type { Terminal, TuiMouseEvent } from "@earendil-works/pi-tui";
import type { WorkerTarget } from "../interaction";
import { registerParentTools } from "../tools";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const tui: typeof import("@earendil-works/pi-tui") = await import(
  process.env.PI_SUBAGENT_TEST_TUI ?? "@earendil-works/pi-tui"
);
sdk.initTheme("dark", false);
let input: ((data: string) => void) | undefined;
const terminal: Terminal = {
  columns: 100,
  rows: 30,
  kittyProtocolActive: false,
  start(onInput) {
    input = onInput;
  },
  stop() {
    input = undefined;
  },
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

test("the native tool card dispatches header and result clicks to inspection instead of expansion", () => {
  const definitions = new Map<
    string,
    NonNullable<ConstructorParameters<typeof sdk.ToolExecutionComponent>[4]>
  >();
  const opened: WorkerTarget[] = [];
  registerParentTools(
    {
      registerTool(tool) {
        definitions.set(tool.name, tool);
      },
    },
    () => {
      throw new Error("Rendering must not execute a worker");
    },
    () => new Map(),
    (target) => opened.push(target),
  );
  const ui = new tui.TuiAltScreen(terminal, false);
  const card = new sdk.ToolExecutionComponent(
    "subagent",
    "call",
    { specialist: "adversarial", prompt: "Smoke test" },
    {},
    definitions.get("subagent"),
    ui,
    "/tmp",
  );
  card.updateResult({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          worker: {
            parentSessionId: "parent",
            workerId: "worker",
            specialist: "adversarial",
            state: "idle",
            currentAssignmentId: "assignment",
            assignments: [
              {
                assignmentId: "assignment",
                outcome: "completed",
                turnsUsed: 1,
                maxTurns: 4,
                persistence: "saved",
              },
            ],
          },
          report: "Received the test.",
        }),
      },
    ],
    isError: false,
  });
  const lines = card.render(100).map(tui.stripTerminalSequences);
  expect(lines.join("\n").match(/adversarial/g)).toHaveLength(1);
  for (const content of ["▸ adversarial", "✓ completed", "Received the test."]) {
    const y = lines.findIndex((line) => line.includes(content));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(card.handleMouse({ ...click, y, screenY: y })?.handled).toBe(true);
  }
  expect(opened).toEqual(
    Array.from({ length: 3 }, () => ({ workerId: "worker", parentSessionId: "parent" })),
  );
  ui.addChild(card);
  try {
    ui.start();
    ui.renderNow();
    const row = lines.findIndex((line) => line.includes("▸ adversarial")) + 1;
    input?.(`\u001b[<0;4;${row}M`);
    input?.(`\u001b[<0;4;${row}m`);
    expect(opened).toHaveLength(4);
    expect(opened.at(-1)).toEqual({ workerId: "worker", parentSessionId: "parent" });
  } finally {
    ui.stop();
  }
});
