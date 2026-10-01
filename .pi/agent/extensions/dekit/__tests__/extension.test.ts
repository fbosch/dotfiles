import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionContext,
  ModelRegistry,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { createNativeClassifierRegistry } from "../../../lib/__tests__/native-classifier-registry";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import justExtension from "../../just";
import { discoverScripts, isManagedTask, scriptCommand, taskPath } from "../catalog";
import dekitExtension from "../index";

const directories: string[] = [];
const usage: Usage = {
  input: 7,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 9,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const path = `pi/package/${"a".repeat(24)}`;
async function harness(options?: { modelRegistry?: ExtensionContext["modelRegistry"] }) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-dekit-test-")));
  directories.push(cwd);
  const packagePath = join(cwd, "package.json");
  await writeFile(
    packagePath,
    JSON.stringify({
      packageManager: "bun@1.4.0",
      scripts: { test: "printf hello", serve: "sleep 60" },
    }),
  );
  const calls: Array<{ command: string; args: string[]; options?: ExecOptions }> = [];
  let tool: ToolDefinition | undefined;
  const state = {
    running: false,
    trusted: true,
    hasUI: true,
    confirmed: true,
    tasks: [{ id: 2, path, state: "exited", exit_code: 7 }],
    confirmations: [] as string[],
    onConfirm: async () => {},
    response: undefined as string | undefined,
    code: 0,
    screen: "hello\r\n",
    just: {
      aliases: {} as Record<string, unknown>,
      recipes: {
        build: {
          name: "build",
          namepath: "build",
          doc: "Build the project",
          parameters: [],
          private: false,
        },
        hidden: { name: "hidden", private: true },
      } as Record<string, Record<string, unknown>>,
    },
  };
  const pi = {
    registerTool(value: ToolDefinition) {
      tool = value;
    },
    async exec(command: string, args: string[], options?: ExecOptions) {
      calls.push({ command, args, ...(options === undefined ? {} : { options }) });
      let data: object = { matched: 1 };
      if (command === "just") data = state.just;
      if (args.includes("runner"))
        data = state.running
          ? { status: "running", root: cwd, kind: "project" }
          : { status: "absent" };
      if (args.includes("ls")) data = { tasks: state.tasks };
      if (args.includes("screen")) data = { screen: state.screen };
      return {
        stdout: state.response ?? JSON.stringify(data),
        stderr: "CLI failure",
        code: state.code,
        killed: false,
      };
    },
  } as unknown as ExtensionAPI;
  dekitExtension(pi);
  if (tool === undefined) throw new Error("dekit tool was not registered");
  const registered = tool;
  const context = withToolExecution({
    cwd,
    get hasUI() {
      return state.hasUI;
    },
    mode: "rpc",
    isProjectTrusted: () => state.trusted,
    ...(options?.modelRegistry === undefined ? {} : { modelRegistry: options.modelRegistry }),
    ui: {
      async confirm(_title: string, message: string) {
        state.confirmations.push(message);
        await state.onConfirm();
        return state.confirmed;
      },
    },
  } as unknown as ExtensionContext);
  return {
    cwd,
    packagePath,
    calls,
    state,
    pi,
    tool: registered,
    context,
    invoke: (args: object, signal?: AbortSignal) =>
      registered.execute("call", args, signal, undefined, context),
  };
}

type ClassifierModel = Parameters<ModelRegistry["classify"]>[0];
type ClassifierResult = Awaited<ReturnType<ModelRegistry["classify"]>>;

async function classifierRegistry(
  classify: (model: ClassifierModel, input: ClassifierContext) => Promise<ClassifierResult>,
): Promise<ModelRegistry> {
  const registry = await createNativeClassifierRegistry();
  registry.classify = (model, input) => classify(model, input);
  return registry;
}

