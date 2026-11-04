import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodemodeExtension,
  createToolSearchExtension,
  type ExtensionAPI,
  type ExtensionToolContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import toolDiscoveryExtension from "../index";

// Exercise Pi's real discovery and sandbox implementations without model or MCP requests.
test("native search loads deferred tools while codemode retains the inactive-direct loader", async () => {
  // Discovery is under test, not Bun’s differing available-memory accounting.
  const memory = spyOn(process, "availableMemory").mockReturnValue(8 * 1024 ** 3);
  const previous = process.env.PI_CODING_AGENT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "native-deferral-"));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      classifier: { toolDiscovery: { enabled: false } },
      toolDiscovery: { deferredToolPrefixes: ["third_party_fetch"] },
    }),
  );
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const tools = new Map<string, ToolDefinition>();
    let active = ["tool_load", "tool_search", "codemode"];
    const pi = {
      registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
      getActiveTools: () => [...active],
      setActiveTools: (names: string[]) => {
        active = [...names];
      },
      getAllTools: () =>
        [...tools.values()].map((tool) => ({
          ...tool,
          exposure: tool.exposure ?? "direct",
          sourceInfo: { source: "local", scope: "user", origin: "top-level", path: directory },
        })),
      on() {},
      appendEntry() {},
    } as unknown as ExtensionAPI;
    const parameters = Type.Object({});
    for (const [name, exposure] of [
      ["chart_pie", "deferred"],
      ["third_party_fetch", "direct"],
    ] as const) {
      pi.registerTool({
        name,
        label: name,
        description: name,
        parameters,
        exposure,
        async execute() {
          return { content: [{ type: "text", text: name }], details: undefined };
        },
      });
    }
    toolDiscoveryExtension(pi);
    createToolSearchExtension()(pi);
    createCodemodeExtension({ models: false })(pi);
    const callable = () =>
      [...tools.values()].filter(
        (tool) =>
          tool.exposure === "deferred" ||
          ((tool.exposure ?? "direct") === "direct" && active.includes(tool.name)),
      );
    const ctx = {
      cwd: directory,
      isProjectTrusted: () => false,
      getSystemPrompt: () => "base prompt",
      sessionManager: {
        getHeader: () => ({}),
        getBranch: () => [],
        getSessionId: () => "native-discovery-test",
      },
      get tools() {
        return callable().map((tool) => ({
          ...tool,
          execute: (id: string, args: Record<string, unknown>) =>
            tool.execute(id, args, undefined, undefined, ctx),
        }));
      },
      async executeTool(name: string, args: Record<string, unknown>) {
        const tool = callable().find((candidate) => candidate.name === name);
        if (!tool) throw new Error(`Tool is not callable: ${name}`);
        const result = await tool.execute("nested", args, undefined, undefined, ctx);
        return {
          toolCall: { id: "nested", type: "toolCall", name, arguments: args },
          result,
          isError: false,
        };
      },
    } as unknown as ExtensionToolContext;
    const search = tools.get("tool_search");
    const codemode = tools.get("codemode");
    if (!search || !codemode) throw new Error("Native frontends were not registered");
    expect(active).not.toContain("chart_pie");
    const miss = await search.execute(
      "search",
      { query: "third_party_fetch", mode: "lookup" },
      undefined,
      undefined,
      ctx,
    );
    expect(miss.details).toEqual({ loaded: [] });
    const prefix = await search.execute(
      "search",
      { query: "chart", mode: "lookup" },
      undefined,
      undefined,
      ctx,
    );
    expect(prefix.details).toEqual({ loaded: [] });
    const found = await search.execute(
      "search",
      { query: "chart_pie", mode: "lookup" },
      undefined,
      undefined,
      ctx,
    );
    expect(found.details).toEqual({ loaded: ["chart_pie"] });
    expect(active).toContain("chart_pie");
    expect(active).not.toContain("webfetch");
    const discovery = await codemode.execute(
      "discover",
      {
        code: `
      const known = await searchTools("chart_pie", { mode: "lookup" });
      if (known.length !== 1 || known[0].name !== "chart_pie") throw new Error("exact lookup missed");
      if ((await searchTools("chart", { mode: "lookup" })).length !== 0) throw new Error("prefix guessed");
      if ((await searchTools("third_party_fetch", { mode: "lookup" })).length !== 0) throw new Error("inactive tool exposed");
      return "lookup verified";
    `,
      },
      undefined,
      undefined,
      ctx,
    );
    expect(discovery.isError).not.toBe(true);
    expect(active).not.toContain("third_party_fetch");
    const loaded = await codemode.execute(
      "sandbox",
      {
        code: 'text(await tools.tool_load({ query: "third_party_fetch", limit: 1 }));',
      },
      undefined,
      undefined,
      ctx,
    );
    expect(loaded.isError).not.toBe(true);
    expect(JSON.stringify(loaded.content)).toContain("third_party_fetch (loaded)");
    expect(active).toContain("third_party_fetch");
  } finally {
    memory.mockRestore();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
