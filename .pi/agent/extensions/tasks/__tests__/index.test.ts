import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { installSubagentWidgetFrame } from "../../prompt-ui/subagent-widget-frame";
import tasksExtension, {
  confidentlyExplainsUnfinishedWork,
  formatProgress,
  renderTaskWidget,
  resolveTaskIcons,
  TASKS_RECONCILIATION_ENTRY,
  TASKS_STATE_ENTRY,
  TASKS_STATE_SCHEMA,
  type TaskItem,
  type TasksInput,
  TasksParameters,
} from "../index";

type TaskDetails = { action: TasksInput["action"]; items: TaskItem[] };
type RegisteredTaskTool = ToolDefinition<typeof TasksParameters, TaskDetails>;
type EventHandler = (event: never, ctx: ExtensionContext) => unknown | Promise<unknown>;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;

let root: string;
let cwd: string;
let sessionDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tasks-checklist-"));
  cwd = join(root, "workspace");
  sessionDir = join(root, "sessions");
  mkdirSync(cwd);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function createSession(name = "one"): SessionManager {
  const manager = SessionManager.create(cwd, join(sessionDir, name));
  manager.appendMessage({ role: "user", content: "Track this work", timestamp: Date.now() });
  return manager;
}

function harness(
  initialManager: SessionManager,
  classifyResponse?: (
    ctx: ExtensionContext,
    items: readonly TaskItem[],
    response: string,
    signal: AbortSignal,
  ) => Promise<boolean>,
) {
  let manager = initialManager;
  const runController = new AbortController();
  const events = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const widgets: Parameters<ExtensionContext["ui"]["setWidget"]>[1][] = [];
  const notifications: string[] = [];
  let customViews = 0;
  let tool: RegisteredTaskTool | undefined;
  const context = {
    cwd,
    signal: runController.signal,
    hasUI: true,
    mode: "tui",
    get sessionManager() {
      return manager;
    },
    ui: {
      setWidget: (_key: string, content: Parameters<ExtensionContext["ui"]["setWidget"]>[1]) =>
        widgets.push(content),
      notify: (message: string) => notifications.push(message),
      async custom() {
        customViews++;
      },
    },
  };
  const pi = {
    getSettings: () => ({}),
    appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
    on: (event: string, handler: EventHandler) => events.set(event, handler),
    registerTool: (definition: RegisteredTaskTool) => {
      tool = definition;
    },
    registerCommand: (_name: string, definition: { handler: CommandHandler }) =>
      commands.set("tasks", definition.handler),
  } as unknown as ExtensionAPI;
  tasksExtension(pi, classifyResponse);

  return {
    context,
    abortRun: () => runController.abort(),
    widgets,
    notifications,
    get customViews() {
      return customViews;
    },
    setSession(next: SessionManager) {
      manager = next;
    },
    async event(name: string, value: object = {}) {
      return await events.get(name)?.(value as never, context as unknown as ExtensionContext);
    },
    async call(input: TasksInput) {
      if (tool === undefined) throw new Error("tasks tool was not registered");
      return tool.execute(
        "test-call",
        input,
        undefined,
        undefined,
        context as unknown as ExtensionToolContext,
      );
    },
    async command(args: string) {
      const handler = commands.get("tasks");
      if (handler === undefined) throw new Error("/tasks was not registered");
      await handler(args, context as unknown as ExtensionCommandContext);
    },
  };
}

function resultText(result: Awaited<ReturnType<ReturnType<typeof harness>["call"]>>): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

const inspectTask: TaskItem = {
  id: "inspect",
  title: "Inspect current behavior",
  status: "pending",
};
const regressionTask: TaskItem = {
  id: "test",
  title: "Add regression tests",
  status: "in_progress",
};
const plan: TaskItem[] = [inspectTask, regressionTask];

