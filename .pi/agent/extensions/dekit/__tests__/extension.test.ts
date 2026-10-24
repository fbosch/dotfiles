import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
import * as Value from "typebox/value";
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
const path = `package/${"a".repeat(24)}`;
async function harness(options?: {
  modelRegistry?: ExtensionContext["modelRegistry"];
  includePackage?: boolean;
}) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "pi-dekit-test-")));
  directories.push(cwd);
  const packagePath = join(cwd, "package.json");
  if (options?.includePackage !== false) {
    await writeFile(
      packagePath,
      JSON.stringify({
        packageManager: "bun@1.4.0",
        scripts: { test: "printf hello", serve: "sleep 60" },
      }),
    );
  }
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
    devenv: [{ name: "test:unit", description: "Run unit tests" }],
    devenvCode: 0,
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
  const activeTools = ["read", "bash"];
  const sessionHandlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  const pi = {
    on(event: string, handler: (event: unknown, context: ExtensionContext) => unknown) {
      sessionHandlers.set(event, handler);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools.splice(0, activeTools.length, ...names);
    },
    registerTool(value: ToolDefinition) {
      tool = value;
    },
    async exec(command: string, args: string[], options?: ExecOptions) {
      calls.push({ command, args, ...(options === undefined ? {} : { options }) });
      let data: object = { matched: 1 };
      if (command === "just") data = state.just;
      if (command === "devenv") data = state.devenv;
      if (args.includes("runner"))
        data = state.running
          ? { status: "running", root: cwd, kind: "project" }
          : { status: "absent" };
      if (args.includes("ls")) data = { tasks: state.tasks };
      if (args.includes("screen")) data = { screen: state.screen };
      return {
        stdout: state.response ?? JSON.stringify(data),
        stderr: "CLI failure",
        code: command === "devenv" ? state.devenvCode : state.code,
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

    activeTools,
    startSession: async () => {
      const handler = sessionHandlers.get("session_start");
      await handler?.({ type: "session_start", reason: "startup" }, context);
    },
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

for (const filename of ["justfile", "Justfile", ".justfile", "package.json", "devenv.nix"]) {
  test(`keeps dekit searchable but undeclared when ${filename} exists at the project root`, async () => {
    const h = await harness({ includePackage: false });
    const contents =
      filename === "package.json" ? JSON.stringify({ scripts: { test: "true" } }) : "";
    await writeFile(join(h.cwd, filename), contents);
    await h.startSession();
    expect(h.activeTools).toEqual(["read", "bash"]);
    expect(h.tool).toMatchObject({ name: "dekit", exposure: "deferred", defaultActive: false });
  });
}

test("keeps dekit deferred when the project has no supported catalog file", async () => {
  const h = await harness({ includePackage: false });
  await h.startSession();
  expect(h.activeTools).toEqual(["read", "bash"]);
});
test("registers one script tool; the manual Just extension registers no agent tools", async () => {
  const h = await harness();
  expect(h.tool.name).toBe("dekit");
  expect(h.tool.exposure).toBe("deferred");
  expect(h.tool.defaultActive).toBe(false);
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

test("inspects ordered Just parameter metadata without bodies, expressions, inference, or a runner", async () => {
  let classifyCalls = 0;
  const registry = await classifierRegistry(async (model, input) => {
    classifyCalls += 1;
    return classifierReply(model, input, "no_match");
  });
  const h = await harness({ modelRegistry: registry });
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo BODY_SENTINEL\n");
  h.state.just.recipes.build = {
    ...h.state.just.recipes.build,
    attributes: [{ group: "validation" }],
    body: ["BODY_SENTINEL"],
    parameters: [
      { name: "target", kind: "singular", default: null },
      { name: "mode", kind: "singular", default: ["string", "DEFAULT_EXPRESSION_SENTINEL"] },
      { name: "files", kind: "star", default: null },
      { name: "items", kind: "plus", default: null },
      {
        name: "verbose",
        kind: "singular",
        default: null,
        flag: true,
        long: "verbose",
        short: "v",
        multiple: true,
        help: "Show details\nPRIVATE_HELP_SENTINEL",
      },
    ],
  };
  h.state.hasUI = false;
  await withClassifierSettings({}, async () => {
    const args = { action: "inspect", script: "just:build" };
    expect(Value.Check(h.tool.parameters, args)).toBe(true);
    const result = await h.invoke(args);
    expect(result.details).toEqual({
      action: "inspect",
      project: h.cwd,
      script: {
        id: "just:build",
        source: "just",
        description: "Build the project",
        tags: ["validation"],
        parameters: [
          {
            name: "target",
            kind: "singular",
            required: true,
            hasDefault: false,
            flag: false,
            multiple: false,
          },
          {
            name: "mode",
            kind: "singular",
            required: false,
            hasDefault: true,
            flag: false,
            multiple: false,
          },
          {
            name: "files",
            kind: "star",
            required: false,
            hasDefault: false,
            flag: false,
            multiple: false,
          },
          {
            name: "items",
            kind: "plus",
            required: true,
            hasDefault: false,
            flag: false,
            multiple: false,
          },
          {
            name: "verbose",
            kind: "singular",
            required: false,
            hasDefault: false,
            flag: true,
            long: "verbose",
            short: "v",
            multiple: true,
            help: "Show details",
          },
        ],
      },
    });
    expect(JSON.stringify(result.structuredContent)).toBe(JSON.stringify(result.details));
    if (h.tool.outputSchema === undefined) throw new Error("Output schema missing");
    expect(Value.Check(h.tool.outputSchema, result.structuredContent)).toBe(true);
    for (const privateValue of [
      "BODY_SENTINEL",
      "DEFAULT_EXPRESSION_SENTINEL",
      "PRIVATE_HELP_SENTINEL",
      "fingerprint",
      '"command"',
    ]) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
  });
  expect(classifyCalls).toBe(0);
  expect(h.calls.map((call) => call.command)).toEqual(["just"]);
  expect(h.state.confirmations).toEqual([]);
});

test("inspection distinguishes an empty Just signature from unknown package parameters", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
  expect((await h.invoke({ action: "inspect", script: "just:build" })).details).toMatchObject({
    script: { id: "just:build", parameters: [] },
  });
  const result = await h.invoke({ action: "inspect", script: "package:test" });
  expect(result.details).toEqual({
    action: "inspect",
    project: h.cwd,
    script: {
      id: "package:test",
      source: "package",
      description: "Package script: test",
      tags: [],
      parameters: null,
    },
  });
  expect(JSON.stringify(result)).not.toContain("printf hello");
  for (const script of ["just:hidden", "just:missing", "package:missing", "build"]) {
    await expect(h.invoke({ action: "inspect", script })).rejects.toThrow("no longer public");
  }
  expect(h.calls.every((call) => call.command === "just")).toBe(true);
  expect(h.state.confirmations).toEqual([]);
});
test.each(["just:build", "package:test"])(
  "exact canonical ID %s bypasses enabled classification",
  async (id) => {
    let classifyCalls = 0;
    const registry = await classifierRegistry(async (model, input) => {
      classifyCalls += 1;
      return classifierReply(model, input, "no_match", usage);
    });
    const h = await harness({ modelRegistry: registry });
    await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
    await withClassifierSettings({}, async () => {
      const result = await h.invoke({ action: "discover", query: `  ${id}  `, limit: 1 });
      expect(result.details).toMatchObject({
        scripts: [{ id }],
        totalScripts: 3,
        considered: 3,
        hasMore: false,
        rankingSource: "lexical",
      });
      if (!isMatching({ scripts: P.array({ id: P.string }) }, result.details))
        throw new Error("Script metadata missing");
      expect(result.details.scripts).toHaveLength(1);
      expect(result.usage).toBeUndefined();
      expect(classifyCalls).toBe(0);
      await h.invoke({ action: "discover", query: "build workflow" });
      expect(classifyCalls).toBe(1);
    });
    expect(h.calls.every((call) => call.command === "just")).toBe(true);
    expect(h.state.confirmations).toEqual([]);
  },
);

test("exact package IDs preserve significant script-name whitespace", async () => {
  let classifyCalls = 0;
  const registry = await classifierRegistry(async (model, input) => {
    classifyCalls += 1;
    return classifierReply(model, input, "no_match");
  });
  const h = await harness({ modelRegistry: registry });
  await writeFile(
    h.packagePath,
    JSON.stringify({
      packageManager: "bun@1.4.0",
      scripts: { test: "echo plain", "test ": "echo spaced" },
    }),
  );
  await withClassifierSettings({}, async () => {
    const result = await h.invoke({ action: "discover", query: "package:test " });
    expect(result.details).toMatchObject({
      scripts: [{ id: "package:test " }],
      hasMore: false,
      rankingSource: "lexical",
    });
    expect(classifyCalls).toBe(0);
  });
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
      fallbackReason: "disabled",
    });
  });
  await withClassifierSettings({ classifierEnabled: false }, async () => {
    expect((await h.invoke({ action: "discover", query: "test" })).details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
      fallbackReason: "disabled",
    });
  });
  expect(classifyCalls).toBe(0);

  await withClassifierSettings({}, async () => {
    const unavailable = await h.invoke({ action: "discover", query: "test" });
    expect(unavailable.details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
      fallbackReason: "auth-failure",
    });
    expect(unavailable.usage).toBeUndefined();
    const malformed = await h.invoke({ action: "discover", query: "test" });
    expect(malformed.details).toMatchObject({
      scripts: [{ id: "package:test" }],
      rankingSource: "lexical",
      considered: 2,
      fallbackReason: "invalid-response",
    });
    expect(malformed.usage).toEqual(usage);
    expect(JSON.stringify(unavailable)).not.toContain("classifier unavailable");
    expect(malformed.content).toContainEqual({
      type: "text",
      text: expect.stringContaining("fallback: invalid-response"),
    });
    if (h.tool.outputSchema === undefined) throw new Error("Output schema missing");
    expect(Value.Check(h.tool.outputSchema, malformed.structuredContent)).toBe(true);
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
    { action: "inspect", script: "package:test" },
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

test("starts a catalogued script without confirmation and reports acknowledgement, not completion", async () => {
  const h = await harness();
  h.state.hasUI = false;
  h.state.confirmed = false;
  const result = await h.invoke({
    action: "start",
    script: "package:test",
    arguments: ["a b", "$(touch /tmp/no)"],
  });
  const task = resultTask(result.details);
  expect(isManagedTask(task)).toBe(true);
  expect(result.details).toEqual({ action: "start", project: h.cwd, task, accepted: true });
  expect(h.state.confirmations).toEqual([]);
  expect(h.calls.at(-1)?.args).toEqual([
    "-C",
    h.cwd,
    "--json",
    "register",
    task,
    "--cwd",
    h.cwd,
    "--label",
    "package:test",
    "--start",
    "--",
    "bun",
    "run",
    "test",
    "a b",
    "$(touch /tmp/no)",
  ]);
  expect(h.calls.at(-1)?.options?.timeout).toBe(10_000);
});

test("requires project trust but not interactive confirmation to start scripts", async () => {
  const h = await harness();
  h.state.hasUI = false;
  h.state.confirmed = false;
  await h.invoke({ action: "start", script: "package:test" });
  expect(h.state.confirmations).toEqual([]);

  h.state.trusted = false;
  await expect(h.invoke({ action: "start", script: "package:serve" })).rejects.toThrow(
    "trusted project",
  );
  h.state.trusted = true;

  const callsBeforeAbort = h.calls.length;
  const controller = new AbortController();
  controller.abort();
  await expect(
    h.invoke({ action: "start", script: "package:serve" }, controller.signal),
  ).rejects.toThrow();
  expect(h.calls).toHaveLength(callsBeforeAbort);
});

test("rejects missing scripts before native registration", async () => {
  const h = await harness();
  await expect(h.invoke({ action: "start", script: "package:missing" })).rejects.toThrow(
    "does not exist",
  );
});

test("starts an existing script through atomic native definition verification", async () => {
  const h = await harness();
  const script = (await discoverScripts(h.pi, h.cwd)).scripts[0];
  if (script === undefined) throw new Error("missing fixture");
  const existingPath = taskPath(script, scriptCommand(script, []));
  h.state.running = true;
  h.state.tasks[0] = { id: 2, path: existingPath, state: "idle", exit_code: 0 };
  const result = await h.invoke({ action: "start", script: "package:test" });
  expect(result.details).toEqual({
    action: "start",
    project: h.cwd,
    task: existingPath,
    accepted: true,
  });
  expect(h.calls.at(-1)?.args).toEqual([
    "-C",
    h.cwd,
    "--json",
    "register",
    existingPath,
    "--cwd",
    h.cwd,
    "--label",
    "package:test",
    "--start",
    "--",
    "bun",
    "run",
    "test",
  ]);
});

test("rejects target globs, tags, traversal, spaces, and foreign runners", async () => {
  const h = await harness();
  for (const task of ["**", "package/*", "+tag", `host::${path}`, "@dekit/console", `../${path}`]) {
    for (const action of ["status", "output", "stop", "restart"])
      await expect(h.invoke({ action, task })).rejects.toThrow("exact managed task path");
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

test("stop confirms while restart runs without an interactive prompt", async () => {
  const h = await harness();
  h.state.running = true;
  expect((await h.invoke({ action: "stop", task: path })).details).toMatchObject({
    action: "stop",
    task: path,
    accepted: true,
  });
  expect(h.calls.at(-1)?.args).toEqual(["-C", h.cwd, "--json", "stop", path]);
  expect(h.state.confirmations).toHaveLength(1);

  h.state.hasUI = false;
  h.state.confirmed = false;
  expect((await h.invoke({ action: "restart", task: path })).details).toMatchObject({
    action: "restart",
    task: path,
    accepted: true,
  });
  expect(h.calls.at(-1)?.args).toEqual(["-C", h.cwd, "--json", "restart", path]);
  expect(h.state.confirmations).toHaveLength(1);
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
  const script = (await discoverScripts(h.pi, h.cwd)).scripts[0];
  if (script === undefined) throw new Error("missing fixture");
  expect(scriptCommand(script, ["--watch"])).toEqual(["npm", "run", "test", "--", "--watch"]);
  await writeFile(h.packagePath, JSON.stringify({ scripts: { test: "echo hi" } }));
  await writeFile(join(h.cwd, "bun.lock"), "");
  await writeFile(join(h.cwd, "pnpm-lock.yaml"), "");
  await expect(discoverScripts(h.pi, h.cwd)).rejects.toThrow("Conflicting");
});

test("shares each whole-catalog fingerprint across its source and preserves hash values", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
  h.state.just.recipes.lint = { ...h.state.just.recipes.build, name: "lint", namepath: "lint" };
  const { scripts } = await discoverScripts(h.pi, h.cwd);
  const justFingerprint = createHash("sha256").update(JSON.stringify(h.state.just)).digest("hex");
  const packageFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        packageManager: "bun@1.4.0",
        scripts: { test: "printf hello", serve: "sleep 60" },
      }),
    )
    .digest("hex");
  expect(scripts.map((script) => [script.id, script.fingerprint])).toEqual([
    ["just:build", justFingerprint],
    ["just:lint", justFingerprint],
    ["package:test", packageFingerprint],
    ["package:serve", packageFingerprint],
  ]);
  expect((await discoverScripts(h.pi, h.cwd)).scripts).toEqual(scripts);
});

test("discovers, inspects and starts a devenv task through the shared toolkit schema", async () => {
  const h = await harness({ includePackage: false });
  await writeFile(join(h.cwd, "devenv.nix"), "# fixture");
  const discovered = await h.invoke({ action: "discover", query: "devenv:test:unit" });
  expect(discovered.details).toMatchObject({
    scripts: [{ id: "devenv:test:unit", description: "Run unit tests", parameters: [], tags: [] }],
    rankingSource: "lexical",
  });
  const inspected = await h.invoke({ action: "inspect", script: "devenv:test:unit" });
  expect(inspected.details).toEqual({
    action: "inspect",
    project: h.cwd,
    script: {
      id: "devenv:test:unit",
      source: "devenv",
      description: "Run unit tests",
      parameters: null,
      tags: [],
    },
  });
  if (h.tool.outputSchema === undefined) throw new Error("Output schema missing");
  expect(Value.Check(h.tool.outputSchema, inspected.structuredContent)).toBe(true);
  const started = await h.invoke({ action: "start", script: "devenv:test:unit" });
  expect(resultTask(started.details)).toMatch(/^devenv\/[a-f0-9]{24}$/u);
  const registration = h.calls.find(
    (call) => call.command === "dekit" && call.args.includes("register"),
  );
  if (registration === undefined) throw new Error("Missing native registration");
  expect(registration.args.slice(registration.args.indexOf("--") + 1)).toEqual([
    "devenv",
    "tasks",
    "run",
    "--no-tui",
    "--mode",
    "before",
    "--",
    "test:unit",
  ]);
  expect(registration.args).toContain("--start");
});

test("surfaces devenv discovery warnings without breaking package discovery", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "devenv.nix"), "# fixture");
  h.state.devenvCode = 1;
  const result = await h.invoke({ action: "discover", limit: 10 });
  if (h.tool.outputSchema === undefined) throw new Error("Output schema missing");
  expect([...Value.Errors(h.tool.outputSchema, result.structuredContent)]).toEqual([]);
  expect(result.details).toMatchObject({
    scripts: [{ id: "package:test" }, { id: "package:serve" }],
  });
  if (!isMatching({ warnings: P.array(P.string) }, result.details))
    throw new Error("Expected structured discovery warnings");
  expect(result.details.warnings[0]).toContain("Could not inspect devenv tasks");
  expect(result.content).toEqual([
    expect.objectContaining({ text: expect.stringContaining("Could not inspect devenv tasks") }),
  ]);
  await expect(h.invoke({ action: "start", script: "devenv:test:unit" })).rejects.toThrow(
    "Could not inspect devenv tasks",
  );
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
    await writeFile(
      join(h.cwd, "justfile"),
      [
        "set unstable",
        "set lists",
        "",
        "# Print a marker",
        "probe:",
        "  printf just-marker",
        "",
        "[arg('verbose', long='verbose', short='v', flag)]",
        "metadata target verbose mode='dev' *files:",
        "  @echo ignored",
        "",
      ].join("\n"),
    );
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
      const inspection = await h.invoke({ action: "inspect", script: "just:metadata" });
      expect(inspection.details).toMatchObject({
        script: {
          id: "just:metadata",
          parameters: [
            { name: "target", kind: "singular", required: true, hasDefault: false },
            {
              name: "verbose",
              flag: true,
              long: "verbose",
              short: "v",
              required: false,
              hasDefault: false,
            },
            { name: "mode", kind: "singular", required: false, hasDefault: true },
            { name: "files", kind: "star", required: false, hasDefault: false },
          ],
        },
      });
      expect(
        (await h.invoke({ action: "discover", query: "just:metadata" })).details,
      ).toMatchObject({
        scripts: [{ id: "just:metadata" }],
        hasMore: false,
        rankingSource: "lexical",
      });
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
