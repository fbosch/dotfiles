import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import skillDiscoveryExtension from "../index";

const skills: Skill[] = [
  {
    name: "alpha",
    description: "Inspect a system and identify the cause of a failure",
    filePath: "/skills/alpha/SKILL.md",
    baseDir: "/skills/alpha",
    sourceInfo: {
      path: "/skills/alpha/SKILL.md",
      source: "test",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: false,
  },
  {
    name: "beta",
    description: "Design regression tests for a confirmed failure",
    filePath: "/skills/beta/SKILL.md",
    baseDir: "/skills/beta",
    sourceInfo: {
      path: "/skills/beta/SKILL.md",
      source: "test",
      scope: "user",
      origin: "top-level",
    },
    disableModelInvocation: false,
  },
];

test("skill_search explores complementary workflows and looks up exact names without loading instructions", async () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const directory = mkdtempSync(join(tmpdir(), "skill-search-frontend-"));
  writeFileSync(
    join(directory, "settings.json"),
    JSON.stringify({
      classifier: {
        provider: "typesafe",
        model: "jev-1.12",
        api: "typesafe-classifier",
        toolDiscovery: { enabled: true },
        skillSelection: { enabled: false },
      },
    }),
  );
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const tools: ToolDefinition[] = [];
    const handlers: Array<(event: BeforeAgentStartEvent, context: ExtensionContext) => unknown> =
      [];
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const api = {
      events: {
        emit(name: string, value: unknown) {
          for (const handler of listeners.get(name) ?? []) handler(value);
        },
        on(name: string, handler: (value: unknown) => void) {
          const entries = listeners.get(name) ?? new Set();
          entries.add(handler);
          listeners.set(name, entries);
          return () => {
            entries.delete(handler);
          };
        },
      },
      registerTool(tool: ToolDefinition) {
        tools.push(tool);
      },
      registerEntryRenderer() {},
      registerCommand() {},
      on(
        name: string,
        handler: (event: BeforeAgentStartEvent, context: ExtensionContext) => unknown,
      ) {
        if (name === "before_agent_start") handlers.push(handler);
      },
    } as unknown as ExtensionAPI;
    let calls = 0;
    const registry = await createNativeClassifierRegistry();
    registry.classify = async (model, input) => {
      calls++;
      if (!isMatching({ candidates: P.array({ id: P.string, name: P.string }) }, input.state))
        throw new Error("candidate state missing");
      expect(
        Object.values(input.questions).every(
          (question) => question.type === "bool" && question.instructions.includes("workflow"),
        ),
      ).toBe(true);
      return {
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: 0,
        stopReason: "stop",
        answers: Object.fromEntries(
          input.state.candidates.map((candidate) => [
            candidate.id,
            { type: "bool" as const, probability: candidate.name === "alpha" ? 0.9 : 0.8 },
          ]),
        ),
      };
    };
    const context = {
      cwd: directory,
      isProjectTrusted: () => false,
      modelRegistry: registry,
      tools: [],
      executeTool: async () => {
        throw new Error("discovery must not call tools");
      },
    } as unknown as ExtensionToolContext;
    skillDiscoveryExtension(api);
    const capture = handlers[0];
    if (!capture) throw new Error("catalog capture missing");
    await capture({ systemPromptOptions: { skills } } as BeforeAgentStartEvent, context);
    const search = tools.find((tool) => tool.name === "skill_search");
    if (!search) throw new Error("skill_search missing");
    const explore = await search.execute(
      "explore",
      { query: "diagnose a regression and protect against its return" },
      undefined,
      undefined,
      context,
    );
    expect(explore.isError).not.toBe(true);
    expect(explore.details).toMatchObject({
      rankingSource: "classifier",
      matches: ["alpha", "beta"],
    });
    expect(calls).toBe(1);
    const lookup = await search.execute(
      "lookup",
      { query: "beta", mode: "lookup" },
      undefined,
      undefined,
      context,
    );
    expect(lookup.details).toMatchObject({ rankingSource: "lookup", matches: ["beta"] });
    const prefix = await search.execute(
      "prefix",
      { query: "bet", mode: "lookup" },
      undefined,
      undefined,
      context,
    );
    expect(prefix.details).toMatchObject({ rankingSource: "lookup", matches: [] });
    expect(calls).toBe(1);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
