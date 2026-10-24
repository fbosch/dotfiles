import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Pi from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CHILD_PROTOCOL_TOOLS, createChildSession } from "../child-session";
import type { ResolvedSpecialist } from "../specialist";

const sdk: typeof Pi = process.env.PI_SUBAGENT_TEST_SDK
  ? await import(process.env.PI_SUBAGENT_TEST_SDK)
  : Pi;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "minimal-child-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".pi/extensions"), { recursive: true });
  await writeFile(
    join(cwd, ".pi/extensions/ambient.ts"),
    'export default function () { throw new Error("AMBIENT_EXTENSION_LOADED"); }',
  );
  await writeFile(join(cwd, "policy.ts"), "export default function () {}\n");
  await writeFile(join(cwd, "AGENTS.md"), "PROJECT_INSTRUCTION_MUST_REMAIN\n");
  const skillDir = join(cwd, "selected-skill");
  await mkdir(skillDir);
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: selected-skill\ndescription: Selected catalog entry\n---\nSKILL_BODY_NOT_PRELOADED\n",
  );
  const models = await sdk.ModelRuntime.create({
    authPath: join(cwd, "auth.json"),
    modelsPath: join(cwd, "models.json"),
    modelsStorePath: join(cwd, "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const model = models.getModels()[0];
  if (!model) throw new Error("Fixture needs an installed static model catalog");
  const config: ResolvedSpecialist = {
    name: "fixture",
    description: "Fixture role",
    prompt: "ROLE_IDENTITY_MUST_REMAIN",
    model: `${model.provider}/${model.id}`,
    maxTurns: 12,
    tools: ["read", "codemode", "tool_search"],
    excludeTools: ["subagent", "mcp__*"],
    extensions: [join(cwd, "policy.ts")],
    skills: [{ name: "selected-skill", path: join(skillDir, "SKILL.md") }],
  };
  const calls = { allowed: 0, forbidden: 0, parent: 0 };
  const protocol: Pi.ExtensionFactory = (pi) => {
    for (const name of [...CHILD_PROTOCOL_TOOLS, "forbidden", "subagent"])
      pi.registerTool({
        name,
        label: name,
        description: name,
        parameters: Type.Object({}),
        async execute() {
          if (name === "forbidden") calls.forbidden++;
          if (name === "subagent") calls.parent++;
          return { content: [{ type: "text", text: "FIXTURE_TOOL_RESULT" }], details: undefined };
        },
      });
    pi.registerTool({
      name: "allowed_probe",
      label: "allowed_probe",
      description: "Permitted fixture probe",
      parameters: Type.Object({}),
      async execute() {
        calls.allowed++;
        return { content: [{ type: "text", text: "ALLOWED_PROBE_OK" }], details: undefined };
      },
    });
  };
  return { cwd, model, config, protocol, calls };
}

test("explicit child tools remain callable when an extension lazily deactivates them at startup", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  const toolName = "structural_probe";
  const protocol: Pi.ExtensionFactory = (pi) => {
    f.protocol(pi);
    pi.registerTool({
      name: toolName,
      label: toolName,
      description: toolName,
      parameters: Type.Object({}),
      async execute() {
        return { content: [{ type: "text", text: "STRUCTURAL_OK" }], details: undefined };
      },
    });
    pi.on("session_start", () => {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== toolName));
    });
  };
  const child = await createChildSession({
    ...f,
    protocol,
    config: { ...f.config, tools: [...f.config.tools, toolName] },
    agentDir: f.cwd,
    sdk,
    onUncertainStartup: (error) => {
      uncertain.push(error);
    },
  });
  cleanups.push(child.close);
  expect(child.session.getCallableToolNames()).toContain(toolName);
  expect(child.session.getCallableToolNames()).not.toContain("forbidden");
  expect(child.session.getCallableToolNames()).not.toContain("subagent");
  const tool = child.session.agent.state.tools.find((candidate) => candidate.name === toolName);
  expect(tool).toBeDefined();
  expect(await tool!.execute("probe", {})).toMatchObject({
    content: [{ type: "text", text: "STRUCTURAL_OK" }],
  });
  expect(uncertain).toEqual([]);
});

