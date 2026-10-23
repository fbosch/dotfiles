import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { registerSubagentHost, type HostDependencies } from "../host";
import { HISTORY_ENTRY, type SavedWorker } from "../history";
import { processCleanupHealth } from "../health";
import type { ChildDriver, ChildExecutionOutcome } from "../owner";
import { TuiAltScreen, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { ParentRuntime } from "../parent-runtime";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const report = "evidence ".repeat(10_000) + "FINAL_CAVEAT";
function saved(parentSessionId: string): SavedWorker {
  return { version: 1, worker: {
    parentSessionId, id: "saved-worker", specialist: "fixture", createdAt: 0, status: "idle", liveSession: "available", currentAssignmentId: "assignment",
    config: { name: "fixture", description: "Fixture", prompt: "Fixture", model: "fixture/model", maxTurns: 12, tools: ["read"], excludeTools: [], extensions: [], skills: [] },
    assignments: [{ id: "assignment", prompt: "Task", outcome: "completed", maxTurns: 12, turnsUsed: 1, remainingTurns: 11, persistence: "saved", report, transcript: [{ role: "tool", text: "Detailed investigation", timestamp: 0 }] }],
  } };
}
async function fixture(seed?: (manager: SessionManager) => void, dependencies: HostDependencies = {}) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-subagent-host-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off" });
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: join(cwd, "models.json"), modelsStorePath: join(cwd, "catalog.json"), refreshOnCreate: false, allowModelNetwork: false });
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir: cwd, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [(pi) => registerSubagentHost(pi, { agentDir: cwd }, dependencies)],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const manager = sdk.SessionManager.create(cwd, cwd);
  manager.appendMessage({ role: "user", content: "Parent fixture", timestamp: 0 });
  manager.appendMessage({
    role: "assistant", content: [{ type: "text", text: "Ready" }], api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  seed?.(manager);
  const { session } = await sdk.createAgentSession({ cwd, agentDir: cwd, settingsManager, modelRuntime, resourceLoader: loader, sessionManager: manager, tools: ["subagent", "subagent_result", "subagent_control"], excludeTools: ["mcp__*"] });
  const errors: string[] = [];
  cleanup.push(async () => { await session.abort(); await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); session.dispose(); });
  await session.bindExtensions({ onError: (error) => { errors.push(error.error); } });
  expect(errors).toEqual([]);
  return { session, errors };
}
function call(session: AgentSession, name: string, args: Record<string, string | Record<string, string>>) {
  const tool = session.agent.state.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  session.agent.state.messages = [{
    role: "assistant", content: [{ type: "toolCall", id: "fixture-call", name, arguments: args }],
    api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "toolUse", timestamp: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }];
  return tool.execute("fixture-call", args, new AbortController().signal);
}

test("native host registers only the three parent tools and rejects foreign control", async () => {
  const { session, errors } = await fixture();
  expect(session.getCallableToolNames().sort()).toEqual(["subagent", "subagent_control", "subagent_result"]);
  const status = await call(session, "subagent_result", { request: { mode: "status" } });
  expect(status.content).toEqual([{ type: "text", text: "[]" }]);
  await expect(call(session, "subagent_control", { request: { action: "cancel", workerId: "foreign" } })).rejects.toThrow();
  expect(errors).toEqual([]);
});

test("native reload restores complete historical evidence without reviving workers", async () => {
  const { session, errors } = await fixture((manager) => manager.appendCustomEntry(HISTORY_ENTRY, saved(manager.getSessionId())));
  await session.reload();
  const evidence = await call(session, "subagent_result", { request: { mode: "report", workerId: "saved-worker" } });
  expect(evidence.content).toEqual([{ type: "text", text: report }]);
  const status = await call(session, "subagent_result", { request: { mode: "status", workerId: "saved-worker" } });
  expect(JSON.stringify(status.content)).toContain("historical");
  await expect(call(session, "subagent_control", { request: { action: "continue", workerId: "saved-worker", prompt: "Resume" } })).rejects.toThrow();
  expect(errors).toEqual([]);
});

