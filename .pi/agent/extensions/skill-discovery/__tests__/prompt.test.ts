import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BeforeAgentStartEvent,
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
  SessionManager,
  type Skill,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  buildSystemPrompt,
  normalizeBuildSystemPromptOptions,
} from "@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
import { customStartEvent, userStartEvent } from "../../shared/__tests__/agent-start-events";
import { fullSkillCatalog } from "../../shared/skill-prompt";
import skillTweaks from "../../skill-tweaks";
import skillDiscovery from "../index";
import { DEFAULT_SKILL_SELECTION_CONFIG } from "../selection";

const previousDirectory = process.env.PI_CODING_AGENT_DIR;
const directories: string[] = [];
afterEach(() => {
  if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousDirectory;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

type Handler = (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown;
function harness(reverse = false, warmSkills = ["bun", "manual", "denied", "explicit-only"]) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-skill-prompt-"));
  directories.push(cwd);
  process.env.PI_CODING_AGENT_DIR = cwd;
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(
    join(cwd, "settings.json"),
    JSON.stringify({
      classifier: { toolDiscovery: { enabled: false } },
      skillTweaks: { warmSkills, disableModelInvocation: ["manual"] },
    }),
  );
  writeFileSync(
    join(cwd, ".pi/settings.json"),
    JSON.stringify({
      skillTweaks: { disableModelInvocation: ["denied"] },
    }),
  );
  const handlers: Handler[] = [];
  const tools = new Map<string, ToolDefinition>();
  const pi = {
    events: createEventBus(),
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    on(name: string, handler: Handler) {
      if (name === "before_agent_start") handlers.push(handler);
    },
    registerCommand() {},
    registerEntryRenderer() {},
    appendEntry() {},
  } as unknown as ExtensionAPI;
  const discovery = () =>
    skillDiscovery(pi, {
      getConfig: () => ({ ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: false }),
    });
  if (reverse) {
    skillTweaks(pi);
    discovery();
  } else {
    discovery();
    skillTweaks(pi);
  }
  const skills: Skill[] = ["bun", "local", "manual", "denied", "explicit-only"].map((name) => ({
    name,
    description: `${name} specialized workflow`,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: { scope: name === "local" ? "project" : "user" } as Skill["sourceInfo"],
    disableModelInvocation: name === "explicit-only",
  }));
  const context = {
    cwd,
    isProjectTrusted: () => true,
    sessionManager: SessionManager.inMemory(cwd),
  } as unknown as ExtensionContext;
  return {
    cwd,
    skills,
    tools,
    async start(
      selectedTools: readonly string[] = ["read", "skill_search"],
      hiddenTools: readonly string[] = [],
      custom = false,
    ) {
      const options = normalizeBuildSystemPromptOptions({
        cwd,
        selectedTools: [...selectedTools],
        hiddenTools: [...hiddenTools],
        skills: [...skills],
        sections: { other: "Keep this section." },
        toolGuidelines: { skill_search: tools.get("skill_search")?.promptGuidelines ?? [] },
      });
      const event = {
        ...(custom ? customStartEvent() : userStartEvent("Run tests")),
        systemPromptOptions: options,
      };
      for (const handler of handlers) await handler(event, context);
      return {
        options,
        prompt: buildSystemPrompt(options),
        catalog: fullSkillCatalog(pi.events, options),
      };
    },
    async search(query: string) {
      const tool = tools.get("skill_search");
      if (!tool) throw new Error("skill_search not registered");
      return tool.execute("search", { query, limit: 3 }, undefined, undefined, {
        ...context,
        tools: [],
        executeTool: async () => {
          throw new Error("Unexpected nested call");
        },
      });
    },
  };
}

test.each([false, true])(
  "search retains the full catalog in either hook order, reverse=%s",
  async (reverse) => {
    const h = harness(reverse);
    const initial = await h.start();
    expect(initial.options.skills.map((skill) => skill.name)).toEqual(["bun"]);
    expect(initial.prompt).toContain("<name>bun</name>");
    expect(initial.prompt).not.toContain("<name>local</name>");
    expect(initial.prompt).toContain(
      "For specialized work not covered by the advertised skills, use skill_search",
    );
    expect(initial.prompt).toContain("Read the selected SKILL.md");
    expect(initial.prompt).toContain("Explicit /skill:name");
    expect(initial.options.sections.other).toBe("Keep this section.");
    expect(initial.catalog).toEqual(h.skills);
    for (const name of ["bun", "local"]) {
      const found = await h.search(name);
      expect(found.details).toMatchObject({ matches: [name], rankingSource: "lexical" });
      expect(JSON.stringify(found.content)).toContain(`/skills/${name}/SKILL.md`);
    }
    for (const name of ["manual", "denied", "explicit-only"]) {
      expect((await h.search(name)).details).toMatchObject({ matches: [] });
    }
    const next = await h.start();
    expect(next.catalog).toEqual(h.skills);
    expect(next.options.skills.map((skill) => skill.name)).toEqual(["bun"]);
  },
);

test.each(["read", "bash"])(
  "warm metadata and skill search work with the %s reader and custom starts",
  async (reader) => {
    const h = harness();
    const result = await h.start([reader, "skill_search"], [], true);
    expect(result.options.skills.map((skill) => skill.name)).toEqual(["bun"]);
    expect((await h.search("local")).details).toMatchObject({ matches: ["local"] });
  },
);

test.each([
  { selected: ["read"], hidden: [] },
  { selected: ["read", "skill_search"], hidden: ["skill_search"] },
])(
  "restricted agents retain permitted metadata when discovery is unavailable: %j",
  async ({ selected, hidden }) => {
    const h = harness();
    const result = await h.start(selected, hidden);
    expect(result.options.skills.map((skill) => skill.name)).toEqual(["bun", "local"]);
  },
);

test("a hidden reader does not enable discovery-only routing", async () => {
  const h = harness();
  const result = await h.start(["read", "skill_search"], ["read"]);
  expect(result.options.skills).toEqual(h.skills);
});
test("an empty warm list still exposes skill discovery", async () => {
  const h = harness(false, []);
  const result = await h.start();
  expect(result.options.skills).toEqual([]);
  expect(result.prompt).toContain("use skill_search");
  expect((await h.search("local")).details).toMatchObject({ matches: ["local"] });
});

test("a global warm list can explicitly advertise a project-scoped skill", async () => {
  const h = harness(false, ["local"]);
  expect((await h.start()).options.skills.map((skill) => skill.name)).toEqual(["local"]);
});

test("project warmth and cold overrides do not bypass invocation restrictions", async () => {
  const h = harness();
  writeFileSync(
    join(h.cwd, ".pi/settings.json"),
    JSON.stringify({
      skillTweaks: {
        warmSkills: ["local", "denied"],
        coldSkills: ["bun"],
        disableModelInvocation: ["denied"],
      },
    }),
  );
  const result = await h.start();
  expect(result.options.skills.map((skill) => skill.name)).toEqual(["local"]);
  expect((await h.search("bun")).details).toMatchObject({ matches: ["bun"] });
  expect((await h.search("denied")).details).toMatchObject({ matches: [] });
});
