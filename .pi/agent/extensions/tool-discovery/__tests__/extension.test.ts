import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import toolDiscoveryExtension, {
  isDeferredToolName,
  rankDeferredToolsWithClassifier,
  resolveClassifierToolDiscoveryConfig,
  resolveDeferredToolPrefixes,
  searchDeferredTools,
  searchDeferredToolsWithClassifierFallback,
} from "../index";
import type { NativeToolSearchHooks, NativeToolSearchRanker } from "../native-ranking";

type EventHandler = (event: never, ctx: ExtensionContext) => unknown | Promise<unknown>;

const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
const testAgentDirectory = mkdtempSync(join(tmpdir(), "tool-discovery-classifier-test-"));
writeFileSync(
  join(testAgentDirectory, "settings.json"),
  JSON.stringify({
    classifier: { providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }] },
    toolDiscovery: {
      deferredToolPrefixes: [
        "chart_",
        "figma_",
        "find_definition",
        "worktrunk",
        "webfetch",
        "websearch",
      ],
    },
  }),
);
process.env.PI_CODING_AGENT_DIR = testAgentDirectory;

afterAll(() => {
  if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
  rmSync(testAgentDirectory, { recursive: true, force: true });
});

async function nativeClassifierRegistry(onInput?: (input: ClassifierContext) => void) {
  const registry = await createNativeClassifierRegistry();
  return {
    findOfType: registry.findOfType.bind(registry),
    classify: (
      model: Parameters<typeof registry.classify>[0],
      input: ClassifierContext,
      options?: Parameters<typeof registry.classify>[2],
    ) => {
      onInput?.(input);
      return registry.classify(model, input, options);
    },
  };
}