test("fork-copied evidence does not grant control over the originating parent's workers", async () => {
  const { session, errors } = await fixture((manager) => manager.appendCustomEntry(HISTORY_ENTRY, saved("other-parent")));
  const status = await call(session, "subagent_result", { request: { mode: "status" } });
  expect(status.content).toEqual([{ type: "text", text: "[]" }]);
  await expect(call(session, "subagent_result", { request: { mode: "report", workerId: "saved-worker" } })).rejects.toThrow();
  expect(errors).toEqual([]);
});


function controlledDriver(options: { holdClose?: boolean; uncertainClose?: boolean } = {}) {
  const runs = new Map<string, (outcome: ChildExecutionOutcome) => void>();
  const updates = new Map<string, (text: string) => void>();
  const aborted: string[] = [];
  let releaseClose = () => {};
  const gate = new Promise<void>((resolve) => { releaseClose = resolve; });
  let starts = 0;
  const driver: ChildDriver & { observation: () => undefined } = {
    start(input, callbacks) {
      starts++;
      updates.set(input.workerId, callbacks.onUpdate);
      callbacks.onTranscript({ role: "tool", text: "PARTIAL_LIFECYCLE_EVIDENCE" });
      return new Promise((finish) => { runs.set(input.workerId, finish); });
    },
    prompt(input, callbacks) { return this.start(input, callbacks); },
    async steer() {},
    async abort(id) { aborted.push(id); runs.get(id)?.({ kind: "failed", turnsUsed: 0, error: "Aborted" }); },
    async close() {
      if (options.holdClose) await gate;
      return options.uncertainClose ? { confirmed: false, diagnostic: "Fixture shutdown unconfirmed" } : { confirmed: true };
    },
    observation: () => undefined,
  };
  const health = processCleanupHealth({});
  const dependencies: HostDependencies = { createDriver: () => driver, resolve: async () => saved("fixture").worker.config, health };
  return {
    dependencies, health, aborted, releaseClose, starts: () => starts,
    finish: (id: string, outcome: ChildExecutionOutcome) => runs.get(id)?.(outcome),
    update: (id: string, text: string) => updates.get(id)?.(text),
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function workerId(result: Awaited<ReturnType<typeof call>>): string {
  const block = result.content.find((item) => item.type === "text");
  const parsed: unknown = block?.type === "text" ? JSON.parse(block.text) : undefined;
  if (typeof parsed !== "object" || parsed === null || !("workerId" in parsed) || typeof parsed.workerId !== "string") throw new Error("No worker launch ID");
  return parsed.workerId;
}

function assignmentId(result: Awaited<ReturnType<typeof call>>): string {
  const block = result.content.find((item) => item.type === "text");
  const parsed: unknown = block?.type === "text" ? JSON.parse(block.text) : undefined;
  if (typeof parsed !== "object" || parsed === null || !("assignmentId" in parsed) || typeof parsed.assignmentId !== "string") throw new Error("No worker assignment ID");
  return parsed.assignmentId;
}

test("declining a native switch preserves active work; confirmation defers teardown until actual shutdown", async () => {
  const controlled = controlledDriver();
  const { session, errors } = await fixture(undefined, controlled.dependencies);
  const id = workerId(await call(session, "subagent", { specialist: "fixture", prompt: "Keep working" }));
  let confirmed = false;
  let confirmations = 0;
  session.extensionRunner.setUIContext({ ...session.extensionRunner.createContext().ui, confirm: async () => { confirmations++; return confirmed; } }, "rpc");
  expect(await session.extensionRunner.emit({ type: "session_before_switch", reason: "new" })).toEqual({ cancel: true });
  expect(confirmations).toBe(1);
  expect(controlled.aborted).toEqual([]);
  expect(JSON.stringify(await call(session, "subagent_result", { request: { mode: "status", workerId: id } }))).toContain("running");
  confirmed = true;
  expect(await session.extensionRunner.emit({ type: "session_before_switch", reason: "new" })).toBeUndefined();
  expect(controlled.aborted).toEqual([]);
  await session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
  expect(controlled.aborted).toEqual([id]);
  expect(errors).toEqual([]);
});

test("native reload waits for six active children, cancels the queue, and restores partial evidence as history", async () => {
  const controlled = controlledDriver({ holdClose: true });
  const { session, errors } = await fixture(undefined, controlled.dependencies);
  const reloadWarnings: string[] = [];
  session.extensionRunner.setUIContext({ ...session.extensionRunner.createContext().ui, notify: (message, type) => {
    expect(type).toBe("warning");
    expect(controlled.aborted).toEqual([]);
    reloadWarnings.push(message);
  } }, "rpc");
  cleanup.push(async () => { controlled.releaseClose(); });
  const ids: string[] = [];
  for (let index = 0; index < 7; index++) ids.push(workerId(await call(session, "subagent", { specialist: "fixture", prompt: `Assignment ${index}` })));
  expect(controlled.starts()).toBe(6);
  let reloaded = false;
  const reload = session.reload().then(() => { reloaded = true; });
  await tick();
  expect(reloaded).toBe(false);
  expect(controlled.aborted).toHaveLength(6);
  controlled.releaseClose();
  await reload;
  expect(reloadWarnings).toEqual(["Reloading Pi will stop 7 subagent workers. Interrupted assignments cannot resume."]);
  expect(controlled.starts()).toBe(6);
  const status = await call(session, "subagent_result", { request: { mode: "status", workerId: ids[0]! } });
  expect(JSON.stringify(status)).toContain("historical");
  expect(JSON.stringify(status)).toContain("cancelled");
  expect(JSON.stringify(status)).toContain("saved");
  const transcript = await call(session, "subagent_result", { request: { mode: "transcript", workerId: ids[0]! } });
  expect(JSON.stringify(transcript)).toContain("PARTIAL_LIFECYCLE_EVIDENCE");
  await expect(call(session, "subagent_control", { request: { action: "continue", workerId: ids[0]!, prompt: "Resume" } })).rejects.toThrow();
  expect(errors).toEqual([]);
});

test("uncertain child cleanup remains a delegation block after native reload", async () => {
  const controlled = controlledDriver({ uncertainClose: true });
  const { session, errors } = await fixture(undefined, controlled.dependencies);
  await call(session, "subagent", { specialist: "fixture", prompt: "Task" });
  await session.reload();
  expect(controlled.health.isBlocked()).toBe(true);
  expect(controlled.health.diagnostics()[0]?.diagnostic).toContain("Fixture shutdown unconfirmed");
  await expect(call(session, "subagent", { specialist: "fixture", prompt: "New task" })).rejects.toThrow("cleanup uncertainty");
  expect(controlled.starts()).toBe(1);
  expect(errors).toEqual([]);
});

test("completion updates the mounted worker card while retaining a hidden model notification", async () => {
  sdk.initTheme("dark", false);
  const controlled = controlledDriver();
  let runtime: ParentRuntime | undefined;
  const { session } = await fixture(undefined, { ...controlled.dependencies, runtimeChanged: (value) => { runtime = value; } });
  const launched = await call(session, "subagent", { specialist: "fixture", prompt: "Task" });
  const id = workerId(launched);
  const ui = new TuiAltScreen({
    columns: 100, rows: 30, kittyProtocolActive: false,
    start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {},
    clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
  }, false);
  const card = new sdk.ToolExecutionComponent("subagent", "launch", { specialist: "fixture", prompt: "Task" }, {}, session.extensionRunner.getToolDefinition("subagent"), ui, "/tmp");
  card.updateResult({ ...launched, isError: false });
  expect(card.render(100).map(stripTerminalSequences).join("\n")).toContain("running");
  await tick();
  if (!runtime) throw new Error("Missing runtime");
  const done = runtime.delivery.owner.wait(id, runtime.delivery.owner.inspect(id).currentAssignmentId);
  controlled.finish(id, { kind: "completed", turnsUsed: 1, report: "CARD_OK" });
  await done;
  await tick();
  const lines = card.render(100).map(stripTerminalSequences).join("\n");
  expect(lines).toContain("completed");
  expect(lines).toContain("CARD_OK");
  const notices = session.sessionManager.getEntries().filter((entry) => entry.type === "custom_message" && entry.customType === "minimal-subagents.notice");
  expect(notices).toHaveLength(1);
  const notice = notices[0];
  if (notice?.type !== "custom_message") throw new Error("Missing completion notification");
  expect(notice.display).toBe(false);
  expect(notice.content).toContain(id);
  expect(notice.content).toContain('"outcome":"completed"');
  expect(session.sessionManager.buildSessionProjection().messages.some((message) => message.role === "custom" && message.customType === "minimal-subagents.notice")).toBe(true);
});
test("a delayed worker update reflects completion at model delivery without losing attribution or text", async () => {
  const controlled = controlledDriver();
  const { session } = await fixture(undefined, controlled.dependencies);
  const launched = await call(session, "subagent", { specialist: "fixture", prompt: "Task" });
  const id = workerId(launched);
  const assignment = assignmentId(launched);
  await tick();
  controlled.update(id, "FIRST_MATERIAL_FINDING");
  controlled.update(id, "SECOND_MATERIAL_FINDING");
  await tick();

  const entries = session.sessionManager.getEntries().filter((entry) =>
    entry.type === "custom_message" && entry.customType === "minimal-subagents.notice"
    && typeof entry.content === "string" && entry.content.includes('"type":"update"'));
  expect(entries).toHaveLength(2);
  const pending = entries.map((entry) => {
    if (entry.type !== "custom_message") throw new Error("Expected a custom update message");
    return { role: "custom" as const, customType: entry.customType, content: entry.content, display: entry.display, details: entry.details, timestamp: 0 };
  });
  const early = await session.extensionRunner.emitContext(pending);
  const earlyText = early.flatMap((message) => message.role === "custom" && typeof message.content === "string" ? [message.content] : []).join("\n");
  expect(earlyText).toContain('"state":"running"');

  controlled.finish(id, { kind: "completed", turnsUsed: 1, report: "DONE" });
  await call(session, "subagent_result", { request: { mode: "wait", workerId: id, assignmentId: assignment } });
  const delivered = await session.extensionRunner.emitContext(pending);
  const deliveredText = delivered.flatMap((message) => message.role === "custom" && typeof message.content === "string" ? [message.content] : []).join("\n");

  expect(deliveredText).toContain('"state":"completed"');
  expect(deliveredText).toContain('"workerId":"' + id + '"');
  expect(deliveredText).toContain('"assignmentId":');
  expect(deliveredText).toContain("FIRST_MATERIAL_FINDING");
  expect(deliveredText).toContain("SECOND_MATERIAL_FINDING");
  expect(entries.map((entry) => entry.type === "custom_message" ? entry.content : "").join("\n").toLowerCase()).toContain('"state":"running"');
});

test("reload still stops workers and restores history when its warning cannot be displayed", async () => {
  const controlled = controlledDriver();
  const { session, errors } = await fixture(undefined, controlled.dependencies);
  const id = workerId(await call(session, "subagent", { specialist: "fixture", prompt: "Task" }));
  const warnings: string[] = [];
  session.extensionRunner.setUIContext({ ...session.extensionRunner.createContext().ui, notify: (message) => {
    expect(controlled.aborted).toEqual([]);
    warnings.push(message);
    throw new Error("RELOAD_WARNING_FAILED");
  } }, "rpc");
  await session.reload();
  expect(controlled.aborted).toEqual([id]);
  expect(warnings).toEqual(["Reloading Pi will stop 1 subagent worker. Interrupted assignments cannot resume."]);
  expect(controlled.health.isBlocked()).toBe(false);
  const status = await call(session, "subagent_result", { request: { mode: "status", workerId: id } });
  expect(JSON.stringify(status)).toContain("historical");
  expect(JSON.stringify(status)).toContain("cancelled");
  const transcript = await call(session, "subagent_result", { request: { mode: "transcript", workerId: id } });
  expect(JSON.stringify(transcript)).toContain("PARTIAL_LIFECYCLE_EVIDENCE");
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("RELOAD_WARNING_FAILED");
});

test("idle reload and ordinary shutdown do not disclose interrupted work", async () => {
  const idle = await fixture();
  const idleWarnings: string[] = [];
  idle.session.extensionRunner.setUIContext({ ...idle.session.extensionRunner.createContext().ui, notify: (message) => { idleWarnings.push(message); } }, "rpc");
  await idle.session.reload();
  expect(idleWarnings).toEqual([]);

  const controlled = controlledDriver();
  const active = await fixture(undefined, controlled.dependencies);
  const warnings: string[] = [];
  active.session.extensionRunner.setUIContext({ ...active.session.extensionRunner.createContext().ui, notify: (message) => { warnings.push(message); } }, "rpc");
  await call(active.session, "subagent", { specialist: "fixture", prompt: "Task" });
  await active.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
  expect(warnings).toEqual([]);
});