function classifierReply(
  model: ClassifierModel,
  input: ClassifierContext,
  choice: string,
  billedUsage?: Usage,
): ClassifierResult {
  const question = input.questions.best_tool;
  if (question?.type !== "choice") throw new Error("choice criteria missing");
  return {
    api: model.api,
    provider: model.provider,
    model: model.id,
    timestamp: 0,
    stopReason: "stop",
    ...(billedUsage === undefined ? {} : { usage: billedUsage }),
    answers: {
      best_tool: {
        type: "choice",
        choice,
        confidence: 1,
        probabilities: Object.fromEntries(
          Object.keys(question.criteria).map((id) => [id, id === choice ? 1 : 0]),
        ),
      },
    },
  };
}

async function withClassifierSettings<T>(
  options: { classifierEnabled?: boolean; toolDiscoveryEnabled?: boolean },
  run: () => Promise<T>,
): Promise<T> {
  const agentDirectory = await mkdtemp(join(tmpdir(), "pi-dekit-settings-"));
  const previousDirectory = process.env.PI_CODING_AGENT_DIR;
  try {
    await writeFile(
      join(agentDirectory, "settings.json"),
      JSON.stringify({
        classifier: {
          providers: [{ provider: "openrouter", model: "typesafe/jev-1.13" }],
          ...(options.classifierEnabled === undefined
            ? {}
            : { enabled: options.classifierEnabled }),
          toolDiscovery: { enabled: options.toolDiscoveryEnabled ?? true },
        },
      }),
    );
    process.env.PI_CODING_AGENT_DIR = agentDirectory;
    return await run();
  } finally {
    if (previousDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDirectory;
    await rm(agentDirectory, { recursive: true, force: true });
  }
}

function resultTask(details: unknown): string {
  if (!isMatching({ task: P.string }, details)) throw new Error("Missing task path");
  return details.task;
}

test("registers one script tool; the manual Just extension registers no agent tools", async () => {
  const h = await harness();
  expect(h.tool.name).toBe("dekit");
  const tools: string[] = [];
  const commands: string[] = [];
  justExtension({
    registerTool: (tool: ToolDefinition) => tools.push(tool.name),
    registerCommand: (name: string) => commands.push(name),
    on() {},
  } as unknown as ExtensionAPI);
  expect(tools).toEqual([]);
  expect(commands).toEqual(["just"]);
});

test("provides agent guidance for intent and tag queries, local browsing, and nonexhaustive classification", async () => {
  const h = await harness();
  expect(h.tool.promptGuidelines).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/Query dekit discover by intent.*tags from Just groups/u),
      expect.stringMatching(/Omit query.*blank.*locally without calling the classifier.*limit/u),
      expect.stringMatching(
        /one best script or no match.*bounded pool.*not exhaustive.*alternatives.*hasMore is false/u,
      ),
    ]),
  );
});

