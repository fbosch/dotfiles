import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import tasksExtension, {
  formatProgress,
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

function harness(initialManager: SessionManager) {
  let manager = initialManager;
  const events = new Map<string, EventHandler>();
  const commands = new Map<string, CommandHandler>();
  const widgets: unknown[] = [];
  const notifications: string[] = [];
  let customViews = 0;
  let tool: RegisteredTaskTool | undefined;
  const context = {
    cwd,
    hasUI: true,
    mode: "tui",
    get sessionManager() {
      return manager;
    },
    ui: {
      setWidget: (_key: string, content: unknown) => widgets.push(content),
      notify: (message: string) => notifications.push(message),
      async custom() {
        customViews++;
      },
    },
  };
  const pi = {
    appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data),
    on: (event: string, handler: EventHandler) => events.set(event, handler),
    registerTool: (definition: RegisteredTaskTool) => {
      tool = definition;
    },
    registerCommand: (_name: string, definition: { handler: CommandHandler }) =>
      commands.set("tasks", definition.handler),
  } as unknown as ExtensionAPI;
  tasksExtension(pi);

  return {
    context,
    widgets,
    notifications,
    get customViews() {
      return customViews;
    },
    setSession(next: SessionManager) {
      manager = next;
    },
    async event(name: string, value: object = {}) {
      await events.get(name)?.(value as never, context as unknown as ExtensionContext);
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
    expect(formatProgress(plan)).toBe("Tasks 0/2 done · 1 in progress");
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