interface SearchResult {
  usage?: Usage;
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  details: {
    matches: string[];
    added: string[];
    rankingSource: "classifier" | "lexical";
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
  nativeHooks?: NativeToolSearchHooks;
  modelRegistry?: ExtensionContext["modelRegistry"];
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
        exposure: tool.exposure ?? "direct",
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
        tool.name === "tool_load" &&
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

  const ctx = withToolExecution({
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    modelRegistry: options?.modelRegistry,
    getSystemPrompt: () => options?.systemPrompt ?? "base system prompt",
    sessionManager: {
      getHeader: () => ({
        id: "session-1",
        parentSession: options?.parentSession,
      }),
    },
  } as unknown as ExtensionContext);

  toolDiscoveryExtension(pi, options?.nativeHooks);

  return {
    activeToolSets,
    removeTool: (name: string) => tools.delete(name),
    async startSession(modelRegistry?: ExtensionContext["modelRegistry"]) {
      const context = modelRegistry === undefined ? ctx : { ...ctx, modelRegistry };
      await handlers.get("session_start")?.({} as never, context);
    },
    async shutdownSession() {
      await handlers.get("session_shutdown")?.({} as never, ctx);
    },
    get activeTools() {
      return activeTools;
    },
    async discoverResources() {
      await handlers.get("resources_discover")?.({} as never, ctx);
    },
    async search(query: string, limit?: number, signal?: AbortSignal): Promise<SearchResult> {
      const tool = tools.get("tool_load");
      if (tool === undefined) throw new Error("tool_load was not registered");

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
  test("loads settings once per loader search and observes changes on the next call", async () => {
    const settingsPath = join(testAgentDirectory, "settings.json");
    const originalSettings = readFileSync(settingsPath, "utf8");
    const createSettings = spyOn(SettingsManager, "create");
    const harness = createHarness({
      tools: [dummyTool("chart_pie", "Render a pie"), dummyTool("custom_pie", "Render a pie")],
    });
    try {
      writeFileSync(
        settingsPath,
        JSON.stringify({
          classifier: { toolDiscovery: { enabled: false } },
          toolDiscovery: { deferredToolPrefixes: ["chart_"] },
        }),
      );
      expect((await harness.search("pie", 1)).details).toEqual({
        matches: ["chart_pie"],
        added: ["chart_pie"],
        rankingSource: "lexical",
      });
      expect(createSettings).toHaveBeenCalledTimes(1);
      writeFileSync(
        settingsPath,
        JSON.stringify({
          classifier: { toolDiscovery: { enabled: false } },
          toolDiscovery: { deferredToolPrefixes: ["custom_"] },
        }),
      );
      expect((await harness.search("pie", 1)).details).toEqual({
        matches: ["custom_pie"],
        added: ["custom_pie"],
        rankingSource: "lexical",
      });
      expect(createSettings).toHaveBeenCalledTimes(2);
    } finally {
      createSettings.mockRestore();
      writeFileSync(settingsPath, originalSettings);
    }
  });

  test("registers native ranking per session and disposes replaced or shut-down registrations", async () => {
    const firstRegistry = await createNativeClassifierRegistry();
    const secondRegistry = await createNativeClassifierRegistry();
    const registered: ExtensionContext["modelRegistry"][] = [];
    const disposed: ExtensionContext["modelRegistry"][] = [];
    const hooks: NativeToolSearchHooks = {
      installToolSearchRanker(registry) {
        registered.push(registry);
        return () => disposed.push(registry);
      },
    };
    const harness = createHarness({ nativeHooks: hooks, modelRegistry: firstRegistry });
    await harness.startSession();
    expect(registered).toEqual([firstRegistry]);
    expect(disposed).toEqual([]);
    await harness.startSession();
    await harness.startSession(secondRegistry);
    expect(registered).toEqual([firstRegistry, firstRegistry, secondRegistry]);
    expect(disposed).toEqual([firstRegistry, firstRegistry]);
    await harness.shutdownSession();
    await harness.shutdownSession();
    expect(disposed).toEqual([firstRegistry, firstRegistry, secondRegistry]);
    await harness.startSession(secondRegistry);
    await harness.shutdownSession();
    expect(disposed).toEqual([firstRegistry, firstRegistry, secondRegistry, secondRegistry]);
  });

  test("filters native classifier inputs through captured subagent admission and preserves usage", async () => {
    const modelRegistry = await createNativeClassifierRegistry();
    const inputs: ClassifierContext[] = [];
    const usage: Usage = {
      input: 7,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 9,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    };
    modelRegistry.classify = async (model, input) => {
      inputs.push(input);
      return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: 0,
        stopReason: "stop",
        usage,
        answers: {
          best_tool: {
            type: "choice",
            choice: "candidate_0",
            confidence: 1,
            probabilities: { candidate_0: 1, no_match: 0 },
          },
        },
      };
    };
    let installed: NativeToolSearchRanker | undefined;
    const harness = createHarness({
      modelRegistry,
      nativeHooks: {
        installToolSearchRanker(_registry, ranker) {
          installed = ranker;
          return () => {
            installed = undefined;
          };
        },
      },
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
    await harness.startSession();
    const getRanker = () => {
      if (installed === undefined) throw new Error("Native ranker was not installed");
      return installed;
    };
    const context = withToolExecution({
      modelRegistry,
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      getSystemPrompt: () => '<active_agent name="design-review"/>',
      sessionManager: { getHeader: () => ({ parentSession: "parent-session-id" }) },
    } as unknown as ExtensionContext);
    const result = await getRanker()({
      context,
      query: "design reference",
      limit: 1,
      documents: [
        { name: "webfetch", description: "FORBIDDEN_DESCRIPTION", text: "FORBIDDEN_SCHEMA" },
        {
          name: "figma_parse_url",
          description: "Parse a Figma URL\nPRIVATE_COMMAND_BODY",
          text: "PRIVATE_SCHEMA",
        },
      ],
      rankLexical: () => [
        { name: "webfetch", score: 10 },
        { name: "figma_parse_url", score: 2 },
      ],
    });
    expect(result).toEqual({
      matches: [{ name: "figma_parse_url", score: 1 }],
      rankingSource: "classifier",
      usage,
    });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.state).toEqual({
      query: "design reference",
      candidates: [
        { id: "candidate_0", name: "figma_parse_url", description: "Parse a Figma URL" },
      ],
    });
    expect(JSON.stringify(inputs)).not.toMatch(/FORBIDDEN|PRIVATE|webfetch/u);
    expect(harness.activeToolSets).toEqual([]);
    const legacy = await harness.search("Figma URL");
    expect(legacy.usage).toEqual(usage);
    expect(legacy.details.matches).toEqual(["figma_parse_url"]);
    expect(harness.activeToolSets).toEqual([]);
    await harness.shutdownSession();
  });

  test("cancelled billed loader inference returns an error with usage without activating tools", async () => {
    const controller = new AbortController();
    const modelRegistry = await createNativeClassifierRegistry();
    const usage: Usage = {
      input: 7,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 9,
      cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    };
    modelRegistry.classify = async (model) => ({
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: 0,
      stopReason: "stop",
      get usage() {
        controller.abort();
        return usage;
      },
      answers: {
        best_tool: {
          type: "choice",
          choice: "candidate_0",
          confidence: 1,
          probabilities: { candidate_0: 1, no_match: 0 },
        },
      },
    });
    const harness = createHarness({
      modelRegistry,
      tools: [dummyTool("chart_pie", "Render a pie")],
    });
    const result = await harness.search("pie", 1, controller.signal);
    expect(result.isError).toBe(true);
    expect(result.usage).toEqual(usage);
    expect(result.details.matches).toEqual([]);
    expect(result.details.added).toEqual([]);
    expect(harness.activeTools).toEqual(["tool_load"]);
    expect(harness.activeToolSets).toEqual([]);
  });

  test("does not activate hidden siblings when loading an inactive-direct family", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("chart_pie", "Render a pie"),
        { ...dummyTool("chart_private", "Private chart internals"), exposure: "hidden" },
      ],
    });
    const result = await harness.search("pie", 1);
    expect(result.details.matches).toEqual(["chart_pie"]);
    expect(result.details.added).toEqual(["chart_pie"]);
    expect(harness.activeTools).toEqual(["tool_load", "chart_pie"]);
  });

  test("does not activate a removed match or its siblings after asynchronous ranking", async () => {
    const harness = createHarness({
      tools: [dummyTool("chart_pie", "Render a pie"), dummyTool("chart_bar", "Render a bar")],
    });
    const pending = harness.search("pie", 1);
    harness.removeTool("chart_pie");
    const result = await pending;
    expect(result.details.matches).toEqual([]);
    expect(result.details.added).toEqual([]);
    expect(harness.activeTools).toEqual(["tool_load"]);
    expect(harness.activeToolSets).toEqual([]);
  });

  test("prefix deferral applies only to configured third-party names", () => {
    expect(isDeferredToolName("tool_load", ["tool_"])).toBe(false);
    expect(isDeferredToolName("browser_open")).toBe(false);
    expect(isDeferredToolName("chart_pie")).toBe(false);
    expect(isDeferredToolName("worktrunk", ["worktrunk"])).toBe(true);
    expect(isDeferredToolName("read")).toBe(false);
  });
  test("resolves Classifier settings with safe defaults, bounds, and trusted project overrides", () => {
    expect(resolveClassifierToolDiscoveryConfig({}, undefined)).toEqual({
      enabled: true,
      timeoutMs: 2400,
    });
    expect(
      resolveClassifierToolDiscoveryConfig({
        classifier: { toolDiscovery: { enabled: false, timeoutMs: 1500 } },
      }),
    ).toEqual({ enabled: false, timeoutMs: 1500 });
    expect(
      resolveClassifierToolDiscoveryConfig({ classifier: { toolDiscovery: { timeoutMs: 0 } } }),
    ).toEqual({
      enabled: false,
      timeoutMs: 2400,
    });
    expect(resolveClassifierToolDiscoveryConfig({ classifier: null })).toEqual({
      enabled: false,
      timeoutMs: 2400,
    });
    expect(
      resolveClassifierToolDiscoveryConfig({ classifier: { toolDiscovery: { enabled: null } } }),
    ).toEqual({
      enabled: false,
      timeoutMs: 2400,
    });
    expect(
      resolveClassifierToolDiscoveryConfig(
        { classifier: { toolDiscovery: { enabled: true } } },
        { classifier: { toolDiscovery: { enabled: false } } },
      ),
    ).toEqual({ enabled: false, timeoutMs: 2400 });
    expect(
      resolveClassifierToolDiscoveryConfig(
        {
          classifier: { toolDiscovery: { enabled: false } },
          toolDiscovery: { deferredToolPrefixes: ["global_"] },
        },
        { toolDiscovery: { deferredToolPrefixes: ["project_"] } },
      ),
    ).toEqual({ enabled: false, timeoutMs: 2400 });
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
    expect(resolveDeferredToolPrefixes({ toolDiscovery: { deferredToolPrefixes: [""] } })).toEqual(
      [],
    );
    expect(isDeferredToolName("tool_load", ["tool_"])).toBe(false);
  });

  test("defers Neovim tools until requested", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        dummyTool("mcp", "Discover MCP operations"),
        { ...dummyTool("neovim", "Inspect the launching editor"), exposure: "deferred" },
        dummyTool("figma_parse_url", "Parse a Figma URL"),
        dummyTool("find_definition", "Find a symbol definition"),
        dummyTool("worktrunk", "Manage worktrees"),
      ],
      activeTools: ["read", "mcp", "figma_parse_url", "find_definition", "worktrunk"],
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "mcp", "tool_load"]);
    expect((await harness.search("editor", 1)).details).toEqual({
      matches: ["neovim"],
      added: ["neovim"],
      rankingSource: "lexical",
    });
    expect(harness.activeTools).toEqual(["read", "mcp", "tool_load", "neovim"]);
  });

  test("leaves native deferred tools to Pi and retains tool_load discovery", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        { ...dummyTool("chart_pie", "Render a pie chart"), exposure: "deferred" },
        { ...dummyTool("chart_donut", "Render a donut chart"), exposure: "deferred" },
      ],
      activeTools: ["read", "chart_pie"],
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "chart_pie", "tool_load"]);
    expect((await harness.search("chart_donut", 1)).details).toEqual({
      matches: ["chart_donut"],
      added: ["chart_donut"],
      rankingSource: "lexical",
    });
    expect(harness.activeTools).toEqual(["read", "chart_pie", "tool_load", "chart_donut"]);
  });

  test("loads only the ranked specialist tool, not underscore-named siblings", async () => {
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
    expect(harness.activeTools).toEqual(["read", "tool_load"]);
    expect((await harness.search("chart_gantt", 1)).details).toEqual({
      matches: ["chart_gantt"],
      added: ["chart_gantt"],
      rankingSource: "lexical",
    });
    expect(harness.activeTools).toEqual(["read", "tool_load", "chart_gantt"]);
  });

  test("loads only the specific browser tool selected by the search", async () => {
    const harness = createHarness({
      tools: [
        { ...dummyTool("browser_open", "Open a URL in Lightpanda"), exposure: "deferred" },
        {
          ...dummyTool("browser_snapshot", "Read the current page accessibility snapshot"),
          exposure: "deferred",
        },
        { ...dummyTool("browser_act", "Interact with a browser element"), exposure: "deferred" },
        {
          ...dummyTool("browser_decide", "Choose among explicit browser actions"),
          exposure: "deferred",
        },
      ],
      activeTools: [],
    });

    await harness.discoverResources();
    const result = await harness.search("browser_open", 1);

    expect(result.details).toEqual({
      matches: ["browser_open"],
      added: ["browser_open"],
      rankingSource: "lexical",
    });
    expect(harness.activeTools).toEqual(["tool_load", "browser_open"]);
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
    expect(harness.activeTools).toEqual(["read", "tool_load", "figma_get_implementation_context"]);
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
    expect(harness.activeToolSets).toEqual([["read", "tool_load", "websearch"]]);
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
        { ...dummyTool("figma_parse_url", "Parse a Figma URL"), exposure: "deferred" },
        { ...dummyTool("figma_private", "Private design capability"), exposure: "deferred" },
        { ...dummyTool("webfetch", "Fetch a web page"), exposure: "deferred" },
      ],
      activeTools: ["read", "figma_parse_url"],
      parentSession: "parent-session-id",
      systemPrompt:
        '<active_agent name="design-review"/>\n\n# Environment\nWorking directory: /tmp/project',
    });

    await harness.discoverResources();

    expect(harness.activeTools).toEqual(["read", "figma_parse_url", "tool_load"]);
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

    expect(harness.activeTools).toEqual(["read", "tool_load"]);
  });

  test("discovers native deferred metadata without a configured name prefix", async () => {
    const harness = createHarness({
      tools: [
        dummyTool("read", "Read files"),
        { ...dummyTool("browser_snapshot", "Read the browser snapshot"), exposure: "deferred" },
        dummyTool("browser_open", "Open the browser"),
      ],
    });
    const result = await harness.search("browser snapshot", 1);
    expect(result.details.matches).toEqual(["browser_snapshot"]);
    expect(harness.activeTools).toEqual(["tool_load", "browser_snapshot"]);
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
      exposure: tool.name.startsWith("figma_") ? ("deferred" as const) : ("direct" as const),
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

  test("uses bounded live Classifier probabilities to rank beyond lexical matches", async () => {
    const tools = [
      dummyTool("chart_pie", "Render circular data visualizations"),
      dummyTool("chart_network", "Render relationships between connected nodes"),
      dummyTool("chart_table", "Render tabular data"),
    ].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      exposure: "direct" as const,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));
    let classifierInput: ClassifierContext | undefined;
    const ranked = await rankDeferredToolsWithClassifier(
      tools,
      "show connected dependencies",
      2,
      ["chart_"],
      {
        modelRegistry: await nativeClassifierRegistry((input) => {
          classifierInput = input;
        }),
        fetch: async () => {
          const criteria = classifierInput?.questions.best_tool;
          if (criteria?.type !== "choice") throw new Error("choice criteria missing");
          const selected = Object.entries(criteria.criteria).find(([, value]) =>
            value.startsWith("chart_network:"),
          )?.[0];
          if (selected === undefined) throw new Error("network candidate missing");
          const probabilities = Object.fromEntries(
            Object.keys(criteria.criteria).map((id) => [id, id === selected ? 1 : 0]),
          );
          return new Response(
            JSON.stringify({
              answers: {
                best_tool: {
                  type: "choice",
                  choice: selected,
                  confidence: 1,
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
    expect(ranked?.rankingSource).toBe("classifier");
    expect(classifierInput?.questions.best_tool?.type).toBe("choice");
    expect(JSON.stringify(classifierInput?.state)).not.toContain("parameters");
    expect(JSON.stringify(classifierInput?.state)).not.toContain("sourceInfo");
  });

  test("accepts a valid Classifier no-match response without activating a candidate", async () => {
    const tools = [dummyTool("chart_pie", "Render circular data visualizations")].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      exposure: "direct" as const,
      sourceInfo: {
        path: `/extensions/${tool.name}.ts`,
        source: "local" as const,
        scope: "user" as const,
        origin: "top-level" as const,
      },
    }));

    const ranked = await rankDeferredToolsWithClassifier(
      tools,
      "database migrations",
      1,
      ["chart_"],
      {
        modelRegistry: await nativeClassifierRegistry(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              answers: {
                best_tool: {
                  type: "choice",
                  choice: "no_match",
                  confidence: 0.9,
                  probabilities: { candidate_0: 0.1, no_match: 0.9 },
                },
              },
            }),
            { status: 200 },
          ),
      },
    );

    expect(ranked).toEqual({ matches: [], rankingSource: "classifier" });
  });

  test("falls back to lexical results for unavailable or malformed Classifier responses", async () => {
    const tools = [
      dummyTool("websearch", "Search the public web"),
      dummyTool("webfetch", "Fetch a web page"),
    ].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      exposure: "direct" as const,
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
      modelRegistry: await nativeClassifierRegistry(),
      fetch: async () => new Response("not-json", { status: 200 }),
    };

    const lexicalMatches = searchDeferredTools(tools, "fetch web page", 2, ["web"]);
    await expect(
      searchDeferredToolsWithClassifierFallback(tools, "fetch web page", 2, ["web"], options),
    ).resolves.toEqual({ matches: lexicalMatches, rankingSource: "lexical" });
    await expect(
      searchDeferredToolsWithClassifierFallback(tools, "fetch web page", 2, ["web"], {
        modelRegistry: await nativeClassifierRegistry(),
        fetch: async () =>
          new Response(
            JSON.stringify({
              answers: {
                best_tool: {
                  type: "choice",
                  choice: "unexpected",
                  confidence: 1,
                  probabilities: { unexpected: 1 },
                },
              },
            }),
            { status: 200 },
          ),
      }),
    ).resolves.toEqual({ matches: lexicalMatches, rankingSource: "lexical" });
    await expect(
      searchDeferredToolsWithClassifierFallback(tools, "fetch web page", 2, ["web"], {
        modelRegistry: await nativeClassifierRegistry(),
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
    expect(harness.activeTools).toEqual(["read", "tool_load"]);
  });

  test("rejects caller cancellation but falls back on classifier deadlines", async () => {
    const tools = [dummyTool("chart_pie", "Render a chart")].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      exposure: "direct" as const,
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
    await expect(
      searchDeferredToolsWithClassifierFallback(
        tools,
        "chart",
        1,
        ["chart_"],
        {
          modelRegistry: await nativeClassifierRegistry(),
          timeoutMs: 5,
          fetch: async () => new Response("never"),
        },
        controller.signal,
      ),
    ).rejects.toThrow();

    await expect(
      searchDeferredToolsWithClassifierFallback(tools, "chart", 1, ["chart_"], {
        modelRegistry: await nativeClassifierRegistry(),
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