test("discovers compact public script descriptions without contacting the runner", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
  const result = await h.invoke({ action: "discover" });
  expect(result.details).toMatchObject({
    scripts: [
      { id: "just:build", description: "Build the project", tags: [] },
      { id: "package:test", description: "Package script: test", tags: [] },
      { id: "package:serve", description: "Package script: serve", tags: [] },
    ],
    totalScripts: 3,
    considered: 3,
    hasMore: false,
    rankingSource: "lexical",
  });
  expect(JSON.stringify(result.structuredContent)).toBe(JSON.stringify(result.details));
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\\n");
  expect(text).toContain("package:test — Package script: test");
  expect(text).not.toContain("printf hello");
  expect(text).not.toContain('"scripts"');
  expect(h.calls.map((call) => call.command)).toEqual(["just"]);
  expect(h.calls[0]?.args).toContain(join(h.cwd, "justfile"));
  expect(h.state.confirmations).toEqual([]);
});
test.each(["persistence", "æøå", "ÆØÅ"])(
  "group-only query %s shortlists tagged scripts and exposes their tags",
  async (query) => {
    let classifyCalls = 0;
    const tags = ["persistence", "agent", "æøå"];
    const registry = await classifierRegistry(async (model, input) => {
      classifyCalls += 1;
      expect(
        isMatching(
          { candidates: P.array({ name: P.string, tags: P.array(P.string) }) },
          input.state,
        ),
      ).toBe(true);
      if (
        !isMatching(
          { candidates: P.array({ name: P.string, tags: P.array(P.string) }) },
          input.state,
        )
      )
        throw new Error("tagged candidate metadata missing");
      expect(input.state.candidates).toHaveLength(24);
      expect(input.state.candidates[0]).toMatchObject({ name: "just:z-step", tags });
      const question = input.questions.best_tool;
      if (question?.type !== "choice") throw new Error("choice criteria missing");
      expect(question.criteria.candidate_0).toContain("[tags: persistence, agent, æøå]");
      return classifierReply(model, input, "candidate_0", usage);
    });
    const h = await harness({ modelRegistry: registry });
    await writeFile(join(h.cwd, "justfile"), "z-step:\n  echo opaque\n");
    h.state.just.recipes["z-step"] = {
      name: "z-step",
      namepath: "z-step",
      doc: "Run an opaque helper",
      attributes: tags.map((group) => ({ group })),
      private: false,
      parameters: [],
    };
    for (let index = 0; index < 30; index += 1) {
      const name = `a-${index}`;
      h.state.just.recipes[name] = {
        name,
        namepath: name,
        doc: "Run an unrelated helper",
        private: false,
        parameters: [],
      };
    }
    await writeFile(h.packagePath, JSON.stringify({ packageManager: "bun@1.4.0", scripts: {} }));
    await withClassifierSettings({}, async () => {
      const result = await h.invoke({ action: "discover", query, limit: 1 });
      expect(result.details).toMatchObject({
        scripts: [{ id: "just:z-step", tags }],
        considered: 24,
        totalScripts: 32,
        hasMore: true,
        rankingSource: "classifier",
      });
      expect(JSON.stringify(result.structuredContent)).toBe(JSON.stringify(result.details));
      expect(result.content).toContainEqual({
        type: "text",
        text: expect.stringContaining('[tags: ["persistence","agent","æøå"]]'),
      });
    });
    await withClassifierSettings({ toolDiscoveryEnabled: false }, async () => {
      const result = await h.invoke({ action: "discover", query, limit: 1 });
      expect(result.details).toMatchObject({
        scripts: [{ id: "just:z-step", tags }],
        rankingSource: "lexical",
      });
    });
    expect(classifyCalls).toBe(1);
    expect(h.calls.every((call) => call.command === "just")).toBe(true);
  },
);

test("ranks local names deterministically and reports undisplayed lexical results", async () => {
  const h = await harness();
  await writeFile(
    h.packagePath,
    JSON.stringify({
      packageManager: "bun@1.4.0",
      scripts: {
        "test:unit": "private unit command",
        lint: "private lint command",
        test: "private test command",
        "test:integration": "private integration command",
      },
    }),
  );
  const args = { action: "discover", query: "test", limit: 1 };
  const first = await h.invoke(args);
  const second = await h.invoke(args);
  expect(first.details).toMatchObject({
    scripts: [{ id: "package:test" }],
    totalScripts: 4,
    considered: 4,
    hasMore: true,
    rankingSource: "lexical",
  });
  expect(second.details).toEqual(first.details);
});

