import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { resolveTranscriptTools } from "../../node_modules/@earendil-works/pi-ai/dist/utils/transcript.js";
import { AgentSession } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js";
import {
  type BuildSystemPromptOptions,
  buildSystemPrompt,
  buildSystemPromptSections,
  normalizeBuildSystemPromptOptions,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { registerChartGuidance } from "../chart/prompt";
import instructionFragments from "../instruction-fragments";
import agentMentions from "../mentions/agent-mentions";
import projectReferences from "../mentions/project-references";

type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
) => BeforeAgentStartEventResult | undefined | Promise<BeforeAgentStartEventResult | undefined>;

type TransformContext = (messages: AgentMessage[]) => Promise<AgentMessage[]>;
interface ProjectionHarness {
  agent: { transformContext?: TransformContext };
  _runSystemPromptOptions: BuildSystemPromptOptions;
}

const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
const previousCapabilities = getCapabilities();
let directory: string | undefined;
const shutdownHandlers: (() => void)[] = [];

afterEach(() => {
  for (const shutdown of shutdownHandlers.splice(0)) shutdown();
  setCapabilities(previousCapabilities);
  if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
  if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
});

test("prompt hooks preserve the leading tool set across deferred loads and later user requests", async () => {
  directory = mkdtempSync(join(tmpdir(), "pi-prompt-cache-"));
  const cwd = directory;
  mkdirSync(join(directory, "instructions"));
  mkdirSync(join(directory, "agents"));
  writeFileSync(join(directory, "instructions", "global.md"), "Stable instructions.");
  writeFileSync(
    join(directory, "agents", "explore.md"),
    "---\ndescription: Explore\n---\nExplore.",
  );
  process.env.PI_CODING_AGENT_DIR = directory;
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });

  const handlers: BeforeAgentStartHandler[] = [];
  const pi = {
    on(name: string, handler: unknown) {
      if (name === "before_agent_start") handlers.push(handler as BeforeAgentStartHandler);
      if (name === "session_shutdown") shutdownHandlers.push(handler as () => void);
    },
    getAllTools: () => [{ name: "read" }, { name: "subagent" }, { name: "chart_line" }],
    getActiveTools: () => ["read", "subagent"],
    registerMarkdownTransformer() {},
  } as unknown as ExtensionAPI;
  instructionFragments(pi);
  registerChartGuidance(pi);
  projectReferences(pi, directory);
  agentMentions(pi);

  const context = { cwd, mode: "tui", hasUI: true } as ExtensionContext;
  async function beforeStart(prompt: string) {
    const options = normalizeBuildSystemPromptOptions({ cwd, customPrompt: "Stable base." });
    const event: BeforeAgentStartEvent = {
      type: "before_agent_start",
      prompt,
      systemPrompt: buildSystemPrompt(options),
      systemPromptOptions: options,
    };
    const messages: NonNullable<BeforeAgentStartEventResult["message"]>[] = [];
    for (const handler of handlers) {
      const result = await handler(event, context);
      if (result?.systemPrompt !== undefined) options.forceSystemPrompt = result.systemPrompt;
      if (result?.message) messages.push(result.message);
    }
    return { options, messages };
  }

  const first = await beforeStart("@explore inspect this project");
  expect(first.options.forceSystemPrompt).toBeUndefined();
  expect(first.options.sections.global_instruction_fragments).toBe("Stable instructions.");
  expect(first.options.sections.chart_visuals).toContain("tool_search");
  expect(first.messages).toHaveLength(1);

  const read: Tool = {
    name: "read",
    description: "Read",
    parameters: { type: "object", properties: {} },
  };
  const deferred: Tool = { ...read, name: "web_search", description: "Search" };
  const leadingSections = buildSystemPromptSections(first.options);
  const leading: AgentMessage = {
    role: "system",
    content: "",
    sections: leadingSections,
    toolsAdded: [read],
    timestamp: 0,
  };
  const messages: AgentMessage[] = [
    leading,
    { role: "user", content: "@explore inspect this project", timestamp: 1 },
    { role: "system", content: "", toolsAdded: [deferred], timestamp: 2 },
    { role: "user", content: "Continue without delegation", timestamp: 3 },
  ];

  // Exercise Pi's real projection: a full-prompt return would hoist the deferred tool into the head.
  const harness: ProjectionHarness = { agent: {}, _runSystemPromptOptions: first.options };
  const prototype = AgentSession.prototype as unknown as {
    _installAgentForcedPromptProjection(this: ProjectionHarness): void;
  };
  prototype._installAgentForcedPromptProjection.call(harness);
  const transform = harness.agent.transformContext;
  if (transform === undefined) throw new Error("Pi did not install its prompt projection");
  const projected = await transform(messages);
  expect(projected[0]).toBe(leading);
  expect(projected[2]).toBe(messages[2]);
  expect(resolveTranscriptTools(projected, true).requestTools.map(({ name }) => name)).toEqual([
    "read",
  ]);

  const next = await beforeStart("Continue without delegation");
  expect(next.options.forceSystemPrompt).toBeUndefined();
  expect(next.messages).toEqual([]);
  expect(buildSystemPromptSections(next.options)).toEqual(leadingSections);
  harness._runSystemPromptOptions = next.options;
  expect(await transform(messages)).toEqual(projected);
});
