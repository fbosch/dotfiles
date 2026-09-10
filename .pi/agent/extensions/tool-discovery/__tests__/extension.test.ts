import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import toolDiscoveryExtension, {
  isDeferredToolName,
  resolveDeferredToolPrefixes,
  searchDeferredTools,
} from "../index";

type EventHandler = (event: never, ctx: ExtensionContext) => unknown | Promise<unknown>;

interface SearchResult {
  content: Array<{ type: string; text?: string }>;
  details: {
    matches: string[];
    added: string[];
  };
}

function dummyTool(name: string, description: string): ToolDefinition {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({}),
    async execute() {
      return {
        content: [{ type: "text", text: name }],
        details: {},
      };
    },
  } as ToolDefinition;
}

function createHarness(options?: {
  activeTools?: string[];
  tools?: ToolDefinition[];
  searchActive?: boolean;
  parentSession?: string;
  systemPrompt?: string;
}) {
  const tools = new Map((options?.tools ?? []).map((tool) => [tool.name, tool]));
  let activeTools = [...(options?.activeTools ?? [])];
  const activeToolSets: string[][] = [];
  const handlers = new Map<string, EventHandler>();

  const pi = {
    getActiveTools: () => [...activeTools],
    getAllTools: () =>
      [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        promptGuidelines: tool.promptGuidelines,
        sourceInfo: {
          path: `/extensions/${tool.name}.ts`,
          source: "local",
          scope: "user",
          origin: "top-level",
        },
      })),
    on: (event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    },
    registerTool: (tool: ToolDefinition) => {
      tools.set(tool.name, tool);
      if (
        tool.name === "search_tools" &&
        options?.searchActive !== false &&
        !activeTools.includes(tool.name)
      ) {
        activeTools.push(tool.name);
      }
    },
    setActiveTools: (names: string[]) => {
      activeTools = [...names];
      activeToolSets.push([...names]);
    },
  } as unknown as ExtensionAPI;

  const ctx = {
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    getSystemPrompt: () => options?.systemPrompt ?? "base system prompt",
    sessionManager: {
      getHeader: () => ({
        id: "session-1",
        parentSession: options?.parentSession,
      }),
    },
  } as unknown as ExtensionContext;

  toolDiscoveryExtension(pi);

  return {
    activeToolSets,
    get activeTools() {
      return activeTools;
    },
    async discoverResources() {
      await handlers.get("resources_discover")?.({} as never, ctx);
    },
    async search(query: string, limit?: number): Promise<SearchResult> {
      const tool = tools.get("search_tools");
      if (tool === undefined) throw new Error("search_tools was not registered");

      return (await tool.execute(
        "search",
        limit === undefined ? { query } : { query, limit },
        undefined,
        undefined,
        ctx,
      )) as unknown as SearchResult;
    },
  };
}