test("uses the classifier to select one safe nonlexical script from its bounded candidate pool", async () => {
  const inputs: ClassifierContext[] = [];
  const registry = await classifierRegistry(async (model, input) => {
    inputs.push(input);
    const question = input.questions.best_tool;
    if (question?.type !== "choice") throw new Error("choice criteria missing");
    const selected = Object.entries(question.criteria).find(([, value]) =>
      value.startsWith("just:database::migrate:"),
    )?.[0];
    if (selected === undefined) throw new Error("semantic candidate missing");
    return classifierReply(model, input, selected, usage);
  });
  const h = await harness({ modelRegistry: registry });
  const scripts = Object.fromEntries(
    Array.from({ length: 30 }, (_, index) => [
      `task-${String(index).padStart(2, "0")}`,
      "PACKAGE_BODY_SENTINEL",
    ]),
  );
  await writeFile(h.packagePath, JSON.stringify({ packageManager: "bun@1.4.0", scripts }));
  await writeFile(join(h.cwd, "justfile"), "database::migrate:\n  echo COMMAND_SENTINEL\n");
  h.state.just.aliases = { schema: { name: "schema", target: "database::migrate" } };
  h.state.just.recipes["database::migrate"] = {
    name: "migrate",
    namepath: "database::migrate",
    doc: "Apply a data structure revision.\nPRIVATE_SECOND_LINE_SENTINEL",
    private: false,
    attributes: [{ group: "persistence" }],
    parameters: [],
    body: ["JUST_BODY_SENTINEL"],
  };

  await withClassifierSettings({}, async () => {
    const result = await h.invoke({ action: "discover", query: "q".repeat(650), limit: 1 });
    expect(result.details).toMatchObject({
      scripts: [{ id: "just:database::migrate", description: "Apply a data structure revision." }],
      totalScripts: 32,
      considered: 24,
      hasMore: true,
      rankingSource: "classifier",
    });
    expect(result.usage).toEqual(usage);
    expect((JSON.stringify(result).match(/"input":7/gu) ?? []).length).toBe(1);
    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    if (input === undefined) throw new Error("classifier input missing");
    expect(input.state.query).toBe("q".repeat(500));
    expect(Array.isArray(input.state.candidates)).toBe(true);
    if (!Array.isArray(input.state.candidates)) throw new Error("candidate list missing");
    expect(input.state.candidates).toHaveLength(24);
    for (const candidate of input.state.candidates) {
      expect(isMatching({ name: P.string, description: P.string }, candidate)).toBe(true);
      if (!isMatching({ name: P.string, description: P.string }, candidate))
        throw new Error("candidate metadata missing");
      expect(candidate.description.length).toBeLessThanOrEqual(180);
    }
    const serializedInput = JSON.stringify(input);
    expect(serializedInput).not.toContain(h.cwd);
    for (const secret of [
      "PACKAGE_BODY_SENTINEL",
      "COMMAND_SENTINEL",
      "JUST_BODY_SENTINEL",
      "PRIVATE_SECOND_LINE_SENTINEL",
      "fingerprint",
      "parameters",
    ]) {
      expect(serializedInput).not.toContain(secret);
    }
    const text = result.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\\n");
    expect(text).toContain("(classifier one-best;");
    expect(text).not.toContain("Jev");
    expect(text).toContain("just:database::migrate —");
    expect(text).not.toContain("PRIVATE_SECOND_LINE_SENTINEL");
    expect(text).not.toContain("PACKAGE_BODY_SENTINEL");
  });
  expect(h.calls.map((call) => call.command)).toEqual(["just"]);
  expect(h.calls.some((call) => call.args.includes("runner"))).toBe(false);
});

test("uses no-match without lexical fallback and reports billed usage once", async () => {
  const registry = await classifierRegistry(async (model, input) =>
    classifierReply(model, input, "no_match", usage),
  );
  const h = await harness({ modelRegistry: registry });
  await withClassifierSettings({}, async () => {
    const result = await h.invoke({ action: "discover", query: "unrelated capability" });
    expect(result.details).toMatchObject({
      scripts: [],
      totalScripts: 2,
      considered: 2,
      hasMore: false,
      rankingSource: "classifier",
    });
    expect(result.usage).toEqual(usage);
    expect((JSON.stringify(result).match(/"input":7/gu) ?? []).length).toBe(1);
  });
  expect(h.calls).toEqual([]);
});

test("skips disabled classifier policy and falls back for unavailable or malformed responses", async () => {
  let classifyCalls = 0;
  const registry = await classifierRegistry(async (model, _input) => {
    classifyCalls += 1;
    if (classifyCalls === 1) throw new Error("classifier unavailable");
    return {
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: 0,
      stopReason: "stop",
      usage,
      answers: {},
    };
  });
  const h = await harness({ modelRegistry: registry });

  await withClassifierSettings({ toolDiscoveryEnabled: false }, async () => {
    expect((await h.invoke({ action: "discover", query: "test" })).details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
    });
  });
  await withClassifierSettings({ classifierEnabled: false }, async () => {
    expect((await h.invoke({ action: "discover", query: "test" })).details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
    });
  });
  expect(classifyCalls).toBe(0);

  await withClassifierSettings({}, async () => {
    const unavailable = await h.invoke({ action: "discover", query: "test" });
    expect(unavailable.details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
    });
    expect(unavailable.usage).toBeUndefined();
    const malformed = await h.invoke({ action: "discover", query: "test" });
    expect(malformed.details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
    });
    expect(malformed.usage).toEqual(usage);
  });
  expect(classifyCalls).toBe(2);
  expect(h.calls).toEqual([]);
});

