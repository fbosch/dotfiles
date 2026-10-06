import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const agentRoot = resolve(import.meta.dir, "../..");
const packageRoot = join(agentRoot, "npm/node_modules/@tintinweb/pi-tasks");
const { default: registerTasks } = await import(
  pathToFileURL(join(packageRoot, "src/index.ts")).href
);
const { loadGlobalTasksConfig, saveGlobalTasksConfig } = await import(
  pathToFileURL(join(packageRoot, "src/tasks-config.ts")).href
);
const { replayTaskState } = await import(
  pathToFileURL(join(packageRoot, "src/session-history.ts")).href
);

interface Result {
  content: { type: string; text?: string }[];
}
interface Context {
  cwd: string;
  sessionManager: SessionManager;
  ui: {
    setWidget(...args: unknown[]): void;
    setStatus(...args: unknown[]): void;
    notify(...args: unknown[]): void;
    select(title: string, choices: string[]): Promise<string | undefined>;
    input(title: string): Promise<string | undefined>;
  };
}
type Handler = (event: Record<string, unknown>, ctx: Context) => unknown;
interface Tool {
  name: string;
  execute(
    id: string,
    args: Record<string, unknown>,
    signal: undefined,
    update: undefined,
    ctx: Context,
  ): Promise<Result>;
}
interface Command {
  handler(args: string, ctx: Context): Promise<void>;
}
interface Snapshot {
  nextId: number;
  tasks: { id: string; status: string; metadata: Record<string, unknown> }[];
}

let directory: string;
let cwd: string;
let globalDir: string;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalTasks = process.env.PI_TASKS;
interface Harness {
  ctx: Context;
  selections: (string | undefined)[];
  inputs: (string | undefined)[];
  event(name: string, data?: Record<string, unknown>): Promise<void>;
  call(name: string, args?: Record<string, unknown>): Promise<string>;
  command(): Promise<void>;
  busEvent(name: string, data: unknown): Promise<void>;
  snapshot(): Snapshot;
  deferSpawns(): void;
  waitForSpawn(): Promise<void>;
  replySpawn(success: boolean): Promise<void>;
}
const harnesses: Harness[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-tasks-history-"));
  cwd = join(directory, "workspace");
  globalDir = join(directory, "agent");
  mkdirSync(cwd);
  mkdirSync(globalDir);
  process.env.PI_CODING_AGENT_DIR = globalDir;
  delete process.env.PI_TASKS;
  writeFileSync(
    join(globalDir, "tasks-config.json"),
    '{"taskScope":"session-history","autoClearCompleted":"never"}',
  );
});

afterEach(async () => {
  for (const item of harnesses.splice(0)) await item.event("session_shutdown");
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalTasks === undefined) delete process.env.PI_TASKS;
  else process.env.PI_TASKS = originalTasks;
  rmSync(directory, { recursive: true, force: true });
});

function persistedSession(): SessionManager {
  const manager = SessionManager.create(cwd, join(directory, "sessions"));
  manager.appendMessage({ role: "user", content: "Track this work", timestamp: Date.now() });
  return manager;
}

