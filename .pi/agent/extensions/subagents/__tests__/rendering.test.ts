import { expect, test } from "bun:test";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { theme } from "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import {
  type Component,
  Container,
  stripTerminalSequences,
  type Terminal,
  TuiAltScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { SubagentTranscriptFrame } from "../../prompt-ui/subagent-transcript-frame";
import type { WorkerSnapshot } from "../owner";
import {
  agentName,
  frameWidget,
  renderCall,
  renderNotice,
  renderResult,
  workerTranscript,
} from "../rendering";

initTheme("dark", false);
const plain = (component: Component, width = 100) =>
  component.render(width).map(stripTerminalSequences).join("\n");
const fixtureTerminal: Terminal = {
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
const createTui = () => new TuiAltScreen(fixtureTerminal, false);
const result = (value: unknown, expanded = false) =>
  renderResult(
    { content: [{ type: "text", text: JSON.stringify(value) }] },
    { expanded, isPartial: false },
    theme,
  );
const assignment = {
  assignmentId: "assignment",
  outcome: "completed",
  turnsUsed: 2,
  maxTurns: 12,
  persistence: "saved",
};
const worker = {
  workerId: "worker",
  specialist: "review",
  state: "idle",
  currentAssignmentId: "assignment",
  assignments: [assignment],
};

test("transcript cards show both continuation coordinates for a partial entry", () => {
  const card = result({
    entries: [{ role: "tool", text: "æøå evidence", timestamp: 0 }],
    offset: 2, nextOffset: 2, nextTextOffset: 47000,
  }, true);
  expect(plain(card)).toContain("æøå evidence");
  expect(plain(card)).toContain("Continue transcript at offset 2, textOffset 47000");
});

test("tool call cards use the specialist name and compact task, not argument JSON", () => {
  const appearance = new Map([
    [
      "review",
      { name: "review", description: "Review", displayName: "Reviewer", color: "#66a5ad" },
    ],
  ]);
  const card = renderCall(
    "launch",
    { specialist: "review", prompt: "Review æ ø å\nFocus on safety" },
    theme,
    appearance,
  );
  expect(plain(card)).toContain("▸ Reviewer  Review æ ø å Focus on safety");
  expect(agentName("review", theme, appearance)).toContain("Reviewer");
  expect(
    plain(renderCall("inspect", { request: { mode: "report", workerId: "worker" } }, theme)),
  ).toContain("Subagent result  report · worker");
  expect(
    plain(renderCall("control", { request: { action: "release", workerId: "worker" } }, theme)),
  ).toContain("Subagent control  release · worker");
});

test("background and waiting cards distinguish queue, progress, and timeout", () => {
  expect(plain(result({ kind: "launched", worker: { ...worker, state: "queued" } }))).toContain(
    "Queued in background",
  );
  expect(plain(result({ kind: "launched", worker: { ...worker, state: "running" } }))).toContain(
    "Running in background",
  );
  expect(plain(result({ kind: "timeout", worker: { ...worker, state: "running" } }))).toContain(
    "Wait timed out; worker has not been cancelled",
  );
  expect(
    plain(
      result({
        worker: { ...worker, state: "waiting-question" },
        question: { text: "Which target?" },
      }),
    ),
  ).toContain("Answer needed");
});

test("completion notices show outcome, turns, and expandable report preview", () => {
  const message = {
    content: JSON.stringify({ type: "completion", worker, assignment, reportAvailable: true }),
    details: { preview: "First line\nSecond line" },
  };
  expect(plain(renderNotice(message, false, theme))).toContain("✓ review completed worker");
  expect(plain(renderNotice(message, false, theme))).toContain("↻2≤12");
  expect(plain(renderNotice(message, false, theme))).toContain("⎿  First line");
  expect(plain(renderNotice(message, true, theme))).toContain("Second line");
});

test("failure, storage failure, cancellation and cleanup uncertainty remain explicit", () => {
  expect(
    plain(
      result({ worker, assignment: { ...assignment, outcome: "failed", error: "Failed tool" } }),
    ),
  ).toContain("✗ review failed");
  expect(
    plain(
      result({
        worker,
        assignment: { ...assignment, persistence: "failed", persistenceError: "disk full" },
      }),
    ),
  ).toContain("History save failed: disk full");
  for (const state of ["cancelled", "stopping", "cleanup-unknown"])
    expect(plain(result({ ...worker, state }))).toContain(state);
  expect(
    plain(
      result({
        worker,
        assignment: { ...assignment, outcome: "budget-exhausted" },
        partialReport: "Partial findings",
      }),
    ),
  ).toContain("! review budget-exhausted");
});
test("tool cards preserve lifetime, receipt, and storage interpretation", () => {
  const failed = { ...assignment, outcome: "failed", persistence: "saved" };
  const cases: {
    name: string;
    value: unknown;
    includes: string[];
    excludes?: string[];
  }[] = [
    {
      name: "idle failure",
      value: { worker, assignment: failed },
      includes: ["✗ review failed worker"],
    },
    {
      name: "historical failure",
      value: { worker: { ...worker, state: "historical" }, assignment: failed },
      includes: ["✗ review failed worker"],
    },
    {
      name: "released completion",
      value: {
        type: "completion",
        worker: { ...worker, state: "released" },
        assignment: failed,
      },
      includes: ["✗ review failed worker"],
    },
    {
      name: "pending question keeps worker state",
      value: {
        worker: { ...worker, state: "waiting-question" },
        assignment: failed,
        question: { text: "Which target?" },
      },
      includes: ["! review waiting-question worker", "Answer needed"],
      excludes: ["✗ review failed"],
    },
    {
      name: "explicit prior receipt overrides the worker's new current assignment",
      value: {
        type: "completion",
        worker: {
          ...worker,
          currentAssignmentId: "next",
          assignments: [{ ...assignment, assignmentId: "next", turnsUsed: 8 }],
        },
        assignment: { ...failed, assignmentId: "prior", turnsUsed: 2 },
      },
      includes: ["✗ review failed worker", "↻2≤12"],
      excludes: ["↻8≤12"],
    },
    {
      name: "storage failure does not change a completed outcome",
      value: {
        worker,
        assignment: { ...assignment, persistence: "failed", persistenceError: "disk full" },
      },
      includes: ["✓ review completed worker", "History save failed: disk full"],
    },
  ];

  for (const { name, value, includes, excludes = [] } of cases) {
    const rendered = plain(result(value));
    for (const text of includes) expect(rendered, name).toContain(text);
    for (const text of excludes) expect(rendered, name).not.toContain(text);
  }
});

test("report text remains text even when it is valid JSON, and display caps point to full evidence", () => {
  const report = '{"key":"æ ø å"}';
  const card = renderResult(
    { content: [{ type: "text", text: report }] },
    { expanded: true, isPartial: false },
    theme,
    undefined,
    true,
  );
  expect(plain(card)).toContain(report);
  const long = Array.from({ length: 70 }, (_, i) => `line-${i}`).join("\n");
  expect(plain(result({ worker, assignment, report: long }, true))).toContain(
    "… /subagents for full evidence",
  );
});

test("the worker dock reuses the inset, background, and half-height bottom edge", () => {
  for (const width of [1, 4, 12, 80]) {
    const lines = frameWidget(["● Agents", "└─ ◍ review"], width, theme);
    expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
    expect(stripTerminalSequences(lines.at(-1)!)).toBe("▀".repeat(width));
  }
  expect(stripTerminalSequences(frameWidget(["● Agents"], 30, theme)[1]!)).toStartWith(
    "  ● Agents",
  );
  expect(frameWidget([], 80, theme)).toEqual([]);
});

test("transcript renders Markdown evidence inside the existing transcript frame", () => {
  const snapshot: WorkerSnapshot = {
    id: "worker",
    parentSessionId: "parent",
    specialist: "review",
    status: "idle",
    liveSession: "available",
    currentAssignmentId: "assignment",
    createdAt: 0,
    config: {
      name: "review",
      description: "Review",
      prompt: "Review",
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
        outcome: "completed",
        maxTurns: 12,
        turnsUsed: 2,
        remainingTurns: 10,
        persistence: "saved",
        report: "**Findings**\næ ø å",
        transcript: [{ role: "tool", text: "Tool evidence", timestamp: 0 }],
      },
    ],
  };
  const content = workerTranscript(snapshot, undefined, theme);
  expect(plain(content)).toContain("Tool evidence");
  expect(plain(content)).toContain("Findings");
  expect(plain(content)).toContain("æ ø å");
  for (const width of [12, 40, 100]) {
    const lines = new SubagentTranscriptFrame(content, theme, "review").render(width);
    expect(stripTerminalSequences(lines[0]!)).toStartWith("╭");
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  }
});