describe("standalone tasks checklist", () => {
  test.each([false, true])(
    "renders the original panel with shared wrapper enabled=%s",
    async (wrapped) => {
      const tasks = harness(createSession());
      const uninstall = wrapped
        ? installSubagentWidgetFrame(tasks.context.ui as unknown as ExtensionContext["ui"])
        : undefined;
      const theme = {
        fg: (_color: string, text: string) => text,
        getBgAnsi: () => "\x1b[48;2;34;34;34m",
        strikethrough: (text: string) => text,
      } as unknown as Theme;
      try {
        await tasks.event("session_start");
        await tasks.call({ action: "set", items: plan });
        const factory = tasks.widgets.at(-1);
        if (typeof factory !== "function") throw new Error("Expected a task widget factory");
        const widget = factory({} as TUI, theme);
        const lines = widget.render(80);
        const plain = lines.map(stripTerminalSequences);
        expect(plain).toEqual([
          " ".repeat(80),
          "  • 2 tasks (0 done, 1 in progress, 1 open)".padEnd(80),
          "    □ Inspect current behavior".padEnd(80),
          "    ■ Add regression tests".padEnd(80),
          "▀".repeat(80),
        ]);
        expect(lines.slice(0, -1).every((line) => line.startsWith("\x1b[48;2;34;34;34m"))).toBe(
          true,
        );
        expect(lines.at(-1)).toBe(`\x1b[38;2;34;34;34m${"▀".repeat(80)}\x1b[39m`);
        expect(plain.join("\n")).not.toContain("#inspect");
        for (const width of [1, 4, 5, 12, 80]) {
          expect(widget.render(width).every((line) => visibleWidth(line) === width)).toBe(true);
        }
        await tasks.command("clear");
        expect(tasks.widgets.at(-1)).toBeUndefined();
      } finally {
        uninstall?.();
      }
    },
  );

  test("configures state icons with defaults for omitted states", () => {
    expect(resolveTaskIcons({})).toEqual({ pending: "□", in_progress: "■", completed: "✓" });
    const icons = resolveTaskIcons({
      tasks: { icons: { pending: "□", in_progress: "▶", completed: "☑" } },
    });
    const theme = {
      fg: (_color: string, text: string) => text,
      strikethrough: (text: string) => text,
    };
    expect(
      renderTaskWidget(
        [inspectTask, regressionTask, { id: "done", title: "Done", status: "completed" }],
        100,
        theme,
        icons,
      ).slice(1),
    ).toEqual(["  □ Inspect current behavior", "  ▶ Add regression tests", "  ☑ Done"]);
    expect(resolveTaskIcons({ tasks: { icons: { in_progress: "◼" } } })).toEqual({
      pending: "□",
      in_progress: "◼",
      completed: "✓",
    });
    expect(resolveTaskIcons({})).toEqual({ pending: "□", in_progress: "■", completed: "✓" });
    for (const value of ["", " ", "\n", "\x1b[31m!", 1, null]) {
      expect(() => resolveTaskIcons({ tasks: { icons: { pending: value } } })).toThrow(
        "tasks.icons.pending",
      );
    }
    expect(() => resolveTaskIcons({ tasks: { icons: { blocked: "!" } } })).toThrow(
      "Unknown tasks.icons status",
    );
    expect(() => resolveTaskIcons({ tasks: { icons: [] } })).toThrow(
      "tasks.icons must be an object",
    );
  });

  test("renders every task with distinct pending, active, and completed styling", () => {
    const theme = {
      fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : 90}m${text}\x1b[39m`,
      strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
    };
    const items: TaskItem[] = [
      inspectTask,
      regressionTask,
      { id: "done", title: "Verified æøå", status: "completed" },
    ];
    const lines = renderTaskWidget(items, 100, theme);
    expect(lines.map(stripTerminalSequences)).toEqual([
      "• 3 tasks (1 done, 1 in progress, 1 open)",
      "  □ Inspect current behavior",
      "  ■ Add regression tests",
      "  ✓ Verified æøå",
    ]);
    expect(lines[2]).toContain("\x1b[36m■ Add regression tests");
    expect(lines[3]).toContain("\x1b[9mVerified æøå\x1b[29m");
    expect(lines[1]).not.toContain("\x1b[9m");
    expect(renderTaskWidget([], 100, theme)).toEqual([]);

    const completed = items.map((item) => ({ ...item, status: "completed" as const }));
    expect(renderTaskWidget(completed, 100, theme).map(stripTerminalSequences)).toEqual([
      "• 3 tasks (3 done, 0 in progress, 0 open)",
      "  ✓ Inspect current behavior",
      "  ✓ Add regression tests",
      "  ✓ Verified æøå",
    ]);
    expect(formatProgress([inspectTask])).toBe("1 task (0 done, 0 in progress, 1 open)");
  });

  test("keeps task rows single-line and within terminal width on resize", () => {
    const theme = {
      fg: (_color: string, text: string) => text,
      strikethrough: (text: string) => text,
    };
    const items: TaskItem[] = [
      { id: "1", title: "Review\n界面\tand æøå ".repeat(5), status: "in_progress" },
    ];
    for (const width of [1, 12, 40, 160]) {
      const lines = renderTaskWidget(items, width, theme);
      expect(lines).toHaveLength(2);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(lines.every((line) => !/[\r\n\t]/.test(line))).toBe(true);
    }
  });

  test("only suppresses reminders for high-confidence explanations", () => {
    expect(confidentlyExplainsUnfinishedWork({ type: "bool", probability: 0.95 })).toBe(true);
    expect(confidentlyExplainsUnfinishedWork({ type: "bool", probability: 0.84 })).toBe(false);
    expect(
      confidentlyExplainsUnfinishedWork({ type: "bool", probability: 0.95, extra: true }),
    ).toBe(true);
    expect(confidentlyExplainsUnfinishedWork({ type: "score", score: 1, confidence: 1 })).toBe(
      false,
    );
    expect(confidentlyExplainsUnfinishedWork(undefined)).toBe(false);
  });

  test("reminds once, persists one-shot state, and resets only for real user input", async () => {
    const manager = createSession();
    const tasks = harness(manager);
    await tasks.event("session_start");
    await tasks.call({ action: "set", items: plan });
    const completion = {
      outcome: "completed",
      context: { llmMessages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] },
    };
    const first = (await tasks.event("agent_before_settle", completion)) as {
      continue: boolean;
      entries: Array<{ customType?: string; content?: string }>;
    };
    expect(first.continue).toBe(true);
    expect(first.entries.find((entry) => entry.content !== undefined)).toMatchObject({
      type: "custom_message",
      display: false,
    });
    expect(
      first.entries.some((entry) => entry.content?.includes("Do not resume implementation")),
    ).toBe(true);
    await tasks.event("input", { source: "extension", text: "extension continuation" });
    expect(await tasks.event("agent_before_settle", completion)).toBeUndefined();

    manager.appendCustomEntry(TASKS_RECONCILIATION_ENTRY);
    const reloaded = harness(manager);
    await reloaded.event("session_start");
    expect(await reloaded.event("agent_before_settle", completion)).toBeUndefined();
    await reloaded.event("input", { source: "interactive", text: "new user request" });
    expect(await reloaded.event("agent_before_settle", completion)).toMatchObject({
      continue: true,
    });
  });

  test("ignores a stale classifier result after user input and skips aborted runs", async () => {
    let resolveDecision!: (value: boolean) => void;
    const delayed = new Promise<boolean>((resolve) => {
      resolveDecision = resolve;
    });
    const tasks = harness(createSession(), () => delayed);
    await tasks.event("session_start");
    await tasks.call({ action: "set", items: plan });
    const completion = {
      outcome: "completed",
      context: { llmMessages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }] },
    };
    const pending = tasks.event("agent_before_settle", completion);
    await tasks.event("input", { source: "interactive", text: "new request" });
    resolveDecision(false);
    expect(await pending).toBeUndefined();
    expect(
      await tasks.event("agent_before_settle", { ...completion, outcome: "aborted" }),
    ).toBeUndefined();
    expect(
      await tasks.event("agent_before_settle", { ...completion, outcome: "error" }),
    ).toBeUndefined();
  });

  test("classifier suppression persists without sending instructions or changing tasks", async () => {
    const manager = createSession();
    let checks = 0;
    const tasks = harness(manager, async () => {
      checks++;
      return true;
    });
    await tasks.event("session_start");
    await tasks.call({ action: "set", items: plan });
    const completion = {
      outcome: "completed",
      context: {
        llmMessages: [
          { role: "assistant", content: [{ type: "text", text: "All remaining work is paused." }] },
        ],
      },
    };
    expect(await tasks.event("agent_before_settle", completion)).toEqual({
      entries: [{ type: "custom", customType: TASKS_RECONCILIATION_ENTRY }],
    });
    expect(await tasks.event("agent_before_settle", completion)).toBeUndefined();
    expect(checks).toBe(1);
    expect((await tasks.call({ action: "list" })).details?.items).toEqual(plan);
    manager.appendCustomEntry(TASKS_RECONCILIATION_ENTRY);
    const reloaded = harness(manager, async () => {
      checks++;
      return false;
    });
    await reloaded.event("session_start", { reason: "reload" });
    expect(await reloaded.event("agent_before_settle", completion)).toBeUndefined();
    expect(checks).toBe(1);
    manager.appendMessage({ role: "user", content: "Continue", timestamp: Date.now() });
    await reloaded.event("session_start", { reason: "reload" });
    expect(await reloaded.event("agent_before_settle", completion)).toMatchObject({
      continue: true,
    });
    expect(checks).toBe(2);
  });

  test.each(["task", "clear", "session", "tree", "shutdown", "abort", "transcript", "extension"])(
    "discards an in-flight decision after a %s change",
    async (change) => {
      const manager = createSession();
      const branchPoint = manager.getLeafId();
      if (branchPoint === null) throw new Error("Missing initial user entry");
      let resolveDecision!: (value: boolean) => void;
      let inferenceSignal: AbortSignal | undefined;
      const tasks = harness(manager, (_ctx, _items, _text, signal) => {
        inferenceSignal = signal;
        return new Promise<boolean>((resolve) => {
          resolveDecision = resolve;
        });
      });
      await tasks.event("session_start");
      await tasks.call({ action: "set", items: plan });
      const completion = {
        outcome: "completed",
        context: {
          llmMessages: [{ role: "assistant", content: [{ type: "text", text: "Done." }] }],
        },
      };
      const pending = tasks.event("agent_before_settle", completion);
      expect(await tasks.event("agent_before_settle", completion)).toBeUndefined();
      switch (change) {
        case "task":
          await tasks.call({ action: "update", id: "inspect", status: "completed" });
          break;
        case "clear":
          await tasks.command("clear");
          break;
        case "session":
          tasks.setSession(createSession("new"));
          await tasks.event("session_start");
          break;
        case "tree":
          manager.branch(branchPoint);
          await tasks.event("session_tree");
          break;
        case "shutdown":
          await tasks.event("session_shutdown");
          break;
        case "abort":
          tasks.abortRun();
          break;
        case "transcript":
          manager.appendMessage({ role: "user", content: "New context", timestamp: Date.now() });
          break;
        case "extension":
          await tasks.event("input", { source: "extension", text: "New extension context" });
          break;
      }
      if (change !== "transcript") expect(inferenceSignal?.aborted).toBe(true);
      resolveDecision(false);
      expect(await pending).toBeUndefined();
    },
  );

  test("does not check an empty or completed plan or an unsuccessful run", async () => {
    let checks = 0;
    const tasks = harness(createSession(), async () => {
      checks++;
      return false;
    });
    await tasks.event("session_start");
    const completion = { outcome: "completed", context: { llmMessages: [] } };
    expect(await tasks.event("agent_before_settle", completion)).toBeUndefined();
    await tasks.call({
      action: "set",
      items: plan.map((item) => ({ ...item, status: "completed" })),
    });
    expect(await tasks.event("agent_before_settle", completion)).toBeUndefined();
    await tasks.call({ action: "set", items: plan });
    for (const outcome of ["aborted", "error"]) {
      expect(await tasks.event("agent_before_settle", { ...completion, outcome })).toBeUndefined();
    }
    expect(checks).toBe(0);
  });

  test("does not classify old assistant text as the final response", async () => {
    const captured: string[] = [];
    const tasks = harness(createSession(), async (_ctx, _items, response) => {
      captured.push(response);
      return false;
    });
    await tasks.event("session_start");
    await tasks.call({ action: "set", items: plan });
    const oldResponse = {
      role: "assistant",
      content: [{ type: "text", text: "Previous work is paused." }],
    };
    for (const last of [
      { role: "assistant", content: [{ type: "toolCall", name: "tasks" }] },
      { role: "user", content: "A new request" },
    ]) {
      await tasks.event("input", { source: "interactive", text: "Next request" });
      await tasks.event("agent_before_settle", {
        outcome: "completed",
        context: { llmMessages: [oldResponse, last] },
      });
    }
    expect(captured).toEqual(["", ""]);
  });

  test("lists, replaces the full plan, updates one item, and rejects invalid input", async () => {
    const tasks = harness(createSession());
    await tasks.event("session_start", { reason: "startup" });
    expect(resultText(await tasks.call({ action: "list" }))).toBe("No tasks.");

    const setResult = await tasks.call({ action: "set", items: plan });
    expect(resultText(setResult)).toContain("#test Add regression tests [in_progress]");
    expect(resultText(await tasks.call({ action: "list" }))).toBe(
      "#inspect Inspect current behavior [pending]\n#test Add regression tests [in_progress]",
    );
    await tasks.call({ action: "set", items: [inspectTask] });
    expect(resultText(await tasks.call({ action: "list" }))).toBe(
      "#inspect Inspect current behavior [pending]",
    );
    const updateResult = await tasks.call({ action: "update", id: "inspect", status: "completed" });
    expect(resultText(updateResult)).toContain("#inspect Inspect current behavior [completed]");
    expect(resultText(await tasks.call({ action: "list" }))).toBe(
      "#inspect Inspect current behavior [completed]",
    );

    await expect(tasks.call({ action: "set", items: [inspectTask, inspectTask] })).rejects.toThrow(
      "Duplicate task id: inspect",
    );
    await expect(
      tasks.call({ action: "update", id: "missing", status: "completed" }),
    ).rejects.toThrow("Task not found: missing");
    await expect(tasks.call({ action: "update", id: "inspect" })).rejects.toThrow(
      "update requires a title or status",
    );
    expect(
      Value.Check(TasksParameters, {
        action: "set",
        items: [{ id: "x", title: "Bad status", status: "blocked" }],
      }),
    ).toBe(false);
  });

  test("shows the compact progress widget and /tasks view and clear commands", async () => {
    const manager = createSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call({ action: "set", items: plan });
    expect(formatProgress(plan)).toBe("2 tasks (0 done, 1 in progress, 1 open)");
    expect(tasks.widgets.at(-1)).toBeTypeOf("function");

    await tasks.command("view");
    expect(tasks.customViews).toBe(1);
    await tasks.command("clear");
    expect(resultText(await tasks.call({ action: "list" }))).toBe("No tasks.");
    expect(tasks.widgets.at(-1)).toBeUndefined();
    expect(tasks.notifications.at(-1)).toBe("Task plan cleared");
    expect(manager.getBranch().filter((entry) => entry.type === "custom")).toHaveLength(2);
  });

  test("isolates a new session and ignores legacy pi-tasks entries", async () => {
    const first = createSession();
    const tasks = harness(first);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call({ action: "set", items: plan });

    const fresh = createSession("fresh");
    fresh.appendCustomEntry("pi-tasks-state", { tasks: [{ id: "old", subject: "Legacy" }] });
    tasks.setSession(fresh);
    await tasks.event("session_start", { reason: "new" });
    expect(resultText(await tasks.call({ action: "list" }))).toBe("No tasks.");
    await tasks.call({ action: "set", items: [inspectTask] });
    expect(resultText(await tasks.call({ action: "list" }))).toContain("#inspect");
  });

  test("restores its versioned custom snapshot after reload and resume outside model context", async () => {
    const manager = createSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call({ action: "set", items: plan });
    expect(resultText(await tasks.call({ action: "list" }))).toContain("#test");

    await tasks.event("session_start", { reason: "reload" });
    expect(resultText(await tasks.call({ action: "list" }))).toContain("#test");
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Session file was not created");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain(`"customType":"${TASKS_STATE_ENTRY}"`);
    expect(readFileSync(file, "utf8")).toContain(`"schema":"${TASKS_STATE_SCHEMA}"`);
    expect(
      manager
        .buildSessionContext()
        .messages.map((message) => JSON.stringify(message))
        .join("\n"),
    ).not.toContain("Inspect current behavior");

    const resumed = harness(SessionManager.open(file));
    await resumed.event("session_start", { reason: "resume" });
    expect(resultText(await resumed.call({ action: "list" }))).toContain("#test");
  });

  test("restores the selected ancestry when forking", async () => {
    const manager = createSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call({ action: "set", items: plan });
    const forkPoint = manager.getLeafId();
    if (forkPoint === null) throw new Error("Missing fork point");
    await tasks.call({
      action: "set",
      items: [{ id: "other", title: "Only on the parent tip", status: "pending" }],
    });

    const forkFile = manager.createBranchedSession(forkPoint);
    if (forkFile === undefined) throw new Error("Fork session was not created");
    const forked = harness(SessionManager.open(forkFile));
    await forked.event("session_start", { reason: "fork" });
    expect(resultText(await forked.call({ action: "list" }))).toContain("#test");
    expect(resultText(await forked.call({ action: "list" }))).not.toContain(
      "Only on the parent tip",
    );
  });

  test("restores the matching snapshot after session-tree navigation", async () => {
    const manager = createSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call({ action: "set", items: plan });
    const pendingPoint = manager.getLeafId();
    if (pendingPoint === null) throw new Error("Missing branch point");
    await tasks.call({ action: "update", id: "inspect", status: "completed" });

    manager.branch(pendingPoint);
    await tasks.event("session_tree");
    expect(resultText(await tasks.call({ action: "list" }))).toContain("[pending]");
    expect(resultText(await tasks.call({ action: "list" }))).not.toContain("[completed]");
  });
});
