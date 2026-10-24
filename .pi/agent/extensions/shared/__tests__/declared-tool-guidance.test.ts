import { afterEach, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, type Tool } from "@earendil-works/pi-ai";
import { resolveTranscriptTools } from "@earendil-works/pi-ai/dist/utils/transcript.js";
import type {
  BeforeAgentStartEvent,
  ContextWithSystemEvent,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createToolSearchExtension } from "@earendil-works/pi-coding-agent";
import {
  buildSystemPromptSections,
  normalizeBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import browserExtension from "../../browser";
import { registerChartGuidance } from "../../chart/prompt";
import dekitExtension from "../../dekit";
import { instructionFragmentsForTools } from "../../instruction-fragments";
import { registerDeclaredToolGuidance } from "../declared-tool-guidance";
import { userStartEvent } from "./agent-start-events";

const previousCapabilities = getCapabilities();
afterEach(() => setCapabilities(previousCapabilities));

type StartHandler = (event: BeforeAgentStartEvent, context: ExtensionContext) => unknown;
type ContextHandler = (
  event: ContextWithSystemEvent,
  context: ExtensionContext,
) => { messages: AgentMessage[] } | undefined;

function harness(hiddenTools: string[] = []) {
  const tools: ToolDefinition[] = [];
  const active = ["read", "tool_search", ...hiddenTools];
  const starts: StartHandler[] = [];
  const contexts: ContextHandler[] = [];
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.push(tool);
    },
    getAllTools: () => tools,
    getActiveTools: () => [...active],
    setActiveTools(names: string[]) {
      active.splice(0, active.length, ...names);
    },
    on(name: string, handler: StartHandler | ContextHandler) {
      if (name === "before_agent_start") starts.push(handler as StartHandler);
      if (name === "context_with_system") contexts.push(handler as ContextHandler);
    },
  } as unknown as ExtensionAPI;
  browserExtension(pi);
  dekitExtension(pi);
  tools.push({
    name: "chart_line",
    label: "Line chart",
    description: "Render line charts",
    exposure: "deferred",
    defaultActive: false,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [], details: undefined }),
  });
  registerChartGuidance(pi);
  registerDeclaredToolGuidance(pi, "conditional", (declared) =>
    instructionFragmentsForTools(
      [
        { path: "global.md", content: "Always preserve safety." },
        {
          path: "browser.md",
          content: "Browser condition.",
          when: { tools: { all: ["browser_snapshot", "browser_run"] } },
        },
      ],
      [...declared],
    ),
  );
  createToolSearchExtension()(pi);
  const context = { cwd: "/tmp", mode: "tui", hasUI: true } as ExtensionContext;
  const options = normalizeBuildSystemPromptOptions({
    cwd: "/tmp",
    selectedTools: [...active],
    hiddenTools,
    sections: { other: "Keep this section." },
    toolGuidelines: Object.fromEntries(
      tools.map((tool) => [
        tool.name,
        typeof tool.promptGuidelines === "string"
          ? [tool.promptGuidelines]
          : (tool.promptGuidelines ?? []),
      ]),
    ),
  });
  const event = { ...userStartEvent("Inspect the browser"), systemPromptOptions: options };
  for (const handler of starts) handler(event, context);
  const declaration = (name: string): Tool => {
    const tool = tools.find((tool) => tool.name === name);
    return {
      name,
      description: tool?.description ?? name,
      parameters: tool?.parameters ?? { type: "object" },
    };
  };
  const leading: AgentMessage = {
    role: "system",
    content: "",
    sections: buildSystemPromptSections(options),
    toolsAdded: active.filter((name) => !hiddenTools.includes(name)).map(declaration),
    timestamp: 0,
  };
  const messages: AgentMessage[] = [
    leading,
    { role: "user", content: "Inspect the browser", timestamp: 1 },
  ];
  return {
    tools,
    active,
    options,
    leading,
    messages,
    declaration,
    async search(query: string) {
      const tool = tools.find((tool) => tool.name === "tool_search");
      if (!tool) throw new Error("tool_search not registered");
      return tool.execute("search", { query, limit: 1 }, undefined, undefined, {
        ...context,
        tools: [],
        executeTool: async () => {
          throw new Error("No nested execution");
        },
      });
    },
    project(input: AgentMessage[]) {
      let messages = input;
      for (const handler of contexts)
        messages =
          handler({ type: "context_with_system", messages }, context)?.messages ?? messages;
      return messages;
    },
    load(names: string[]) {
      return [
        ...messages,
        {
          role: "system" as const,
          content: "",
          toolsAdded: names.map(declaration),
          timestamp: 2,
        },
      ];
    },
  };
}