test("untrusted terminal commands cannot escape result cards", () => {
  const malicious = "\u001b]0;spoof\u0007æ ø å";
  expect(plain(result({ ...worker, workerId: malicious }))).toContain("æ ø å");
  expect(
    result({ ...worker, workerId: malicious })
      .render(100)
      .join("\n"),
  ).not.toContain("spoof");
});

const transcriptUsage = {
  input: 3,
  output: 4,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 7,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function serializedAssistant(content: unknown[], stopReason = "stop"): string {
  return JSON.stringify({
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "fixture",
    model: "fixture-model",
    usage: transcriptUsage,
    stopReason,
    timestamp: 1,
  });
}

function transcriptSnapshot(
  transcript: WorkerSnapshot["assignments"][number]["transcript"],
  report?: string,
  status: WorkerSnapshot["status"] = "idle",
): WorkerSnapshot {
  return {
    id: "worker",
    parentSessionId: "parent",
    specialist: "review",
    status,
    liveSession: "available",
    currentAssignmentId: "assignment",
    createdAt: 0,
    config: {
      name: "review",
      description: "Review",
      prompt: "Review",
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
        prompt: "Review",
        outcome: "completed",
        maxTurns: 12,
        turnsUsed: 2,
        remainingTurns: 10,
        ...(report === undefined ? {} : { report }),
        persistence: "failed",
        persistenceError: "disk full",
        transcript,
      },
    ],
  };
}