describe("tool discovery", () => {
  test("classifies only known specialist tool names", () => {
    expect(isDeferredToolName("chart_pie")).toBe(true);
    expect(isDeferredToolName("chart_bar")).toBe(true);
    expect(isDeferredToolName("chart_line")).toBe(true);
    expect(isDeferredToolName("chart_scatter")).toBe(true);
    expect(isDeferredToolName("chart_histogram")).toBe(true);
    expect(isDeferredToolName("chart_bezier")).toBe(true);
    expect(isDeferredToolName("chart_heatmap")).toBe(true);
    expect(isDeferredToolName("chart_boxplot")).toBe(true);
    expect(isDeferredToolName("chart_waterfall")).toBe(true);
    expect(isDeferredToolName("chart_dumbbell")).toBe(true);
    expect(isDeferredToolName("chart_stacked_bar")).toBe(true);
    expect(isDeferredToolName("chart_gantt")).toBe(true);
    expect(isDeferredToolName("chart_network")).toBe(true);
    expect(isDeferredToolName("chart_tree")).toBe(true);
    expect(isDeferredToolName("chart_treemap")).toBe(true);
    expect(isDeferredToolName("figma_parse_url")).toBe(true);
    expect(isDeferredToolName("serena_find_symbol")).toBe(true);
    expect(isDeferredToolName("mcp__github")).toBe(true);
    expect(isDeferredToolName("exec")).toBe(true);
    expect(isDeferredToolName("find_definition")).toBe(true);
    expect(isDeferredToolName("worktrunk")).toBe(true);
    expect(isDeferredToolName("hypr_desktop_diagnose")).toBe(true);
    expect(isDeferredToolName("hypr_layer_inspect")).toBe(true);

    expect(isDeferredToolName("read")).toBe(false);
    expect(isDeferredToolName("fffind")).toBe(false);
    expect(isDeferredToolName("just_tools")).toBe(false);
    expect(isDeferredToolName("mcp")).toBe(false);
    expect(isDeferredToolName("neovim")).toBe(false);
  });
  test("reads deferred prefixes from tool discovery settings", () => {
    expect(
      resolveDeferredToolPrefixes({
        toolDiscovery: { deferredToolPrefixes: ["custom_", "chart_"] },
      }),
    ).toEqual(["custom_", "chart_"]);
    expect(
      resolveDeferredToolPrefixes(
        { toolDiscovery: { deferredToolPrefixes: ["global_"] } },
        { toolDiscovery: { deferredToolPrefixes: [] } },
      ),
    ).toEqual([]);
    expect(
      resolveDeferredToolPrefixes({ toolDiscovery: { deferredToolPrefixes: [""] } }),
    ).toContain("chart_");
    expect(isDeferredToolName("search_tools", ["search_"])).toBe(false);
  });

  test("removes specialist tools from the initial parent tool set", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        dummyTool("mcp", "Discover MCP operations"),
        dummyTool("neovim", "Inspect the launching editor"),
        dummyTool("figma_parse_url", "Parse a Figma URL"),
        dummyTool("find_definition", "Find a symbol definition"),
        dummyTool("worktrunk", "Manage worktrees"),
      ],
      activeTools: ["read", "mcp", "neovim", "figma_parse_url", "find_definition", "worktrunk"],
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "mcp", "neovim", "search_tools"]);
  });

  test("defers chart tools and discovers them on demand", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        dummyTool("chart_pie", "Render a compact pie chart"),
        dummyTool("chart_line", "Render a single-series line chart"),
        dummyTool("chart_gantt", "Render deterministic task timelines"),
        dummyTool("chart_network", "Render layered network and call-graph charts"),
      ],
      activeTools: ["read", "chart_pie", "chart_line", "chart_gantt", "chart_network"],
    });

    await harness.discoverResources();
    expect(harness.activeTools).toEqual(["read", "search_tools"]);
    expect((await harness.search("chart timeline", 1)).details).toEqual({
      matches: ["chart_gantt"],
      added: ["chart_gantt"],
    });
    expect(harness.activeTools).toEqual(["read", "search_tools", "chart_gantt"]);
  });

  test("loads the highest-scoring matches additively", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        dummyTool("figma_parse_url", "Parse a Figma URL"),
        dummyTool(
          "figma_get_implementation_context",
          "Return design-to-code implementation context for a Figma node",
        ),
        dummyTool("custom_implementation_helper", "Unmanaged implementation context helper"),
      ],
      activeTools: ["read"],
    });

    await harness.discoverResources();
    const result = await harness.search("figma implementation context", 1);

    expect(result.details).toEqual({
      matches: ["figma_get_implementation_context"],
      added: ["figma_get_implementation_context"],
    });
    expect(harness.activeTools).toEqual([
      "read",
      "search_tools",
      "figma_get_implementation_context",
    ]);
  });

  test("does not activate unclassified inactive tools", async () => {
    const harness = createHarness({
      tools: [dummyTool("custom_implementation_helper", "Special implementation context helper")],
    });

    const result = await harness.search("implementation context");

    expect(result.details).toEqual({ matches: [], added: [] });
    expect(harness.activeToolSets).toEqual([]);
  });

  test("does not replace active tools or reactivate an existing match", async () => {
    const harness = createHarness({
      tools: [dummyTool("read", "Read files"), dummyTool("websearch", "Search the public web")],
      activeTools: ["read"],
    });

    const first = await harness.search("web search");
    const second = await harness.search("web search");

    expect(first.details.added).toEqual(["websearch"]);
    expect(second.details).toEqual({ matches: ["websearch"], added: [] });
    expect(harness.activeToolSets).toEqual([["read", "search_tools", "websearch"]]);
  });

  test("searches full descriptions but keeps large output bounded", async () => {
    const harness = createHarness({
      tools: [
        dummyTool(
          "worktrunk",
          `Manage Git worktrees safely.\nSupports workspace sessions.\n${"large reference ".repeat(3_000)}`,
        ),
      ],
    });

    const result = await harness.search("workspace sessions");
    const text = result.content
      .flatMap((item) => (item.type === "text" && item.text ? [item.text] : []))
      .join("\n");

    expect(result.details.matches).toEqual(["worktrunk"]);
    expect(text).toContain("Manage Git worktrees safely.");
    expect(text.length).toBeLessThan(500);
    expect(text).not.toContain("large reference");
  });

  test("does not alter a pi-subagent tool selection", async () => {
    const harness = createHarness({
      tools: [dummyTool("read", "Read files"), dummyTool("figma_parse_url", "Parse a Figma URL")],
      activeTools: ["read", "figma_parse_url"],
      parentSession: "parent-session-id",
      systemPrompt:
        '<active_agent name="design-review"/>\n\n# Environment\nWorking directory: /tmp/project',
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "figma_parse_url", "search_tools"]);
    expect(harness.activeToolSets).toEqual([]);
  });

  test("resets loaded specialist tools on resource reload", async () => {
    const harness = createHarness({
      tools: [dummyTool("read", "Read files"), dummyTool("webfetch", "Fetch a web page")],
      activeTools: ["read"],
    });

    await harness.search("fetch web page");
    expect(harness.activeTools).toContain("webfetch");

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "search_tools"]);
  });

  test("ranks deferred tools deterministically", () => {
    const tools = [
      dummyTool("figma_render_nodes", "Render Figma nodes"),
      dummyTool("figma_parse_url", "Parse a Figma URL"),
      dummyTool("read", "Read a file"),
    ].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.promptGuidelines === undefined ? {} : { promptGuidelines: tool.promptGuidelines }),
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));

    expect(searchDeferredTools(tools, "figma", 2).map((tool) => tool.name)).toEqual([
      "figma_parse_url",
      "figma_render_nodes",
    ]);
  });
});
