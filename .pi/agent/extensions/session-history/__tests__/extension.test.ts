import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import sessionHistory from "../index";
import { HistoryIndex } from "../lifecycle";
import { header, tempDir, user, writeSession } from "./fixtures";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type ToolContext = Parameters<ToolDefinition["execute"]>[4];

const cleanup: string[] = [];
const indexes: HistoryIndex[] = [];

afterEach(async () => {
  for (const index of indexes.splice(0)) await index.shutdown(undefined);
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

function harness() {
  const root = tempDir("history-sessions-");
  const directory = tempDir("history-index-");
  cleanup.push(root, directory);
  const index = new HistoryIndex(directory);
  indexes.push(index);
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
  sessionHistory(pi, { index, sessionsRoot: () => root });
  const fire = (event: string) => handlers.get(event)?.({ type: event }, ctx);
  const run = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    const result = await tool.execute("call", params as never, undefined, undefined, ctx);
    const first = result.content[0];
    return first?.type === "text" ? first.text : "";
  };
  return { root, index, tools, fire, run, setSessionFile: (path: string) => (sessionFile = path) };
}

describe("session-history extension", () => {
  test("registers both tools as deferred", () => {
    const { tools } = harness();
    expect([...tools.values()].map((tool) => [tool.name, tool.exposure])).toEqual([
      ["history_search", "deferred"],
      ["history_read", "deferred"],
    ]);
  });

  test("session_start returns before reconciliation finishes", async () => {
    const { root, index, fire, run } = harness();
    writeSession(root, "--p--", "s", [header("s", "/p"), user("needle")]);
    expect(fire("session_start")).toBeUndefined();
    expect(await run("history_search", { query: "needle" })).toContain("Index updating");
    await index.reconcile(root);
    expect(await run("history_search", { query: "needle" })).not.toContain("Index updating");
  });

  test("agent_end indexes the current session file", async () => {
    const { root, index, fire, run, setSessionFile } = harness();
    await index.reconcile(root);
    setSessionFile(
      writeSession(root, "--work--", "other", [header("other", "/work"), user("late arrival")]),
    );
    await fire("agent_end");
    expect(await run("history_search", { query: "arrival" })).toContain("session other");
  });

  test("history_read rejects combining question and around", async () => {
    const { run } = harness();
    await expect(run("history_read", { session: "x", question: "q", around: "m" })).rejects.toThrow(
      "Provide question or around, not both.",
    );
  });
});