test("serialized child messages render as native messages and paired tool evidence", () => {
  const jsonBody = '{"answer":true,"unicode":"æ ø å"}';
  const report = "Final finding: safe";
  const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
    {
      role: "user",
      text: JSON.stringify({ role: "user", content: "Inspect the target", timestamp: 1 }),
      timestamp: 1,
    },
    {
      role: "assistant",
      text: serializedAssistant(
        [
          { type: "text", text: jsonBody },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "/tmp/example", limit: 2 },
          },
          { type: "toolCall", id: "call-2", name: "search", arguments: { pattern: "unsafe" } },
        ],
        "toolUse",
      ),
      timestamp: 2,
    },
    {
      role: "tool",
      text: JSON.stringify({
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "Read output: safe" }],
        isError: false,
        timestamp: 3,
      }),
      timestamp: 3,
    },
    {
      role: "tool",
      text: JSON.stringify({
        role: "toolResult",
        toolCallId: "call-2",
        toolName: "search",
        content: [{ type: "text", text: "Permission denied" }],
        isError: true,
        timestamp: 4,
      }),
      timestamp: 4,
    },
    {
      role: "assistant",
      text: serializedAssistant([{ type: "text", text: report }]),
      timestamp: 5,
    },
    {
      role: "system",
      text: JSON.stringify({ role: "system", content: "Internal system envelope", timestamp: 6 }),
      timestamp: 6,
    },
    { role: "system", text: "Budget warning: finish within the remaining turns.", timestamp: 7 },
  ];
  const native = workerTranscript(
    transcriptSnapshot(transcript, report, "running"),
    {
      startedAt: 1,
      activity: "Writing",
      liveText: "Streaming **now**",
    },
    theme,
    { tui: createTui(), cwd: "/tmp" },
  );
  const content = plain(native);

  const nativeTools =
    native instanceof Container
      ? native.children.filter(
          (child): child is ToolExecutionComponent => child instanceof ToolExecutionComponent,
        )
      : [];
  expect(nativeTools).toHaveLength(2);
  expect(plain(nativeTools[0]!)).toContain("Read output: safe");
  expect(plain(nativeTools[1]!)).toContain("Permission denied");
  expect(nativeTools[1]!.render(100).join("\n")).toContain(theme.getBgAnsi("toolErrorBg"));
  expect(content).not.toContain("unmatched tool result");
  expect(content).toContain("Inspect the target");
  expect(content).toContain(jsonBody);
  expect(content).toContain("read");
  expect(content).toContain("/tmp/example");
  expect(content).toContain("Read output: safe");
  expect(content).toContain("Budget warning: finish within the remaining turns.");
  expect(content).toContain("Streaming now");
  expect(content).toContain("Storage: failed");
  expect(content).toContain("Storage error: disk full");
  expect(content).not.toContain("Internal system envelope");
  expect(content).not.toContain('"toolCallId"');
  expect(content).not.toContain('"stopReason"');
  expect(content).not.toContain("Final report");
  expect(content.split(report)).toHaveLength(2);
});

