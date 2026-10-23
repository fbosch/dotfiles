import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Pi from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CHILD_PROTOCOL_TOOLS, createChildSession } from "../child-session";
import type { ResolvedSpecialist } from "../specialist";

const sdk: typeof Pi = process.env.PI_SUBAGENT_TEST_SDK ? await import(process.env.PI_SUBAGENT_TEST_SDK) : Pi;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "minimal-child-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi/extensions"), { recursive: true });
  await writeFile(join(cwd, ".pi/extensions/ambient.ts"), 'export default function () { throw new Error("AMBIENT_EXTENSION_LOADED"); }');
  await writeFile(join(cwd, "policy.ts"), "export default function () {}\n");
  await writeFile(join(cwd, "AGENTS.md"), "PROJECT_INSTRUCTION_MUST_REMAIN\n");
  const skillDir = join(cwd, "selected-skill");
  await mkdir(skillDir);
  await writeFile(join(skillDir, "SKILL.md"), "---\nname: selected-skill\ndescription: Selected catalog entry\n---\nSKILL_BODY_NOT_PRELOADED\n");
  const models = await sdk.ModelRuntime.create({ authPath: join(cwd, "auth.json"), modelsPath: join(cwd, "models.json"), modelsStorePath: join(cwd, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  const model = models.getModels()[0];
  if (!model) throw new Error("Fixture needs an installed static model catalog");
  const config: ResolvedSpecialist = {
    name: "fixture", description: "Fixture role", prompt: "ROLE_IDENTITY_MUST_REMAIN", model: `${model.provider}/${model.id}`, maxTurns: 12,
    tools: ["read", "codemode", "tool_search"], excludeTools: ["subagent", "mcp__*"],
    extensions: [join(cwd, "policy.ts")], skills: [{ name: "selected-skill", path: join(skillDir, "SKILL.md") }],
  };
  const protocol: Pi.ExtensionFactory = (pi) => {
    for (const name of [...CHILD_PROTOCOL_TOOLS, "forbidden", "subagent"]) pi.registerTool({
      name, label: name, description: name, parameters: Type.Object({}),
      async execute() { return { content: [{ type: "text", text: "fixture" }], details: undefined }; },
    });
  };
  return { cwd, model, config, protocol };
}

test("explicit child tools remain callable when an extension lazily deactivates them at startup", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  const toolName = "structural_probe";
  const protocol: Pi.ExtensionFactory = (pi) => {
    f.protocol(pi);
    pi.registerTool({
      name: toolName, label: toolName, description: toolName, parameters: Type.Object({}),
      async execute() { return { content: [{ type: "text", text: "STRUCTURAL_OK" }], details: undefined }; },
    });
    pi.on("session_start", () => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== toolName));
    });
  };
  const child = await createChildSession({ ...f, protocol,
    config: { ...f.config, tools: [...f.config.tools, toolName] },
    agentDir: f.cwd, sdk, onUncertainStartup: (error) => { uncertain.push(error); },
  });
  cleanups.push(child.close);
  expect(child.session.getCallableToolNames()).toContain(toolName);
  expect(child.session.getCallableToolNames()).not.toContain("forbidden");
  expect(child.session.getCallableToolNames()).not.toContain("subagent");
  const tool = child.session.agent.state.tools.find((candidate) => candidate.name === toolName);
  expect(tool).toBeDefined();
  expect(await tool!.execute("probe", {})).toMatchObject({ content: [{ type: "text", text: "STRUCTURAL_OK" }] });
  expect(uncertain).toEqual([]);
});

// The installed pi-lens uses host APIs newer than the pinned development SDK.
test.skipIf(!process.env.PI_SUBAGENT_TEST_SDK)("installed structural tools survive pi-lens startup lazy loading", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  const structural = ["ast_grep_outline", "lsp_navigation", "lens_diagnostics", "read_symbol"];
  const child = await createChildSession({ ...f,
    config: { ...f.config,
      tools: [...f.config.tools, ...structural],
      extensions: [...f.config.extensions, join(import.meta.dir, "../../../npm/node_modules/pi-lens/dist/index.js")],
    },
    agentDir: f.cwd, sdk, onUncertainStartup: (error) => { uncertain.push(error); },
  });
  cleanups.push(child.close);
  for (const name of structural) expect(child.session.getCallableToolNames()).toContain(name);
  expect(child.session.getCallableToolNames()).not.toContain("ast_grep_replace");
  expect(uncertain).toEqual([]);
}, 15_000);

test("real child keeps project and role instructions with scoped skill metadata and no ambient extensions", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  const child = await createChildSession({ ...f, agentDir: f.cwd, sdk, onUncertainStartup: (error) => { uncertain.push(error); } });
  cleanups.push(child.close);
  expect(child.session.messages).toEqual([]);
  expect(child.session.systemPrompt).toContain("PROJECT_INSTRUCTION_MUST_REMAIN");
  expect(child.session.systemPrompt).toContain("ROLE_IDENTITY_MUST_REMAIN");
  expect(child.session.systemPrompt).toContain("Selected catalog entry");
  expect(child.session.systemPrompt).not.toContain("SKILL_BODY_NOT_PRELOADED");
  expect(child.session.getCallableToolNames()).not.toContain("subagent");
  expect(child.session.getCallableToolNames()).not.toContain("forbidden");
  expect(uncertain).toEqual([]);
});

test("missing loaded tool fails preflight and confirms cleanup without executing a prompt", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  await expect(createChildSession({ ...f, config: { ...f.config, tools: ["missing_tool"] }, agentDir: f.cwd, sdk,
    onUncertainStartup: (error) => { uncertain.push(error); },
  })).rejects.toThrow("Required child tool is unavailable");
  expect(uncertain).toEqual([]);
});

test("partial startup without a returned session records cleanup uncertainty and retains resources", async () => {
  const f = await fixture();
  const retained: readonly unknown[][] = [];
  const failures: Error[] = [];
  const resources: Array<readonly unknown[]> = [...retained];
  await expect(createChildSession({ ...f, config: { ...f.config, extensions: [join(f.cwd, "missing.ts")] }, agentDir: f.cwd, sdk,
    onUncertainStartup: (error, owned) => { failures.push(error); resources.push(owned); },
  })).rejects.toThrow("cleanup is unconfirmed");
  expect(failures).toHaveLength(1);
  expect(resources[0]?.[0]).toBeDefined();
});

test("native MCP connects only the selected server and registers required tools before returning", async () => {
  const f = await fixture();
  await writeFile(join(f.cwd, "mcp.json"), JSON.stringify({ mcpServers: {
    fixture: { command: process.execPath, args: [join(import.meta.dir, "fixtures/mcp-server.ts")] },
    ambient: { command: "/MUST_NOT_START_AMBIENT_SERVER" },
  } }));
  const failures: Error[] = [];
  const child = await createChildSession({ ...f, config: { ...f.config,
    mcpServers: ["fixture"], tools: [...f.config.tools, "mcp__fixture__lookup"], excludeTools: ["subagent"],
  }, agentDir: f.cwd, sdk, onUncertainStartup: (error) => { failures.push(error); } });
  cleanups.push(child.close);
  expect(child.session.getCallableToolNames()).toContain("mcp__fixture__lookup");
  expect(child.session.getCallableToolNames().some((name) => name.startsWith("mcp__ambient__"))).toBe(false);
  expect(failures).toEqual([]);
}, 15_000);
