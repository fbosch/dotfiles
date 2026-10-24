import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AgentSession, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Test the installed host with PI_SUBAGENT_TEST_SDK; normal project tests use the pinned SDK.
const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(
  extensionFactories: ExtensionFactory[],
  additionalExtensionPaths: string[] = [],
  tools = ["probe_dispatch", "probe_allowed", "probe_blocked", "mcp__fixture__allowed"],
) {
  const cwd = await mkdtemp(resolve(tmpdir(), "pi-subagent-feasibility-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  if (additionalExtensionPaths.some((path) => path.includes("pi-hashline-edit-pro"))) {
    // Hashline owns a separate state directory; agentDir alone does not isolate it.
    const previous = process.env.PI_HASHLINE_DIR;
    process.env.PI_HASHLINE_DIR = resolve(cwd, "hashline");
    cleanup.push(async () => {
      if (previous === undefined) delete process.env.PI_HASHLINE_DIR;
      else process.env.PI_HASHLINE_DIR = previous;
    });
  }
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off" });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: resolve(cwd, "auth.json"),
    modelsPath: resolve(cwd, "models.json"),
    modelsStorePath: resolve(cwd, "catalog.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths,
    extensionFactories,
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const { session } = await sdk.createAgentSession({
    cwd,
    agentDir: cwd,
    settingsManager,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(cwd),
    tools,
    excludeTools: ["subagent", "get_subagent_result", "steer_subagent"],
  });
  cleanup.push(async () => {
    await session.abort();
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  });
  await session.bindExtensions({
    onError: (error) => {
      throw new Error(JSON.stringify(error));
    },
  });
  return { session, loader, cwd };
}

test("allowlists constrain nested dispatch and late MCP registrations; policy hooks still execute", async () => {
  const executed: string[] = [];
  const intercepted: string[] = [];
  let addLateTool: (() => void) | undefined;
  const extension: ExtensionFactory = (pi) => {
    function register(name: string) {
      pi.registerTool({
        name,
        label: name,
        description: "Harmless capability probe",
        parameters: Type.Object({}),
        exposure: "codemode",
        async execute() {
          executed.push(name);
          return { content: [{ type: "text", text: name }], details: undefined };
        },
      });
    }
    for (const name of [
      "probe_allowed",
      "probe_blocked",
      "probe_forbidden",
      "mcp__fixture__allowed",
      "mcp__fixture__forbidden",
      "subagent",
    ])
      register(name);
    addLateTool = () => register("mcp__fixture__late");
    pi.on("tool_call", (event) => {
      intercepted.push(event.toolName);
      if (event.toolName === "probe_blocked")
        return { block: true, reason: "fixture policy denied" };
    });
    pi.registerTool({
      name: "probe_dispatch",
      label: "Dispatch probe",
      description: "Exercise the public nested tool pipeline without a model request",
      parameters: Type.Object({ name: Type.String() }),
      async execute(_id, args, signal, _update, ctx) {
        const outcome = await ctx.executeTool(args.name, {}, signal ? { signal } : {});
        return { ...outcome.result, isError: outcome.isError };
      },
    });
  };
  const { session } = await fixture([extension]);
  const dispatch = session.agent.state.tools.find((tool) => tool.name === "probe_dispatch");
  if (!dispatch || !addLateTool) throw new Error("Probe setup incomplete");
  const call = (name: string) => callTool(session, "probe_dispatch", { name });
  expect(session.getCallableToolNames().sort()).toEqual([
    "mcp__fixture__allowed",
    "probe_allowed",
    "probe_blocked",
    "probe_dispatch",
  ]);
  await call("probe_allowed");
  await call("mcp__fixture__allowed");
  const blocked = await call("probe_blocked");
  expect(JSON.stringify(blocked)).toContain("fixture policy denied");
  expect(executed).toEqual(["probe_allowed", "mcp__fixture__allowed"]);
  expect(intercepted).toContain("probe_allowed");
  expect(intercepted).toContain("probe_blocked");
  addLateTool();
  expect(session.getCallableToolNames()).not.toContain("mcp__fixture__late");
  for (const name of [
    "probe_forbidden",
    "mcp__fixture__forbidden",
    "mcp__fixture__late",
    "subagent",
  ]) {
    const denied = await call(name);
    expect(denied.isError).toBe(true);
  }
});

test("reload awaits shutdown and process-scoped state survives loader replacement", async () => {
  const events: string[] = [];
  const key = `pi-subagent-feasibility-${crypto.randomUUID()}`;
  cleanup.push(async () => {
    Reflect.deleteProperty(process, key);
  });
  const extension: ExtensionFactory = (pi) => {
    events.push(Reflect.has(process, key) ? "load:blocked" : "load:healthy");
    pi.on("session_shutdown", async (event) => {
      events.push(`shutdown:${event.reason}`);
      await Promise.resolve();
      Reflect.set(process, key, { cleanupUnknown: true });
      events.push("shutdown:settled");
    });
    pi.on("session_start", () => {
      events.push("start");
    });
  };
  const { session } = await fixture([extension]);
  events.length = 0;
  await session.reload();
  expect(events).toEqual(["shutdown:reload", "shutdown:settled", "load:blocked", "start"]);
  const other = await fixture([extension]);
  expect(events.at(-2)).toBe("load:blocked");
  expect(other.session.sessionManager.getSessionId()).not.toBe(
    session.sessionManager.getSessionId(),
  );
});

function callTool(session: AgentSession, name: string, args: Record<string, string>) {
  const tool = session.agent.state.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing probe tool: ${name}`);
  // This synthetic envelope exercises real nested dispatch without a provider request.
  session.agent.state.messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: "probe", name, arguments: args }],
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
      timestamp: 0,
    },
  ];
  return tool.execute("probe", args, new AbortController().signal);
}

test("explicit hashline, provider hooks, codemode, and command guard load without ambient extensions", async () => {
  let shellExecutions = 0;
  const shellStub: ExtensionFactory = (pi) => {
    pi.registerTool({
      name: "bash",
      label: "Harmless shell stub",
      description: "Harmless shell stub",
      parameters: Type.Object({ command: Type.String() }),
      async execute() {
        shellExecutions++;
        return { content: [{ type: "text", text: "stub only" }], details: undefined };
      },
    });
  };
  const agentDir = resolve(import.meta.dir, "../../..");
  const paths = [
    resolve(agentDir, "npm/node_modules/pi-hashline-edit-pro/index.ts"),
    resolve(agentDir, "extensions/catastrophic-command-guard.ts"),
    resolve(agentDir, "extensions/model-presets.ts"),
    resolve(agentDir, "extensions/openai-capabilities.ts"),
  ];
  const { session, loader, cwd } = await fixture(
    [shellStub, sdk.createCodemodeExtension({ models: false }), sdk.createToolSearchExtension()],
    paths,
    ["read", "bash", "codemode", "tool_search"],
  );
  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(
    expect.arrayContaining(paths),
  );
  expect(session.getCallableToolNames()).toContain("read");
  expect(session.getCallableToolNames()).not.toContain("subagent");
  expect(session.extensionRunner.getToolDefinition("bash")?.description).toBe(
    "Harmless shell stub",
  );
  const input = resolve(cwd, "probe.txt");
  await writeFile(input, "HASHLINE_FIXTURE\n");
  const read = await callTool(session, "codemode", {
    code: `text(JSON.stringify(await tools.read({ path: ${JSON.stringify(input)}, anchors: true })));`,
  });
  expect(read.isError).not.toBe(true);
  expect(JSON.stringify(read.content)).toContain("HASHLINE_FIXTURE");
  expect(JSON.stringify(read.content)).toContain("│");
  expect(await Bun.file(resolve(cwd, "hashline", "hash-store.sqlite")).exists()).toBe(true);
  const blocked = await callTool(session, "codemode", {
    code: 'await tools.bash({ command: "mkfs /dev/sda" });',
  });
  expect(JSON.stringify(blocked.content)).toContain("Script error:");
  expect(shellExecutions).toBe(0);
});

test("native ScrollView preserves manual position and resumes following", async () => {
  const tui: typeof import("@earendil-works/pi-tui") = await import(
    process.env.PI_SUBAGENT_TEST_TUI ?? "@earendil-works/pi-tui"
  );
  const content = new tui.Text(["one", "two", "three"].join("\n"), 0, 0);
  const viewport = new tui.ScrollView(content, { follow: "end", scrollbar: "hidden" });
  viewport.updateLayout(20, 4, () => {});
  expect(viewport.scrollTop).toBe(16);
  viewport.scrollBy(-5);
  viewport.updateLayout(24, 4, () => {});
  expect(viewport.scrollTop).toBe(11);
  expect(viewport.isFollowingEnd).toBe(false);
  viewport.scrollToEnd();
  expect(viewport.scrollTop).toBe(20);
  expect(viewport.isFollowingEnd).toBe(true);
  for (const width of [12, 40, 80]) {
    expect(content.render(width).every((line) => tui.visibleWidth(line) <= width)).toBe(true);
  }
});