function harness(manager: SessionManager) {
  const handlers = new Map<string, Handler[]>();
  const bus = new Map<string, ((data: unknown) => unknown)[]>();
  const tools = new Map<string, Tool>();
  const commands = new Map<string, Command>();
  const selections: (string | undefined)[] = [];
  const inputs: (string | undefined)[] = [];
  const spawnRequests: string[] = [];
  const spawnWaiters: (() => void)[] = [];
  let deferredSpawns = false;
  let spawned = 0;
  const ctx: Context = {
    cwd,
    sessionManager: manager,
    ui: {
      setWidget() {},
      setStatus() {},
      notify() {},
      async select() {
        return selections.shift();
      },
      async input() {
        return inputs.shift();
      },
    },
  };
  registerTasks({
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => {};
    },
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: Command) {
      commands.set(name, command);
    },
    appendEntry(type: string, data: unknown) {
      ctx.sessionManager.appendCustomEntry(type, data);
    },
    events: {
      on(name: string, callback: (data: unknown) => unknown) {
        bus.set(name, [...(bus.get(name) ?? []), callback]);
        return () =>
          bus.set(
            name,
            (bus.get(name) ?? []).filter((item) => item !== callback),
          );
      },
      emit(name: string, data: { requestId?: string }) {
        if (name === "subagents:rpc:ping") {
          for (const callback of bus.get(`${name}:reply:${data.requestId}`) ?? [])
            callback({ data: { version: 2 } });
        }
        if (name === "subagents:rpc:spawn") {
          if (!data.requestId) throw new Error("Missing spawn request ID");
          if (deferredSpawns) {
            spawnRequests.push(data.requestId);
            spawnWaiters.shift()?.();
          } else {
            spawned++;
            for (const callback of bus.get(`${name}:reply:${data.requestId}`) ?? []) {
              callback({ success: true, data: { id: `spawned-agent-${spawned}` } });
            }
          }
        }
      },
    },
  });
  const result = {
    ctx,
    selections,
    inputs,
    async event(name: string, data: Record<string, unknown> = {}) {
      for (const handler of handlers.get(name) ?? []) await handler(data, ctx);
    },
    async call(name: string, args: Record<string, unknown> = {}) {
      await this.event("tool_execution_start", { toolName: name });
      const tool = tools.get(name);
      if (!tool) throw new Error(`Missing tool ${name}`);
      const output = await tool.execute("test", args, undefined, undefined, ctx);
      return output.content.map((part) => part.text ?? "").join("\n");
    },
    async command() {
      const command = commands.get("tasks");
      if (!command) throw new Error("Missing tasks command");
      await command.handler("", ctx);
    },
    async busEvent(name: string, data: unknown) {
      for (const callback of bus.get(name) ?? []) await callback(data);
    },
    snapshot(): Snapshot {
      return replayTaskState(ctx);
    },
    deferSpawns() {
      deferredSpawns = true;
    },
    waitForSpawn(): Promise<void> {
      if (spawnRequests.length) return Promise.resolve();
      return new Promise((resolve) => spawnWaiters.push(resolve));
    },
    async replySpawn(success: boolean) {
      const requestId = spawnRequests.shift();
      if (!requestId) throw new Error("No pending spawn request");
      await this.busEvent(
        `subagents:rpc:spawn:reply:${requestId}`,
        success
          ? { success: true, data: { id: "delayed-worker-id" } }
          : { success: false, error: "Spawn failed" },
      );
    },
  };
  harnesses.push(result);
  return result;
}

const createArgs = { subject: "First task", description: "Do the work" };

