import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import sessionHistory from "../index";
import { header, tempDir, user, writeSession } from "./fixtures";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type ToolContext = Parameters<ToolDefinition["execute"]>[4];

const cleanup: string[] = [];

afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function harness() {
  const root = tempDir("history-sessions-");
  const indexDirectory = tempDir("history-index-");
  cleanup.push(root, indexDirectory);
  const handlers = new Map<string, Handler>();
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI;
  let sessionFile: string | undefined;
  const ctx = {
    cwd: "/work",
    sessionManager: {
      getSessionId: () => "current",
      getSessionFile: () => sessionFile,
      getSessionDir: () => `${root}/--work--`,
    },
  } as unknown as ToolContext;
  sessionHistory(pi, { indexDirectory, sessionsRoot: () => root });
  const fire = async (event: string) => handlers.get(event)?.({ type: event }, ctx);
  const run = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    const result = await tool.execute("call", params as never, undefined, undefined, ctx);
    const first = result.content[0];
    return first?.type === "text" ? first.text : "";
  };
  return { root, tools, fire, run, setSessionFile: (path: string) => (sessionFile = path) };
}

async function settle(run: (name: string, params: Record<string, unknown>) => Promise<string>) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const text = await run("history_search", { query: "probe" });
    if (!text.includes("Index updating")) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("reconciliation did not finish");
}

describe("session-history extension", () => {
  test("registers both tools as deferred", () => {
    const { tools } = harness();
    expect([...tools.values()].map((tool) => [tool.name, tool.exposure])).toEqual([
      ["history_search", "deferred"],
      ["history_read", "deferred"],
    ]);
  });

  test("session_start returns before reconciliation and searches report the updating index", async () => {
    const { root, fire, run } = harness();
    for (let index = 0; index < 20; index++)
      writeSession(root, `--p${index}--`, `s${index}`, [
        header(`s${index}`, "/p"),
        user(`needle ${index}`),
      ]);
    const started = fire("session_start");
    expect(started).toBeInstanceOf(Promise);
    expect(await run("history_search", { query: "needle" })).toContain("Index updating");
    await settle(run);
    expect(await run("history_search", { query: "needle" })).not.toContain("Index updating");
    await fire("session_shutdown");
  });

  test("indexes the finished turn on agent_end and schedules no periodic work", async () => {
    const { root, fire, run, setSessionFile } = harness();
    const path = writeSession(root, "--work--", "other", [header("other", "/work")]);
    const interval = spyOn(globalThis, "setInterval");
    await fire("session_start");
    await settle(run);
    writeSession(root, "--work--", "other", [header("other", "/work"), user("late arrival")]);
    setSessionFile(path);
    await fire("agent_end");
    expect(await run("history_search", { query: "arrival" })).toContain("session other");
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
    await fire("session_shutdown");
  });

  test("history_read rejects combining question and around", async () => {
    const { fire, run } = harness();
    await fire("session_start");
    await expect(run("history_read", { session: "x", question: "q", around: "m" })).rejects.toThrow(
      "Provide question or around, not both.",
    );
    await fire("session_shutdown");
  });
});
