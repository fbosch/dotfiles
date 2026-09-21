import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import toolDiscoveryExtension, {
  isDeferredToolName,
  rankDeferredToolsWithJev,
  resolveDeferredToolPrefixes,
  searchDeferredTools,
  searchDeferredToolsWithJevFallback,
} from "../index";

type EventHandler = (event: never, ctx: ExtensionContext) => unknown | Promise<unknown>;

interface SearchResult {
  content: Array<{ type: string; text?: string }>;
  details: {
    matches: string[];
    added: string[];
    rankingSource: "jev" | "lexical";
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
    async search(query: string, limit?: number, signal?: AbortSignal): Promise<SearchResult> {
      const tool = tools.get("search_tools");
      if (tool === undefined) throw new Error("search_tools was not registered");

      return (await tool.execute(
        "search",
        limit === undefined ? { query } : { query, limit },
        signal,
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
      rankingSource: "lexical",
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
      rankingSource: "lexical",
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

    expect(result.details).toEqual({ matches: [], added: [], rankingSource: "lexical" });
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
    expect(second.details).toEqual({ matches: ["websearch"], added: [], rankingSource: "lexical" });
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

  test("preserves a pi-subagent tool selection as its discovery boundary", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        dummyTool("figma_parse_url", "Parse a Figma URL"),
        dummyTool("webfetch", "Fetch a web page"),
      ],
      activeTools: ["read", "figma_parse_url"],
      parentSession: "parent-session-id",
      systemPrompt:
        '<active_agent name="design-review"/>\n\n# Environment\nWorking directory: /tmp/project',
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "figma_parse_url", "search_tools"]);
    expect((await harness.search("fetch web page")).details).toEqual({
      matches: [],
      added: [],
      rankingSource: "lexical",
    });
    expect((await harness.search("figma URL")).details).toEqual({
      matches: ["figma_parse_url"],
      added: [],
      rankingSource: "lexical",
    });
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

  test("uses bounded live Jev probabilities to rank beyond lexical matches", async () => {
    const tools = [
      dummyTool("chart_pie", "Render circular data visualizations"),
      dummyTool("chart_network", "Render relationships between connected nodes"),
      dummyTool("chart_table", "Render tabular data"),
    ].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));
    let requestBody: Record<string, unknown> | undefined;

    const ranked = await rankDeferredToolsWithJev(
      tools,
      "show connected dependencies",
      2,
      ["chart_"],
      {
        modelRegistry: {
          getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }),
        },
        fetch: async (_url, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          const state = requestBody.state as { candidates: Array<{ id: string; name: string }> };
          const probabilities = Object.fromEntries(
            state.candidates.map((candidate) => [
              candidate.id,
              candidate.name === "chart_network" ? 1 : 0,
            ]),
          );
          probabilities.no_match = 0;
          const selected = state.candidates.find((candidate) => candidate.name === "chart_network");
          return new Response(
            JSON.stringify({
              answers: {
                best_tool: {
                  type: "choice",
                  choice: selected?.id,
                  probabilities,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );

    expect(ranked?.matches.map((tool) => tool.name)).toEqual(["chart_network"]);
    expect(ranked?.rankingSource).toBe("jev");
    expect(requestBody?.model).toBe("typesafe-ai/jev");
    const state = requestBody?.state as {
      candidates: Array<Record<string, unknown>>;
    };
    expect(state.candidates).toHaveLength(3);
    expect(state.candidates.every((candidate) => !("parameters" in candidate))).toBe(true);
    expect(state.candidates.every((candidate) => !("sourceInfo" in candidate))).toBe(true);
  });

  test("accepts a valid Jev no-match response without activating a candidate", async () => {
    const tools = [dummyTool("chart_pie", "Render circular data visualizations")].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));

    const ranked = await rankDeferredToolsWithJev(tools, "database migrations", 1, ["chart_"], {
      modelRegistry: {
        getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }),
      },
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as {
          state: { candidates: Array<{ id: string }> };
        };
        const candidate = request.state.candidates[0];
        if (candidate === undefined) throw new Error("candidate fixture missing");

        return new Response(
          JSON.stringify({
            answers: {
              best_tool: {
                type: "choice",
                choice: "no_match",
                probabilities: { [candidate.id]: 0.1, no_match: 0.9 },
              },
            },
          }),
          { status: 200 },
        );
      },
    });

    expect(ranked).toEqual({ matches: [], rankingSource: "jev" });
  });