test("skips the classifier for blank catalog browsing and retains billed usage on cancellation", async () => {
  let classifyCalls = 0;
  const noCallRegistry = await classifierRegistry(async (model, _input) => {
    classifyCalls += 1;
    return classifierReply(model, _input, "candidate_0");
  });
  const browsing = await harness({ modelRegistry: noCallRegistry });
  await withClassifierSettings({}, async () => {
    const result = await browsing.invoke({ action: "discover", query: "  " });
    expect(result.details).toMatchObject({
      scripts: [{ id: "package:test" }, { id: "package:serve" }],
      totalScripts: 2,
      considered: 2,
      rankingSource: "lexical",
    });
  });
  expect(classifyCalls).toBe(0);

  const controller = new AbortController();
  const cancellationRegistry = await classifierRegistry(async (model, input) => {
    const reply = classifierReply(model, input, "candidate_0", usage);
    return {
      ...reply,
      get usage() {
        // Abort after a completed response has returned usage, not inside the provider.
        controller.abort();
        return usage;
      },
    };
  });
  const cancelled = await harness({ modelRegistry: cancellationRegistry });
  await withClassifierSettings({}, async () => {
    const result = await cancelled.invoke({ action: "discover", query: "test" }, controller.signal);
    expect(result.isError).toBe(true);
    expect(result.usage).toEqual(usage);
    expect(result.details).toMatchObject({ scripts: [], rankingSource: "classifier" });
    expect((JSON.stringify(result).match(/"input":7/gu) ?? []).length).toBe(1);
  });
  expect(cancelled.calls).toEqual([]);
});

test("denies all operations in an untrusted project before reading or executing scripts", async () => {
  const h = await harness();
  h.state.trusted = false;
  for (const args of [
    { action: "discover" },
    { action: "start", script: "package:test" },
    { action: "status" },
    { action: "output", task: path },
    { action: "stop", task: path },
    { action: "restart", task: path },
  ]) {
    await expect(h.invoke(args)).rejects.toThrow("trusted project");
  }
  expect(h.calls).toEqual([]);
});

test("read-only status does not start an absent runner", async () => {
  const h = await harness();
  expect((await h.invoke({ action: "status" })).details).toMatchObject({
    runner: "absent",
    tasks: [],
  });
  expect(h.calls.map((call) => call.args.slice(3))).toEqual([["runner", "status"]]);
  await expect(h.invoke({ action: "output", task: path })).rejects.toThrow("not running");
  expect(h.calls.every((call) => !call.args.includes("spawn") && !call.args.includes("up"))).toBe(
    true,
  );
});

test("starts a confirmed script with argv boundaries and reports acknowledgement, not completion", async () => {
  const h = await harness();
  const result = await h.invoke({
    action: "start",
    script: "package:test",
    arguments: ["a b", "$(touch /tmp/no)"],
  });
  const task = resultTask(result.details);
  expect(isManagedTask(task)).toBe(true);
  expect(result.details).toEqual({ action: "start", project: h.cwd, task, accepted: true });
  expect(h.state.confirmations).toHaveLength(1);
  expect(h.calls.at(-1)?.args).toEqual([
    "-C",
    h.cwd,
    "--json",
    "spawn",
    task,
    "--cwd",
    h.cwd,
    "--",
    "bun",
    "run",
    "test",
    "a b",
    "$(touch /tmp/no)",
  ]);
  expect(h.calls.at(-1)?.options?.timeout).toBe(10_000);
});

