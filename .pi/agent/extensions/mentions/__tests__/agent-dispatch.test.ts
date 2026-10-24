import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import agentMentions from "../agent-mentions";

const sdk: typeof import("@earendil-works/pi-coding-agent") = await import(
  process.env.PI_SUBAGENT_TEST_SDK ?? "@earendil-works/pi-coding-agent"
);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

async function fixture(
  options: {
    malformedLaunch?: "launched" | "completed" | "question";
    foregroundKind?: "completed" | "question";
  } = {},
) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-mention-dispatch-"));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, "agents"));
  for (const [name, turns] of [
    ["review", 12],
    ["quick", 6],
  ] as const) {
    await writeFile(
      join(cwd, "agents", `${name}.md`),
      `---\ndescription: ${name} fixture\nmax_turns: ${turns}\n---\nPRIVATE ROLE BODY\n`,
    );
  }
  let reads = 0;
  let failLaunch = false;
  const launched: string[] = [];
  const ready = new Set<string>();
  const probes: ExtensionFactory = (pi) => {
    pi.registerTool({
      name: "read",
      label: "Canary read",
      description: "Read the fixture canary",
      parameters: Type.Object({ path: Type.String() }),
      async execute() {
        reads += 1;
        return {
          content: [{ type: "text", text: "canary" }],
          details: undefined,
        };
      },
    });
    pi.registerTool({
      name: "subagent",
      label: "Fixture launch",
      description: "Accept a fixture worker",
      parameters: Type.Object({
        specialist: Type.String(),
        prompt: Type.String(),
        foreground: Type.Optional(Type.Boolean()),
      }),
      async execute(_id, args) {
        if (failLaunch) throw new Error("Fixture preflight rejected");
        if (options.malformedLaunch)
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ kind: options.malformedLaunch, workerId: "incomplete" }),
              },
            ],
            details: undefined,
          };
        launched.push(args.specialist);
        if (args.foreground) {
          const kind = options.foregroundKind ?? "completed";
          const workerId = `worker-${args.specialist}`;
          const assignmentId = "assignment";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  kind,
                  worker: {
                    workerId,
                    specialist: args.specialist,
                    currentAssignmentId: assignmentId,
                  },
                  assignment: {
                    assignmentId,
                    outcome: kind === "completed" ? "completed" : "waiting-question",
                  },
                  ...(kind === "completed"
                    ? { report: "Checked foreground report" }
                    : {
                        question: {
                          id: "question",
                          text: "Choose a target",
                          workerId,
                          assignmentId,
                        },
                      }),
                }),
              },
            ],
            details: undefined,
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                kind: "launched",
                workerId: `worker-${args.specialist}`,
                assignmentId: "assignment",
              }),
            },
          ],
          details: undefined,
        };
      },
    });
    pi.registerTool({
      name: "subagent_result",
      label: "Fixture report",
      description: "Return a completed fixture report",
      parameters: Type.Object({
        request: Type.Object({ mode: Type.String(), workerId: Type.String() }),
      }),
      async execute(_id, args) {
        if (!ready.has(args.request.workerId)) throw new Error("Report is not ready");
        return {
          content: [{ type: "text", text: "Checked fixture prerequisite" }],
          details: undefined,
        };
      },
    });
  };
  const settingsManager = sdk.SettingsManager.inMemory({ cacheWarming: "off" });
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: join(cwd, "auth.json"),
    modelsPath: join(cwd, "models.json"),
    modelsStorePath: join(cwd, "catalog.json"),
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
    extensionFactories: [
      probes,
      (pi) => agentMentions(pi, cwd),
      sdk.createCodemodeExtension({ models: false }),
    ],
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
    tools: ["read", "subagent", "subagent_result", "codemode"],
  });
  cleanup.push(async () => {
    await session.abort();
    await session.extensionRunner.emit({
      type: "session_shutdown",
      reason: "quit",
    });
    session.dispose();
  });
  await session.bindExtensions({
    onError: (error) => {
      throw new Error(JSON.stringify(error));
    },
  });
  let id = 0;
  const code = (source: string) => callTool(session, `probe-${++id}`, source);
  const start = (
    prompt: string,
  ): ReturnType<typeof session.extensionRunner.emitBeforeAgentStart> => {
    const runner = session.extensionRunner;
    // The two supported SDKs expose different public before-agent-start trigger signatures.
    const emit = runner.emitBeforeAgentStart;
    if (emit.length === 2) {
      return Reflect.apply(emit, runner, [
        { messageType: "user", prompt, images: undefined },
        { cwd },
      ]);
    }
    if (emit.length === 3) return emit.call(runner, prompt, undefined, { cwd });
    throw new Error("Unsupported before-agent-start signature");
  };
  return {
    session,
    start,
    code,
    reads: () => reads,
    launched,
    failLaunch: () => {
      failLaunch = true;
    },
    ready: (name: string) => ready.add(`worker-${name}`),
  };
}