// The installed pi-lens uses host APIs newer than the pinned development SDK.
test.skipIf(!process.env.PI_SUBAGENT_TEST_SDK)(
  "installed structural tools survive pi-lens startup lazy loading",
  async () => {
    const f = await fixture();
    const uncertain: Error[] = [];
    const structural = ["ast_grep_outline", "lsp_navigation", "lens_diagnostics", "read_symbol"];
    const child = await createChildSession({
      ...f,
      config: {
        ...f.config,
        tools: [...f.config.tools, ...structural],
        extensions: [
          ...f.config.extensions,
          join(import.meta.dir, "../../../npm/node_modules/pi-lens/dist/index.js"),
        ],
      },
      agentDir: f.cwd,
      sdk,
      onUncertainStartup: (error) => {
        uncertain.push(error);
      },
    });
    cleanups.push(child.close);
    for (const name of structural) expect(child.session.getCallableToolNames()).toContain(name);
    expect(child.session.getCallableToolNames()).not.toContain("ast_grep_replace");
    expect(uncertain).toEqual([]);
  },
  15_000,
);

test("real child keeps project and role instructions with scoped skill metadata and no ambient extensions", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  const child = await createChildSession({
    ...f,
    agentDir: f.cwd,
    sdk,
    onUncertainStartup: (error) => {
      uncertain.push(error);
    },
  });
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

test("missing SDK skill loads do not block child startup or broaden tools", async () => {
  const f = await fixture();
  const missing = { name: "missing", path: join(f.cwd, "missing/SKILL.md") };
  const child = await createChildSession({
    ...f,
    agentDir: f.cwd,
    sdk,
    config: {
      ...f.config,
      skills: [...f.config.skills, missing],
      skippedSkills: ["catalog-missing"],
    },
    onUncertainStartup: () => {
      throw new Error("unexpected cleanup uncertainty");
    },
  });
  cleanups.push(child.close);
  expect(child.session.systemPrompt).toContain("Selected catalog entry");
  expect(child.session.systemPrompt).toContain("catalog-missing");
  expect(child.session.systemPrompt).toContain("missing");
  expect(child.warnings).toEqual(["Skipped unavailable skills: catalog-missing, missing"]);
  expect(child.session.getCallableToolNames()).not.toContain("forbidden");
  expect(child.session.getCallableToolNames()).not.toContain("subagent");
});

test.each([false, true])(
  "SDK omission does not load substitute skill metadata (%s)",
  async (substitute) => {
    const f = await fixture();
    const child = await createChildSession({
      ...f,
      agentDir: f.cwd,
      sdk: {
        ...sdk,
        loadSkills: (...args: Parameters<typeof sdk.loadSkills>) => {
          const loaded = sdk.loadSkills(...args);
          return {
            ...loaded,
            skills: substitute
              ? loaded.skills.map((skill) => ({
                  ...skill,
                  name: "other-skill",
                  description: "SUBSTITUTE_METADATA_MUST_NOT_LOAD",
                }))
              : [],
          };
        },
      },
      onUncertainStartup: () => {
        throw new Error("unexpected cleanup uncertainty");
      },
    });
    cleanups.push(child.close);
    expect(child.warnings).toEqual(["Skipped unavailable skills: selected-skill"]);
    expect(child.session.systemPrompt).not.toContain("Selected catalog entry");
    expect(child.session.systemPrompt).not.toContain("SUBSTITUTE_METADATA_MUST_NOT_LOAD");
    expect(child.session.systemPrompt).toContain("Skipped unavailable skills: selected-skill");
    expect(child.session.getCallableToolNames()).not.toContain("subagent");
  },
);

test("missing loaded tool fails preflight and confirms cleanup without executing a prompt", async () => {
  const f = await fixture();
  const uncertain: Error[] = [];
  await expect(
    createChildSession({
      ...f,
      config: { ...f.config, tools: ["missing_tool"] },
      agentDir: f.cwd,
      sdk,
      onUncertainStartup: (error) => {
        uncertain.push(error);
      },
    }),
  ).rejects.toThrow("Required child tool is unavailable");
  expect(uncertain).toEqual([]);
});

test("partial startup without a returned session records cleanup uncertainty and retains resources", async () => {
  const f = await fixture();
  const retained: readonly unknown[][] = [];
  const failures: Error[] = [];
  const resources: Array<readonly unknown[]> = [...retained];
  await expect(
    createChildSession({
      ...f,
      config: { ...f.config, extensions: [join(f.cwd, "missing.ts")] },
      agentDir: f.cwd,
      sdk,
      onUncertainStartup: (error, owned) => {
        failures.push(error);
        resources.push(owned);
      },
    }),
  ).rejects.toThrow("cleanup is unconfirmed");
  expect(failures).toHaveLength(1);
  expect(resources[0]?.[0]).toBeDefined();
});

test("native MCP connects only the selected server and registers required tools before returning", async () => {
  const f = await fixture();
  await writeFile(
    join(f.cwd, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [join(import.meta.dir, "fixtures/mcp-server.ts")],
        },
        ambient: { command: "/MUST_NOT_START_AMBIENT_SERVER" },
      },
    }),
  );
  const failures: Error[] = [];
  const child = await createChildSession({
    ...f,
    config: {
      ...f.config,
      mcpServers: ["fixture"],
      tools: [...f.config.tools, "mcp__fixture__lookup"],
      excludeTools: ["subagent"],
    },
    agentDir: f.cwd,
    sdk,
    onUncertainStartup: (error) => {
      failures.push(error);
    },
  });
  cleanups.push(child.close);
  expect(child.session.getCallableToolNames()).toContain("mcp__fixture__lookup");
  expect(
    child.session.getCallableToolNames().some((name) => name.startsWith("mcp__ambient__")),
  ).toBe(false);
  expect(failures).toEqual([]);
}, 15_000);