test("fresh declarations omit deferred definitions and details while retaining discovery routes", () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  const h = harness();
  const messages = h.project(h.messages);
  expect(messages).toBe(h.messages);
  const state = getCurrentSystemMessage(messages);
  expect(state?.toolsAdded?.map((tool) => tool.name)).toEqual(["read", "tool_search"]);
  expect(state?.sections?.browser_workflows).toContain("tool_search");
  expect(state?.sections?.browser_workflows).not.toContain("backend:");
  expect(state?.sections?.chart_visuals).not.toContain("12 nodes");
  expect(state?.sections?.rules).not.toContain("dekit discover");
  expect(state?.sections?.conditional).toContain("Always preserve safety.");
  expect(state?.sections?.conditional).not.toContain("Browser condition.");
});

test.each(["dekit", "browser_snapshot", "chart_line"])(
  "native tool_search activates %s without activating its siblings",
  async (name) => {
    const h = harness();
    await h.search(name);
    expect(h.active).toEqual(["read", "tool_search", name]);
  },
);

test("same-run discovery delivers details without hoisting tools into the leading prompt", () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  const h = harness();
  const loaded = h.load(["browser_snapshot", "browser_run", "chart_line"]);
  const projected = h.project(loaded);
  const state = getCurrentSystemMessage(projected);
  expect(state?.sections?.browser_workflows).toContain("- browser_snapshot:");
  expect(state?.sections?.browser_workflows).toContain("Prefer `browser_run`");
  expect(state?.sections?.browser_workflows).toContain(
    "Do not bypass a denied or failed browser action",
  );
  expect(state?.sections?.browser_workflows).not.toContain("- browser_open:");
  expect(state?.sections?.chart_visuals).toContain("12 nodes");
  expect(state?.sections?.conditional).toContain("Browser condition.");
  expect(state?.sections?.other).toContain("Keep this section.");
  expect(projected[0]).toBe(h.leading);
  expect(getCurrentSystemMessage([h.leading])?.toolsAdded?.map((tool) => tool.name)).toEqual([
    "read",
    "tool_search",
  ]);
  expect(
    resolveTranscriptTools(projected, "additions").requestTools.map((tool) => tool.name),
  ).toEqual(["read", "tool_search"]);
  expect(h.project(projected)).toBe(projected);
});

test("deactivation withdraws details and retains discovery hints", () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  const h = harness();
  const projected = h.project(h.load(["browser_snapshot", "browser_run", "chart_line"]));
  const withdrawn: AgentMessage[] = [
    ...projected,
    {
      role: "system",
      content: "",
      toolsRemoved: ["browser_snapshot", "browser_run", "chart_line"].map((name) => ({ name })),
      timestamp: 3,
    },
  ];
  const state = getCurrentSystemMessage(h.project(withdrawn));
  expect(state?.sections?.browser_workflows).toContain("discover native browser_*");
  expect(state?.sections?.browser_workflows).not.toContain("backend:");
  expect(state?.sections?.chart_visuals).not.toContain("12 nodes");
  expect(state?.sections?.conditional).not.toContain("Browser condition.");
});

test("hidden declarations do not enable detailed guidance", () => {
  const h = harness(["browser_snapshot"]);
  expect(h.options.sections.browser_workflows).not.toContain("backend:");
  expect(getCurrentSystemMessage(h.project(h.messages))?.sections?.browser_workflows).not.toContain(
    "backend:",
  );
});