test("persisted bash and summary messages render natively while invalid envelopes remain visible", () => {
  const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
    {
      role: "system",
      text: JSON.stringify({
        role: "bashExecution",
        command: "printf native",
        output: "Native bash output",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 1,
      }),
      timestamp: 1,
    },
    {
      role: "system",
      text: JSON.stringify({
        role: "compactionSummary",
        summary: "Compacted conversation summary",
        tokensBefore: 240,
        timestamp: 2,
      }),
      timestamp: 2,
    },
    {
      role: "system",
      text: JSON.stringify({
        role: "branchSummary",
        summary: "Returned branch summary",
        fromId: "entry-1",
        timestamp: 3,
      }),
      timestamp: 3,
    },
    {
      role: "system",
      text: JSON.stringify({
        role: "custom",
        customType: "internal",
        content: "Hidden internal envelope",
        display: true,
        timestamp: 4,
      }),
      timestamp: 4,
    },
    {
      role: "system",
      text: JSON.stringify({ role: "bashExecution", command: "malformed", timestamp: 5 }),
      timestamp: 5,
    },
  ];
  const content = plain(
    workerTranscript(transcriptSnapshot(transcript), undefined, theme, {
      tui: createTui(),
      cwd: "/tmp",
    }),
  );

  expect(content).toContain("printf native");
  expect(content).toContain("Native bash output");
  expect(content).toContain("Compacted conversation summary");
  expect(content).toContain("Returned branch summary");
  expect(content).not.toContain("Hidden internal envelope");
  expect(content).toContain("Transcript entry could not be displayed; the original entry follows.");
  expect(content).toContain('"command":"malformed"');
});

test("malformed and unknown serialized records get explicit readable fallbacks", () => {
  const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
    { role: "assistant", text: '{"role":"assistant","content":', timestamp: 1 },
    {
      role: "assistant",
      text: JSON.stringify({ role: "mystery", timestamp: 2, content: "unknown payload" }),
      timestamp: 2,
    },
    {
      role: "assistant",
      text: JSON.stringify({ role: "assistant", content: [{ type: "unsupported" }], timestamp: 3 }),
      timestamp: 3,
    },
  ];
  const content = plain(workerTranscript(transcriptSnapshot(transcript), undefined, theme));

  expect(
    content.match(/Transcript entry could not be displayed; the original entry follows\./g),
  ).toHaveLength(3);
  expect(content).toContain('{"role":"assistant","content":');
  expect(content).toContain("unknown payload");
});

test("serialized transcript text is sanitized before native rendering", () => {
  const malicious = "\u001b]0;spoof\u0007Review æ ø å";
  const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
    {
      role: "assistant",
      text: serializedAssistant([{ type: "text", text: malicious }]),
      timestamp: 1,
    },
  ];
  const rendered = workerTranscript(transcriptSnapshot(transcript), undefined, theme)
    .render(100)
    .join("\n");

  expect(stripTerminalSequences(rendered)).toContain("Review æ ø å");
  expect(rendered).not.toContain("spoof");
});