  test("falls back to lexical results for unavailable or malformed Jev responses", async () => {
    const tools = [
      dummyTool("websearch", "Search the public web"),
      dummyTool("webfetch", "Fetch a web page"),
    ].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));
    const fetchTool = tools.find((tool) => tool.name === "webfetch");
    if (fetchTool === undefined) throw new Error("webfetch fixture missing");
    const options = {
      modelRegistry: {
        getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }),
      },
      fetch: async () => new Response("not-json", { status: 200 }),
    };

    const lexicalMatches = searchDeferredTools(tools, "fetch web page", 2, ["web"]);
    await expect(
      searchDeferredToolsWithJevFallback(tools, "fetch web page", 2, ["web"], options),
    ).resolves.toEqual({ matches: lexicalMatches, rankingSource: "lexical" });
    await expect(
      searchDeferredToolsWithJevFallback(tools, "fetch web page", 2, ["web"], {
        modelRegistry: {
          getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }),
        },
        fetch: async (_url, init) => {
          const request = JSON.parse(String(init?.body)) as {
            state: { candidates: Array<{ id: string }> };
          };
          const probabilities = Object.fromEntries(
            request.state.candidates.map(({ id }, index) => [id, index === 0 ? 0.6 : 0.4]),
          );
          probabilities.no_match = 0;
          probabilities.unexpected = 0;
          return new Response(
            JSON.stringify({
              answers: {
                best_tool: {
                  type: "choice",
                  choice: request.state.candidates[0]?.id,
                  probabilities,
                },
              },
            }),
            { status: 200 },
          );
        },
      }),
    ).resolves.toEqual({ matches: lexicalMatches, rankingSource: "lexical" });
    await expect(
      searchDeferredToolsWithJevFallback(tools, "fetch web page", 2, ["web"], {
        modelRegistry: { getProviderAuth: async () => undefined },
        fetch: async () => {
          throw new Error("network unavailable");
        },
      }),
    ).resolves.toEqual({ matches: lexicalMatches, rankingSource: "lexical" });
  });

  test("does not activate tools after cancellation", async () => {
    const harness = createHarness({
      tools: [dummyTool("read", "Read files"), dummyTool("chart_pie", "Render a chart")],
      activeTools: ["read"],
    });
    await harness.discoverResources();
    const controller = new AbortController();
    controller.abort();

    await expect(harness.search("chart", 1, controller.signal)).rejects.toThrow();
    expect(harness.activeTools).toEqual(["read", "search_tools"]);
  });

  test("honors cancellation and request deadlines without failing discovery", async () => {
    const tools = [dummyTool("chart_pie", "Render a chart")].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));
    const chartTool = tools[0];
    if (chartTool === undefined) throw new Error("chart fixture missing");
    const controller = new AbortController();
    controller.abort();
    let authCalls = 0;

    await expect(
      searchDeferredToolsWithJevFallback(
        tools,
        "chart",
        1,
        ["chart_"],
        {
          modelRegistry: {
            getProviderAuth: async () => {
              authCalls += 1;
              return { auth: { apiKey: "gateway-test-key" } };
            },
          },
          timeoutMs: 5,
          fetch: async () => new Response("never"),
        },
        controller.signal,
      ),
    ).resolves.toEqual({ matches: [chartTool], rankingSource: "lexical" });
    expect(authCalls).toBe(0);

    await expect(
      searchDeferredToolsWithJevFallback(tools, "chart", 1, ["chart_"], {
        modelRegistry: {
          getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }),
        },
        timeoutMs: 5,
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new Error("request timed out"));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          }),
      }),
    ).resolves.toEqual({ matches: [chartTool], rankingSource: "lexical" });
  });
});