test("denies declined, headless, and aborted mutations without spawning", async () => {
  const h = await harness();
  h.state.confirmed = false;
  await expect(h.invoke({ action: "start", script: "package:test" })).rejects.toThrow("declined");
  h.context.hasUI = false;
  await expect(h.invoke({ action: "start", script: "package:test" })).rejects.toThrow(
    "interactive confirmation",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    h.invoke({ action: "start", script: "package:test" }, controller.signal),
  ).rejects.toThrow();
  expect(h.calls.some((call) => call.args.includes("spawn"))).toBe(false);
});

test("revalidates package scripts and trust after confirmation", async () => {
  const h = await harness();
  h.state.onConfirm = async () => {
    await writeFile(
      h.packagePath,
      JSON.stringify({ packageManager: "bun@1.4.0", scripts: { test: "different command" } }),
    );
  };
  await expect(h.invoke({ action: "start", script: "package:test" })).rejects.toThrow(
    "Script changed",
  );
  h.state.onConfirm = async () => {
    h.state.trusted = false;
  };
  await expect(h.invoke({ action: "start", script: "package:test" })).rejects.toThrow(
    "trusted project",
  );
  expect(h.calls.some((call) => call.args.includes("spawn"))).toBe(false);
});

test("detects Just body changes even when public recipe metadata is unchanged", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
  h.state.onConfirm = async () => {
    const build = h.state.just.recipes.build;
    if (build === undefined) throw new Error("build fixture missing");
    Object.assign(build, { body: ["different command"] });
  };
  await expect(h.invoke({ action: "start", script: "just:build" })).rejects.toThrow(
    "Script changed",
  );
  expect(h.calls.some((call) => call.args.includes("spawn"))).toBe(false);
});

test("rejects missing scripts and does not overwrite an existing task", async () => {
  const h = await harness();
  await expect(h.invoke({ action: "start", script: "package:missing" })).rejects.toThrow(
    "does not exist",
  );
  const script = (await discoverScripts(h.pi, h.cwd))[0];
  if (script === undefined) throw new Error("missing fixture");
  h.state.running = true;
  h.state.tasks[0] = {
    id: 2,
    path: taskPath(script, scriptCommand(script, [])),
    state: "exited",
    exit_code: 0,
  };
  await expect(h.invoke({ action: "start", script: "package:test" })).rejects.toThrow(
    "already exists",
  );
  expect(h.state.confirmations).toEqual([]);
});

test("rejects target globs, tags, traversal, spaces, and foreign runners", async () => {
  const h = await harness();
  for (const task of [
    "**",
    "pi/package/*",
    "+tag",
    `host::${path}`,
    "@dekit/console",
    `../${path}`,
  ]) {
    for (const action of ["status", "output", "stop", "restart"])
      await expect(h.invoke({ action, task })).rejects.toThrow("exact Pi task path");
  }
  expect(h.calls).toEqual([]);
});

test("status preserves nonzero script exit codes and hides unrelated tasks", async () => {
  const h = await harness();
  h.state.running = true;
  h.state.tasks.push({ id: 3, path: "services/web", state: "ready", exit_code: 0 });
  expect((await h.invoke({ action: "status" })).details).toMatchObject({
    tasks: [{ path, state: "exited", exit_code: 7 }],
  });
});

test("output is a bounded current screen, with exact task selection", async () => {
  const h = await harness();
  h.state.running = true;
  h.state.screen = "x".repeat(30_000);
  const result = await h.invoke({ action: "output", task: path });
  expect(result.details).toMatchObject({ truncated: true });
  expect(JSON.stringify(result.details).length).toBeLessThan(23_000);
  expect(h.calls.at(-1)?.args).toEqual(["-C", h.cwd, "--json", "screen", path]);
});

test("stop and restart confirm and operate on exactly one existing task", async () => {
  const h = await harness();
  h.state.running = true;
  for (const action of ["stop", "restart"]) {
    expect((await h.invoke({ action, task: path })).details).toMatchObject({
      action,
      task: path,
      accepted: true,
    });
    expect(h.calls.at(-1)?.args).toEqual(["-C", h.cwd, "--json", action, path]);
  }
  expect(h.state.confirmations).toHaveLength(2);
});