test("codemode executes permitted tools only and discovery respects the child loadout", async () => {
  const f = await fixture();
  await writeFile(
    join(f.cwd, "mcp.json"),
    JSON.stringify({
      mcpServers: {
        ambient: { command: "/MUST_NOT_START_AMBIENT_SERVER" },
      },
    }),
  );
  const child = await createChildSession({
    ...f,
    config: { ...f.config, tools: [...f.config.tools, "allowed_probe"] },
    agentDir: f.cwd,
    sdk,
    onUncertainStartup: () => {},
  });
  cleanups.push(child.close);

  const discovery = child.session.agent.state.tools.find((tool) => tool.name === "tool_search");
  expect(discovery).toBeDefined();
  const discoveryResult = await discovery!.execute("discover-forbidden", {
    query: "forbidden",
    limit: 5,
  });
  expect(discoveryResult.details).toMatchObject({ loaded: [] });
  expect(child.session.getActiveToolNames()).not.toContain("forbidden");

  child.session.agent.state.messages = [
    {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "fixture",
      model: "fixture",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: Date.now(),
    },
  ];
  const codemode = child.session.agent.state.tools.find((tool) => tool.name === "codemode");
  expect(codemode).toBeDefined();
  const context = child.session.extensionRunner.createToolContext(
    "codemode-permissions",
    undefined,
  );
  const input = {
    code: [
      "text(await tools.allowed_probe({}));",
      'text(ALL_TOOLS.some((tool) => tool.name === "forbidden") ? "FORBIDDEN_DISCOVERED" : "FORBIDDEN_HIDDEN");',
      'text((await searchTools("forbidden")).some((tool) => tool.name === "forbidden") ? "FORBIDDEN_SEARCHED" : "FORBIDDEN_UNSEARCHABLE");',
      'try { await tools.forbidden({}); text("FORBIDDEN_EXECUTED"); } catch { text("FORBIDDEN_BLOCKED"); }',
      'try { await tools.subagent({}); text("PARENT_EXECUTED"); } catch { text("PARENT_BLOCKED"); }',
      'try { await tools.mcp__ambient__lookup({}); text("MCP_EXECUTED"); } catch { text("MCP_BLOCKED"); }',
      "text(typeof models);",
    ].join("\n"),
  };
  // The runtime target is Pi 1.3.0; the development SDK types do not yet include its session context argument.
  const result = await codemode!.execute(
    "codemode-permissions",
    input,
    undefined,
    undefined,
    // @ts-expect-error Pi 0.99.1 has a four-argument AgentTool.execute signature.
    context,
  );
  const output = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  expect(output).toContain("ALLOWED_PROBE_OK");
  expect(output).toContain("FORBIDDEN_HIDDEN");
  expect(output).toContain("FORBIDDEN_UNSEARCHABLE");
  expect(output).toContain("FORBIDDEN_BLOCKED");
  expect(output).toContain("PARENT_BLOCKED");
  expect(output).toContain("MCP_BLOCKED");
  expect(output).toContain("undefined");
  expect(f.calls).toEqual({ allowed: 1, forbidden: 0, parent: 0 });
});