test("transcripts reuse parent renderers with saved details, complete arguments, and error state", () => {
  const details = {
    kind: "read",
    path: "/tmp/æøå.ts",
    lines: [{ anchor: "Abcd", text: "const value = 1;" }],
  };
  const seen: unknown[] = [];
  const definitions = {
    renderShell: "self" as const,
    renderCall(args: unknown, _theme: unknown, context: { argsComplete: boolean }) {
      seen.push({ args, argsComplete: context.argsComplete });
      return new (class implements Component {
        invalidate() {}
        render() {
          return ["HASHLINE CALL"];
        }
      })();
    },
    renderResult(
      result: { details?: unknown },
      options: { expanded: boolean },
      _theme: unknown,
      context: { isError: boolean; executionStarted: boolean },
    ) {
      seen.push({
        details: result.details,
        expanded: options.expanded,
        isError: context.isError,
        executionStarted: context.executionStarted,
      });
      return new (class implements Component {
        invalidate() {}
        render() {
          return ["HASHLINE RESULT"];
        }
      })();
    },
  };
  for (const isError of [false, true]) {
    const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
      {
        role: "assistant",
        text: serializedAssistant(
          [{ type: "toolCall", id: "hashline", name: "read", arguments: { path: "/tmp/æøå.ts" } }],
          "toolUse",
        ),
        timestamp: 1,
      },
      {
        role: "tool",
        text: JSON.stringify({
          role: "toolResult",
          toolCallId: "hashline",
          toolName: "read",
          content: [{ type: "text", text: "Abcd│const value = 1;" }],
          details,
          isError,
          timestamp: 2,
        }),
        timestamp: 2,
      },
    ];
    const snapshot = transcriptSnapshot(transcript);
    const before = JSON.stringify(snapshot);
    const content = plain(
      workerTranscript(snapshot, undefined, theme, {
        tui: createTui(),
        cwd: "/tmp",
        getToolRenderers: (name) => (name === "read" ? definitions : undefined),
      }),
    );
    expect(content).toContain("HASHLINE CALL");
    expect(content).toContain("HASHLINE RESULT");
    expect(seen).toContainEqual({ args: { path: "/tmp/æøå.ts" }, argsComplete: true });
    expect(seen).toContainEqual({ details, expanded: true, isError, executionStarted: true });
    expect(JSON.stringify(snapshot)).toBe(before);
  }
});

test("custom renderer details are terminal-safe and replay does not cause a redraw loop", () => {
  const tui = createTui();
  let redraws = 0;
  tui.requestRender = () => {
    redraws++;
  };
  let invalidate = () => {};
  const details = { nested: ["\u001b]0;spoof\u0007æøå"] };
  const transcript: WorkerSnapshot["assignments"][number]["transcript"] = [
    {
      role: "assistant",
      text: serializedAssistant(
        [{ type: "toolCall", id: "call", name: "read", arguments: { path: "/tmp/test" } }],
        "toolUse",
      ),
      timestamp: 1,
    },
    {
      role: "tool",
      text: JSON.stringify({
        role: "toolResult",
        toolCallId: "call",
        toolName: "read",
        content: [],
        details,
        isError: false,
        timestamp: 2,
      }),
      timestamp: 2,
    },
  ];
  let received: unknown;
  const component = workerTranscript(transcriptSnapshot(transcript), undefined, theme, {
    tui,
    cwd: "/tmp",
    getToolRenderers: () => ({
      renderCall(_args: unknown, _theme: unknown, context: { invalidate: () => void }) {
        invalidate = context.invalidate;
        return { render: () => ["read"], invalidate() {} };
      },
      renderResult(result: { details?: unknown }) {
        received = result.details;
        return { render: () => ["result"], invalidate() {} };
      },
    }),
  });
  plain(component);
  expect(received).toEqual({ nested: ["æøå"] });
  expect(redraws).toBe(0);
  invalidate();
  expect(redraws).toBe(1);
});

test("truncated subagent titles and previews use … without resetting the enclosing background", () => {
  for (const input of ["a".repeat(140), "æøå界".repeat(60)]) {
    const title = renderCall("launch", { specialist: "quick", prompt: input }, theme)
      .render(200)
      .join("\n");
    const preview = renderResult(
      { content: [{ type: "text", text: input }] },
      { expanded: false, isPartial: false },
      theme,
      undefined,
      true,
    )
      .render(200)
      .join("\n");
    for (const line of [title, preview]) {
      expect(stripTerminalSequences(line)).toContain("…");
      // The enclosing native tool card owns the background; nested text may
      // change foreground/bold but must not reset that background mid-row.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: This assertion must detect ANSI background-reset sequences.
      expect(line).not.toMatch(/\u001b\[(?:0|49)?m/);
    }
  }
});