describe("pi-tasks session history", () => {
  test("persists mutations in the real session file, resumes and reloads without sidecar files", async () => {
    const manager = persistedSession();
    const first = harness(manager);
    await first.event("session_start", { reason: "startup" });
    await first.call("TaskCreate", createArgs);
    await first.call("TaskUpdate", {
      taskId: "1",
      subject: "Updated task",
      metadata: { nested: { value: 1 } },
    });
    const file = manager.getSessionFile();
    if (!file) throw new Error("No session file");
    expect(readFileSync(file, "utf8")).toContain('"customType":"pi-tasks-state"');
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
    expect(existsSync(join(globalDir, "tasks"))).toBe(false);
    const resumed = harness(SessionManager.open(file));
    await resumed.event("session_start", { reason: "resume" });
    expect(await resumed.call("TaskGet", { taskId: "1" })).toContain("Updated task");
    await resumed.event("session_start", { reason: "reload" });
    expect(await resumed.call("TaskCreate", createArgs)).toContain("Task #2 created");
    await resumed.event("session_shutdown");
    const reloaded = harness(resumed.ctx.sessionManager);
    await reloaded.event("session_start", { reason: "reload" });
    expect(await reloaded.call("TaskGet", { taskId: "1" })).toContain("Updated task");
    expect(await reloaded.call("TaskCreate", createArgs)).toContain("Task #3 created");
  });

  test("replays only the active branch and the fork's selected ancestry, not the parent's tip", async () => {
    const manager = persistedSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    const ancestor = manager.getLeafId();
    if (!ancestor) throw new Error("No ancestor");
    await tasks.call("TaskCreate", { subject: "Sibling task", description: "Not on the fork" });
    manager.branch(ancestor);
    await tasks.event("session_tree");
    expect(await tasks.call("TaskList")).not.toContain("Sibling task");
    expect(
      await tasks.call("TaskCreate", { subject: "Branch task", description: "Independent" }),
    ).toContain("Task #2 created");
    manager.createBranchedSession(ancestor);
    await tasks.event("session_start", { reason: "fork" });
    expect(await tasks.call("TaskList")).not.toContain("Branch task");
    expect(await tasks.call("TaskList")).toContain("First task");
  });

  test("clearing or deleting tasks preserves the ID counter across resume", async () => {
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    await tasks.call("TaskUpdate", { taskId: "1", status: "deleted" });
    expect(tasks.snapshot()).toEqual({ nextId: 2, tasks: [] });
    await tasks.event("session_start", { reason: "reload" });
    expect(await tasks.call("TaskCreate", createArgs)).toContain("Task #2 created");
    tasks.selections.push("Clear all (1)", undefined);
    await tasks.command();
    await tasks.event("session_start", { reason: "reload" });
    expect(await tasks.call("TaskCreate", createArgs)).toContain("Task #3 created");
  });

  test("UI task creation and subagent completion persist without a task tool result", async () => {
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    tasks.selections.push("Create task", undefined);
    tasks.inputs.push("UI task", "Created through /tasks");
    await tasks.command();
    expect(tasks.snapshot().tasks).toHaveLength(1);
    await tasks.call("TaskUpdate", {
      taskId: "1",
      status: "in_progress",
      metadata: { agentId: "worker-exact-id" },
    });
    await tasks.event("session_start", { reason: "reload" });
    await tasks.busEvent("subagents:completed", { id: "worker-exact-id", result: "Done" });
    expect(tasks.snapshot().tasks[0]).toMatchObject({
      status: "completed",
      metadata: { result: "Done" },
    });
    await tasks.event("session_start", { reason: "startup" });
    expect(await tasks.call("TaskGet", { taskId: "1" })).toContain("completed");
  });

  test("automatic cleanup persists an empty snapshot with the next ID intact", async () => {
    writeFileSync(
      join(globalDir, "tasks-config.json"),
      '{"taskScope":"session-history","autoClearCompleted":"on_task_complete"}',
    );
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    await tasks.call("TaskUpdate", { taskId: "1", status: "completed" });
    for (let turn = 0; turn < 5; turn++) await tasks.event("turn_start");
    expect(tasks.snapshot()).toEqual({ nextId: 2, tasks: [] });
    await tasks.event("session_start", { reason: "reload" });
    expect(await tasks.call("TaskCreate", createArgs)).toContain("Task #2 created");
  });

  test("snapshots are immutable even when nested metadata is changed later", async () => {
    const manager = persistedSession();
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", { ...createArgs, metadata: { nested: { value: "before" } } });
    const ancestor = manager.getLeafId();
    if (!ancestor) throw new Error("No ancestor");
    await tasks.call("TaskUpdate", { taskId: "1", metadata: { nested: { value: "after" } } });
    manager.branch(ancestor);
    await tasks.event("session_tree");
    expect(tasks.snapshot().tasks[0]?.metadata.nested).toEqual({ value: "before" });
    await tasks.call("TaskUpdate", { taskId: "1", metadata: { nested: { value: "branch" } } });
    manager.branch(ancestor);
    await tasks.event("session_compact");
    expect(tasks.snapshot().tasks[0]?.metadata.nested).toEqual({ value: "before" });
  });

  test("new sessions reset tasks and IDs, while --no-session performs no disk writes", async () => {
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    tasks.ctx.sessionManager = SessionManager.inMemory(cwd);
    await tasks.event("session_start", { reason: "new" });
    expect(await tasks.call("TaskList")).not.toContain("First task");
    expect(await tasks.call("TaskCreate", createArgs)).toContain("Task #1 created");
    expect(tasks.ctx.sessionManager.getSessionFile()).toBeUndefined();
    await tasks.event("session_compact");
    expect(await tasks.call("TaskGet", { taskId: "1" })).toContain("First task");
    expect(tasks.snapshot().nextId).toBe(2);
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
    expect(existsSync(join(globalDir, "tasks"))).toBe(false);
  });

  test("memory mode and explicit PI_TASKS=off do not persist and clear on /new", async () => {
    for (const mode of ["memory", "off"]) {
      writeFileSync(
        join(globalDir, "tasks-config.json"),
        JSON.stringify({ taskScope: mode === "memory" ? "memory" : "session-history" }),
      );
      if (mode === "off") process.env.PI_TASKS = "off";
      const tasks = harness(persistedSession());
      await tasks.event("session_start", { reason: "startup" });
      await tasks.call("TaskCreate", createArgs);
      expect(tasks.snapshot()).toEqual({ nextId: 1, tasks: [] });
      tasks.ctx.sessionManager = persistedSession();
      await tasks.event("session_start", { reason: "new" });
      expect(await tasks.call("TaskList")).not.toContain("First task");
    }
  });

  test("explicit shared-list override remains file-backed, without history snapshots", async () => {
    const sharedFile = join(directory, "shared-tasks.json");
    process.env.PI_TASKS = sharedFile;
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    expect(JSON.parse(readFileSync(sharedFile, "utf8")).tasks).toHaveLength(1);
    expect(tasks.snapshot()).toEqual({ nextId: 1, tasks: [] });
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
  });

  test("global settings preserve glyphs and do not read or write project overrides", async () => {
    mkdirSync(join(cwd, ".pi"));
    const projectConfig = join(cwd, ".pi/tasks-config.json");
    writeFileSync(projectConfig, '{"taskScope":"project","maxVisible":99}');
    saveGlobalTasksConfig({
      taskScope: "session-history",
      maxVisible: 5,
      glyphs: { spinner: ["◼"] },
    });
    expect(loadGlobalTasksConfig()).toEqual({
      taskScope: "session-history",
      maxVisible: 5,
      glyphs: { spinner: ["◼"] },
    });
    const tasks = harness(persistedSession());
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    expect(readFileSync(projectConfig, "utf8")).toBe('{"taskScope":"project","maxVisible":99}');
    expect(existsSync(join(cwd, ".pi/tasks"))).toBe(false);
  });
  test.each([true, false])(
    "delayed TaskExecute reply cannot mutate a sibling branch (success=%s)",
    async (success) => {
      const manager = persistedSession();
      const root = manager.getLeafId();
      if (!root) throw new Error("No root");
      const tasks = harness(manager);
      await tasks.event("session_start", { reason: "startup" });
      await tasks.call("TaskCreate", { ...createArgs, agentType: "general" });
      tasks.deferSpawns();
      const execution = tasks.call("TaskExecute", { task_ids: ["1"] });
      await tasks.waitForSpawn();
      manager.branch(root);
      await tasks.event("session_tree");
      await tasks.call("TaskCreate", { subject: "Sibling task", description: "Must stay pending" });
      const before = tasks.snapshot();
      const leaf = manager.getLeafId();
      await tasks.replySpawn(success);
      await execution;
      await tasks.busEvent("subagents:completed", { id: "delayed-worker-id", result: "Done" });
      expect(tasks.snapshot()).toEqual(before);
      expect(manager.getLeafId()).toBe(leaf);
    },
  );

  test.each([true, false])(
    "delayed cascade reply cannot mutate a sibling branch (success=%s)",
    async (success) => {
      saveGlobalTasksConfig({
        taskScope: "session-history",
        autoClearCompleted: "never",
        autoCascade: true,
      });
      const manager = persistedSession();
      const root = manager.getLeafId();
      if (!root) throw new Error("No root");
      const tasks = harness(manager);
      await tasks.event("session_start", { reason: "startup" });
      await tasks.call("TaskCreate", { ...createArgs, agentType: "general" });
      await tasks.call("TaskCreate", {
        subject: "Dependent task",
        description: "Waits for first task",
        agentType: "general",
      });
      await tasks.call("TaskUpdate", { taskId: "2", addBlockedBy: ["1"] });
      await tasks.call("TaskExecute", { task_ids: ["1"] });
      tasks.deferSpawns();
      const completion = tasks.busEvent("subagents:completed", {
        id: "spawned-agent-1",
        result: "Done",
      });
      await tasks.waitForSpawn();
      manager.branch(root);
      await tasks.event("session_tree");
      await tasks.call("TaskCreate", { subject: "Sibling first", description: "Independent" });
      await tasks.call("TaskCreate", {
        subject: "Sibling second",
        description: "Must stay pending",
      });
      const before = tasks.snapshot();
      const leaf = manager.getLeafId();
      await tasks.replySpawn(success);
      await completion;
      await tasks.busEvent("subagents:completed", { id: "delayed-worker-id", result: "Done" });
      expect(tasks.snapshot()).toEqual(before);
      expect(manager.getLeafId()).toBe(leaf);
    },
  );
  test("real compaction preserves task snapshots on disk and through a fresh extension factory", async () => {
    const manager = persistedSession();
    const firstEntry = manager.getLeafId();
    if (!firstEntry) throw new Error("No conversation entry");
    const tasks = harness(manager);
    await tasks.event("session_start", { reason: "startup" });
    await tasks.call("TaskCreate", createArgs);
    await tasks.call("TaskUpdate", {
      taskId: "1",
      owner: "alice",
      metadata: { result: "Partial work" },
    });
    const before = tasks.snapshot();
    manager.appendCompaction("Conversation summary", firstEntry, 100);
    await tasks.event("session_compact");
    expect(tasks.snapshot()).toEqual(before);
    const file = manager.getSessionFile();
    if (!file) throw new Error("No session file");
    const resumed = harness(SessionManager.open(file));
    await resumed.event("session_start", { reason: "startup" });
    expect(resumed.snapshot()).toEqual(before);
    expect(await resumed.call("TaskGet", { taskId: "1" })).toContain("First task");
  });

  test("store snapshots and replay detach nested metadata from live task references", async () => {
    const { TaskStore } = await import(pathToFileURL(join(packageRoot, "src/task-store.ts")).href);
    const store = new TaskStore();
    const snapshots: Snapshot[] = [];
    store.setOnChange((snapshot: Snapshot) => snapshots.push(snapshot));
    const task = store.create("Original", "Work", undefined, { nested: { value: "before" } });
    task.metadata.nested.value = "after";
    store.update(task.id, { subject: "Changed" });
    expect(snapshots[0]?.tasks[0]?.metadata.nested).toEqual({ value: "before" });
    expect(snapshots[1]?.tasks[0]?.metadata.nested).toEqual({ value: "after" });
    store.restore(snapshots[0]);
    store.get(task.id).metadata.nested.value = "restored mutation";
    expect(snapshots[0]?.tasks[0]?.metadata.nested).toEqual({ value: "before" });
  });

  test("settings panel saves only global config when storage is changed", async () => {
    const { openSettingsMenu } = await import(
      pathToFileURL(join(packageRoot, "src/ui/settings-menu.ts")).href
    );
    const config = { taskScope: "session-history", glyphs: { spinner: ["◼"] } };
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    // The host theme is process-global; restore it to keep this TUI-only test isolated.
    const themeKey = Symbol.for("@earendil-works/pi-coding-agent:theme");
    const previousTheme: unknown = Reflect.get(globalThis, themeKey);
    Reflect.set(globalThis, themeKey, theme);
    try {
      await openSettingsMenu(
        {
          async custom(
            factory: (
              tui: object,
              theme: object,
              keys: undefined,
              done: () => void,
            ) => { handleInput(key: string): void },
          ) {
            const panel = factory({}, theme, undefined, () => {});
            panel.handleInput(" ");
          },
        },
        config,
        async () => {},
        4,
      );
    } finally {
      if (previousTheme === undefined) Reflect.deleteProperty(globalThis, themeKey);
      else Reflect.set(globalThis, themeKey, previousTheme);
    }
    expect(loadGlobalTasksConfig()).toEqual({ taskScope: "memory", glyphs: { spinner: ["◼"] } });
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
  });
});