function callTool(session: AgentSession, id: string, code: string) {
  const tool = session.agent.state.tools.find((candidate) => candidate.name === "codemode");
  if (!tool) throw new Error("Codemode fixture missing");
  session.agent.state.messages = [
    {
      role: "assistant",
      content: [{ type: "toolCall", id, name: "codemode", arguments: { code } }],
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
  return tool.execute(id, { code }, new AbortController().signal);
}

test("an explicit mention dispatches before nested task-file inspection", async () => {
  const f = await fixture();
  const start = await f.start("@review inspect the canary");
  expect(start.messages?.length).toBeGreaterThan(0);
  const blocked = await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(0);
  expect(JSON.stringify(blocked)).toContain("Launch @review");
  const inspected = await f.code(`
    text(await tools.subagent({ specialist: "review", prompt: "Inspect the canary" }));
    text(await tools.read({ path: "canary" }));
  `);
  expect(f.launched).toEqual(["review"]);
  expect(f.reads(), JSON.stringify(inspected)).toBe(1);
});

test("selected specialist defaults are available without exposing the role body", async () => {
  const f = await fixture();
  const start = await f.start("@quick inspect the canary");
  const message = start.messages?.find(
    (entry) => entry.customType === "explicit-subagent-invocation",
  );
  if (typeof message?.content !== "string") throw new Error("Invocation message missing");
  const catalog = message.content.match(
    /<specialist-catalog>\n(.*?)\n<\/specialist-catalog>/s,
  )?.[1];
  expect(JSON.parse(catalog ?? "null")).toEqual([
    { name: "quick", description: "quick fixture", defaultMaxTurns: 6 },
  ]);
  expect(message.content).not.toContain("PRIVATE ROLE BODY");
});

test("independent mentions all dispatch before the parent inspects files", async () => {
  const f = await fixture();
  await f.start("@review and @quick independently inspect the canary");
  await f.code('text(await tools.subagent({ specialist: "review", prompt: "Review only" }));');
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(0);
  await f.code('text(await tools.subagent({ specialist: "quick", prompt: "Check only" }));');
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.launched).toEqual(["review", "quick"]);
  expect(f.reads()).toBe(1);
});

test("dependent mentions allow verification after the prerequisite report", async () => {
  const f = await fixture();
  await f.start("@review inspect first, then @quick use the verified findings");
  await f.code(
    'text(await tools.subagent({ specialist: "review", prompt: "Find the prerequisite" }));',
  );
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(0);
  f.ready("review");
  await f.code(
    'text(await tools.subagent_result({ request: { mode: "report", workerId: "worker-review" } }));',
  );
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(1);
  await f.code(
    'text(await tools.subagent({ specialist: "quick", prompt: "Use the checked prerequisite" }));',
  );
  expect(f.launched).toEqual(["review", "quick"]);
});

test("failed launch preflight leaves investigation blocked", async () => {
  const f = await fixture();
  await f.start("@review inspect the canary");
  f.failLaunch();
  const failed = await f.code(
    'text(await tools.subagent({ specialist: "review", prompt: "Inspect" }));',
  );
  expect(JSON.stringify(failed)).toContain("Fixture preflight rejected");
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.launched).toEqual([]);
  expect(f.reads()).toBe(0);
});

test("a substitute specialist cannot satisfy an explicit invocation", async () => {
  const f = await fixture();
  await f.start("@review inspect the canary");
  await f.code('text(await tools.subagent({ specialist: "quick", prompt: "Substitute" }));');
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.launched).toEqual([]);
  expect(f.reads()).toBe(0);
});

test("an unrelated report does not release pending mentions", async () => {
  const f = await fixture();
  await f.start("@review and @quick inspect the canary");
  await f.code('text(await tools.subagent({ specialist: "review", prompt: "Inspect" }));');
  f.ready("unrelated");
  await f.code(
    'text(await tools.subagent_result({ request: { mode: "report", workerId: "worker-unrelated" } }));',
  );
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(0);
});

test("a new request does not inherit an unfinished mention restriction", async () => {
  const f = await fixture();
  await f.start("@review inspect the canary");
  await f.start("Inspect the canary in the parent");
  await f.code('text(await tools.read({ path: "canary" }));');
  expect(f.reads()).toBe(1);
});

test("direct tool calls are guarded while clarification and checklist remain available", async () => {
  const f = await fixture();
  await f.start("@review inspect the canary");
  const call = (toolName: string, input: Record<string, unknown>) =>
    f.session.extensionRunner.emitToolCall({
      type: "tool_call",
      toolCallId: toolName,
      toolName,
      input,
    });
  expect((await call("read", { path: "canary" }))?.block).toBe(true);
  expect(await call("ask_user_question", {})).toBeUndefined();
  expect(await call("tasks", {})).toBeUndefined();
  expect((await call("read", { path: "canary" }))?.block).toBe(true);
});

test.each(["launched", "completed", "question"] as const)(
  "malformed %s outcomes do not release investigation",
  async (kind) => {
    const f = await fixture({ malformedLaunch: kind });
    await f.start("@review inspect the canary");
    await f.code('text(await tools.subagent({ specialist: "review", prompt: "Inspect" }));');
    await f.code('text(await tools.read({ path: "canary" }));');
    expect(f.reads()).toBe(0);
  },
);

test.each(["completed", "question"] as const)(
  "valid foreground %s receipts allow parent inspection",
  async (kind) => {
    const f = await fixture({ foregroundKind: kind });
    await f.start("@review inspect the canary");
    const outcome = await f.code(`
    text(await tools.subagent({ specialist: "review", prompt: "Inspect", foreground: true }));
    text(await tools.read({ path: "canary" }));
  `);
    expect(f.launched).toEqual(["review"]);
    expect(f.reads(), JSON.stringify(outcome)).toBe(1);
  },
);