test("denies task replacement during confirmation and malformed CLI acknowledgements", async () => {
  const h = await harness();
  h.state.running = true;
  h.state.onConfirm = async () => {
    h.state.tasks[0] = { id: 99, path, state: "ready", exit_code: 0 };
  };
  await expect(h.invoke({ action: "stop", task: path })).rejects.toThrow("Task changed");
  expect(h.calls.some((call) => call.args.includes("stop"))).toBe(false);
  h.state.response = "not JSON";
  await expect(h.invoke({ action: "status" })).rejects.toThrow("Invalid dekit");
  h.state.response = '{"status":"unexpected"}';
  await expect(h.invoke({ action: "status" })).rejects.toThrow("Invalid dekit");
  h.state.code = 1;
  await expect(h.invoke({ action: "status" })).rejects.toThrow("CLI failure");
});

test("honors declared managers, npm argument separator, and ambiguous lockfile rejection", async () => {
  const h = await harness();
  await writeFile(
    h.packagePath,
    JSON.stringify({ packageManager: "npm@10", scripts: { test: "echo hi" } }),
  );
  const script = (await discoverScripts(h.pi, h.cwd))[0];
  if (script === undefined) throw new Error("missing fixture");
  expect(scriptCommand(script, ["--watch"])).toEqual(["npm", "run", "test", "--", "--watch"]);
  await writeFile(h.packagePath, JSON.stringify({ scripts: { test: "echo hi" } }));
  await writeFile(join(h.cwd, "bun.lock"), "");
  await writeFile(join(h.cwd, "pnpm-lock.yaml"), "");
  await expect(discoverScripts(h.pi, h.cwd)).rejects.toThrow("Conflicting");
});

const liveTest = process.env.PI_DEKIT_LIVE === "1" ? test : test.skip;
liveTest(
  "installed dekit handles Just and package tasks, failures, output, stop and restart",
  async () => {
    const h = await harness();
    await writeFile(
      h.packagePath,
      JSON.stringify({
        packageManager: "bun@1.4.0",
        scripts: {
          failure: "printf failure-marker; exit 7",
          service: "bun -e 'console.log(\"service-marker\"); setInterval(() => {}, 1000)'",
        },
      }),
    );
    await writeFile(join(h.cwd, "justfile"), "# Print a marker\nprobe:\n  printf just-marker\n");
    h.pi.exec = async (command, args, options) => {
      const child = Bun.spawn([command, ...args], {
        cwd: options?.cwd ?? h.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code, killed: false };
    };
    try {
      expect((await h.invoke({ action: "status" })).details).toMatchObject({ runner: "absent" });
      for (const [script, exit] of [
        ["just:probe", 0],
        ["package:failure", 7],
      ] as const) {
        const started = await h.invoke({ action: "start", script });
        const task = resultTask(started.details);
        let ended = false;
        // The CLI exposes snapshots, not a completion event. Bound this integration-test wait.
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const result = await h.invoke({ action: "status", task });
          if (isMatching({ tasks: [{ state: "exited", exit_code: exit }] }, result.details)) {
            ended = true;
            break;
          }
          await Bun.sleep(25);
        }
        expect(ended).toBe(true);
        expect((await h.invoke({ action: "output", task })).details).toMatchObject({
          screen: expect.stringContaining(
            script === "just:probe" ? "just-marker" : "failure-marker",
          ),
        });
      }
      const started = await h.invoke({ action: "start", script: "package:service" });
      const task = resultTask(started.details);
      expect((await h.invoke({ action: "restart", task })).details).toMatchObject({
        accepted: true,
      });
      expect((await h.invoke({ action: "stop", task })).details).toMatchObject({ accepted: true });
    } finally {
      await h.pi.exec("dekit", ["-C", h.cwd, "--json", "runner", "stop"], { cwd: h.cwd });
    }
  },
  20_000,
);
