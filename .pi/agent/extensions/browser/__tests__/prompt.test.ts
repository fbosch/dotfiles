import { describe, expect, test } from "bun:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { normalizeBuildSystemPromptOptions } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import browserExtension from "..";

type StartHandler = (event: BeforeAgentStartEvent) => void;

function createHarness() {
  const tools: ToolDefinition[] = [];
  let handler: StartHandler | undefined;
  let visibleNames: readonly string[] | undefined;
  const pi = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    getAllTools: () => tools.filter((tool) => visibleNames?.includes(tool.name) ?? true),
    on(name: string, candidate: StartHandler) {
      if (name === "before_agent_start") handler = candidate;
    },
  } as unknown as ExtensionAPI;
  browserExtension(pi);
  const event = {
    type: "before_agent_start",
    prompt: "Interact with the existing Chrome page",
    systemPrompt: "base prompt",
    systemPromptOptions: normalizeBuildSystemPromptOptions({
      cwd: "/tmp",
      sections: { other: "Keep this section." },
    }),
  } as BeforeAgentStartEvent;
  return {
    event,
    tools,
    showTools(names: readonly string[]) {
      visibleNames = names;
    },
    start() {
      if (handler === undefined) throw new Error("browser prompt handler was not registered");
      handler(event);
      return event.systemPromptOptions.sections?.browser_workflows;
    },
  };
}

describe("browser routing guidance", () => {
  test("advertises MCP workflows before deferred tools are activated", () => {
    const h = createHarness();
    expect(
      h.tools.every((tool) => tool.exposure === "deferred" && tool.defaultActive === false),
    ).toBe(true);
    const guidance = h.start();
    expect(guidance).toContain("Use native `browser_*` tools first");
    expect(guidance).toContain("Chrome MCP and Firefox MCP");
    expect(guidance).toContain("tool_search");
    expect(guidance).toContain('backend: "chrome"');
    expect(guidance).toContain('backend: "firefox"');
    expect(guidance).toContain("Omitting backend selects agent-browser with Lightpanda");
    expect(guidance).toContain("existing MCP page");
    for (const tool of h.tools) expect(guidance).toContain(`- ${tool.name}:`);
    expect(guidance).toContain("deterministic interaction");
    expect(guidance).toContain("bounded multi-step");
    expect(guidance).toContain("navigation-only");
  });

  test("prefers browser_run for supported flows even when individual steps are obvious", () => {
    const guidance = createHarness().start();
    expect(guidance).toContain("Prefer `browser_run` for supported multi-step flows");
    expect(guidance).toContain("over separate browser_act or raw MCP calls");
    expect(guidance).toContain("even when individual steps are obvious");
    expect(guidance).toContain("Unique input matches already run deterministically");
    expect(guidance).toContain("inspection, a single explicit action");
    expect(guidance).toContain("does not derive new input values from page content");
  });

  test("bounds native MCP exceptions and prevents failed-action bypasses", () => {
    const guidance = createHarness().start();
    expect(guidance).toContain("operation the browser tools do not support");
    expect(guidance).toContain("console/network diagnostics");
    expect(guidance).toContain("arbitrary JavaScript");
    expect(guidance).toContain("dragging");
    expect(guidance).toContain("State why");
    expect(guidance).toContain("same page and backend");
    expect(guidance).toContain("Do not pass browser @eN aliases to raw MCP tools");
    expect(guidance).toContain("fresh browser_snapshot");
    expect(guidance).toContain("Do not bypass a denied or failed browser action");
    expect(guidance).toContain("workflow confidence or authorization stop");
    expect(guidance).toContain("replay a possibly completed action");
  });

  test("updates a structured section without duplicating or replacing the system prompt", () => {
    const h = createHarness();
    const guidance = h.start();
    expect(h.start()).toBe(guidance);
    expect(h.event.systemPromptOptions.sections?.other).toBe("Keep this section.");
    expect(h.event.systemPrompt).toBe("base prompt");
    expect(h.event.systemPromptOptions.forceSystemPrompt).toBeUndefined();
    h.showTools([]);
    expect(h.start()).toBe("");
    expect(h.event.systemPromptOptions.sections?.other).toBe("Keep this section.");
  });

  test("recommends only workflows available under the current tool restrictions", () => {
    const h = createHarness();
    h.showTools(["browser_snapshot"]);
    const guidance = h.start();
    expect(guidance).toContain("- browser_snapshot:");
    expect(guidance).not.toContain("- browser_open:");
    expect(guidance).not.toContain("- browser_run:");
    expect(guidance).not.toContain("Prefer `browser_run`");
    h.showTools(["browser_run"]);
    expect(h.start()).toContain("Prefer `browser_run` for supported multi-step flows");
    h.tools.forEach((tool) => {
      tool.exposure = "hidden";
    });
    expect(h.start()).toBe("");
  });
});
