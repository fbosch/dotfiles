import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { parseJustCatalog } from "../catalog";
import {
  executeJustRecipe,
  justRecipeCompletions,
  parseJustCommandArguments,
  type RecipeExecutionResult,
  type RecipeExecutor,
  registerJustCommand,
  registerJustTools,
} from "../index";

function parameter(name: string, defaultValue: unknown = null) {
  return {
    name,
    kind: "singular",
    default: defaultValue,
    flag: false,
    help: null,
    long: null,
    short: null,
    multiple: false,
    pattern: null,
    value: null,
    min: null,
    max: null,
  };
}

function dump(parameters: unknown[] = []) {
  return {
    source: "/repo/justfile",
    aliases: {},
    modules: {},
    recipes: {
      shellcheck: {
        name: "shellcheck",
        namepath: "shellcheck",
        doc: "Run shell checks.",
        private: false,
        attributes: [{ group: "validation" }],
        parameters,
      },
      hidden: {
        name: "hidden",
        namepath: "hidden",
        doc: "Do not expose.",
        private: true,
        attributes: [],
        parameters: [],
      },
    },
  };
}

interface Harness {
  pi: ExtensionAPI;
  tools: Map<string, ToolDefinition>;
  activeTools: string[];
  executions: Array<{ command: string; args: string[]; options?: ExecOptions }>;
  recipeExecutions: Array<{ cwd: string; args: string[] }>;
  recipeExecutor: RecipeExecutor;
  setDump(value: unknown): void;
  setRecipeResult(value: RecipeExecutionResult): void;
}

function createHarness(initialDump: unknown): Harness {
  let currentDump = initialDump;
  const tools = new Map<string, ToolDefinition>();
  const activeTools = ["read"];
  const executions: Array<{ command: string; args: string[]; options?: ExecOptions }> = [];
  const recipeExecutions: Array<{ cwd: string; args: string[] }> = [];
  let recipeResult: RecipeExecutionResult = {
    stdout: "checked\n",
    stderr: "",
    code: 0,
    killed: false,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  };
  const pi = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
      if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
    },
    getAllTools() {
      return [...tools.values()];
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools.splice(0, activeTools.length, ...names);
    },
    async exec(command: string, args: string[], options?: ExecOptions) {
      executions.push({ command, args, ...(options === undefined ? {} : { options }) });
      if (args.includes("--json")) {
        return { stdout: JSON.stringify(currentDump), stderr: "", code: 0, killed: false };
      }
      return { stdout: "checked\n", stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  const recipeExecutor: RecipeExecutor = async (cwd, args) => {
    recipeExecutions.push({ cwd, args });
    return recipeResult;
  };

  return {
    pi,
    tools,
    activeTools,
    executions,
    recipeExecutions,
    recipeExecutor,
    setDump(value) {
      currentDump = value;
    },
    setRecipeResult(value) {
      recipeResult = value;
    },
  };
}

function context(
  confirmations: string[],
  confirmed = true,
  onConfirm?: () => void,
  cancelled = false,
): ExtensionContext {
  return {
    cwd: "/repo",
    hasUI: true,
    mode: "rpc",
    isProjectTrusted: () => true,
    ui: {
      async select(title: string, options: string[]) {
        confirmations.push(title);
        expect(options).toEqual(["1. Run recipe", "2. Cancel"]);
        if (cancelled) return undefined;
        onConfirm?.();
        return confirmed ? "1. Run recipe" : "2. Cancel";
      },
      notify() {},
    },
  } as unknown as ExtensionContext;
}

async function loadShellcheck(harness: Harness, ctx: ExtensionContext): Promise<ToolDefinition> {
  const loader = harness.tools.get("just_tools");
  if (loader === undefined) throw new Error("loader tool missing");
  await loader.execute("loader", { query: "shell checks" }, undefined, undefined, ctx);
  const recipeTool = harness.tools.get("just_shellcheck");
  if (recipeTool === undefined) throw new Error("recipe tool missing");
  return recipeTool;
}

interface TestJustCommand {
  getArgumentCompletions?: (prefix: string) => Promise<AutocompleteItem[] | null>;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}
type TestSessionStart = (event: object, ctx: ExtensionContext) => void;
type TestTerminalInput = (data: string) => { consume?: boolean } | undefined;
type TestModal = {
  handleInput?: (data: string) => void;
  render?: (width: number) => string[];
};

test("provides recipe names and descriptions for /just completion", () => {
  const recipes = parseJustCatalog(dump([parameter("target")]));
  expect(justRecipeCompletions(recipes, "shell")).toEqual([
    {
      value: "shellcheck",
      label: "shellcheck",
      description: "Run shell checks. Group: validation. Arguments: target.",
    },
  ]);
  expect(justRecipeCompletions(recipes, "shellcheck ")).toBeNull();
});

test("parses quoted and escaped /just arguments", () => {
  expect(parseJustCommandArguments(`shellcheck "src file" 'other file' plain\\ value`)).toEqual([
    "shellcheck",
    "src file",
    "other file",
    "plain value",
  ]);
  expect(parseJustCommandArguments(String.raw`shellcheck "\d+\\value"`)).toEqual([
    "shellcheck",
    String.raw`\d+\value`,
  ]);
  expect(() => parseJustCommandArguments("shellcheck 'missing")).toThrow("unterminated quote");
});

test("registers /just completion and executes the selected public recipe", async () => {
  let command: TestJustCommand | undefined;
  let sessionStart: TestSessionStart | undefined;
  const executions: Array<{ cwd: string; args: string[] }> = [];
  const notifications: string[] = [];
  const pi = {
    on(event: string, handler: TestSessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
    registerCommand(_name: string, definition: TestJustCommand) {
      command = definition;
    },
    async exec() {
      return { stdout: JSON.stringify(dump()), stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  const recipeExecutor: RecipeExecutor = async (cwd, args) => {
    executions.push({ cwd, args });
    return {
      stdout: "checked\n",
      stderr: "",
      code: 0,
      killed: false,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  };
  registerJustCommand(pi, recipeExecutor);
  if (sessionStart === undefined) throw new Error("session_start handler was not registered");
  sessionStart({}, context([]));
  if (command === undefined) throw new Error("/just command was not registered");
  if (command.getArgumentCompletions === undefined) {
    throw new Error("/just completion was not registered");
  }

  await expect(command.getArgumentCompletions("shell")).resolves.toEqual([
    {
      value: "shellcheck",
      label: "shellcheck",
      description: "Run shell checks. Group: validation.",
    },
  ]);
  const commandContext = {
    ...context([]),
    ui: {
      ...context([]).ui,
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionCommandContext;
  await command.handler("shellcheck 'src file'", commandContext);
  expect(executions).toEqual([
    { cwd: "/repo", args: ["--yes", "--one", "--", "shellcheck", "src file"] },
  ]);
  expect(notifications[0]).toContain("Just recipe `shellcheck` completed");
});

test("cancels a running /just recipe from terminal input", async () => {
  let command: TestJustCommand | undefined;
  let sessionStart: TestSessionStart | undefined;
  let terminalInput: TestTerminalInput | undefined;
  let closeModal: (() => void) | undefined;
  let modalComponent: TestModal | undefined;
  let executionStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    executionStarted = resolve;
  });
  const notifications: string[] = [];
  const pi = {
    on(event: string, handler: TestSessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
    registerCommand(_name: string, definition: TestJustCommand) {
      command = definition;
    },
    async exec() {
      return { stdout: JSON.stringify(dump()), stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;
  const recipeExecutor: RecipeExecutor = async (_cwd, _args, signal, onOutput) => {
    executionStarted();
    onOutput?.({
      text: "stdout:\nlive output\nstderr:\nwarning",
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    if (signal === undefined) throw new Error("command signal missing");
    const finalOutput = Array.from({ length: 40 }, (_, index) => `output-${index}`).join("\n");
    return new Promise<RecipeExecutionResult>((resolve) => {
      signal.addEventListener("abort", () =>
        resolve({
          stdout: finalOutput,
          stderr: "",
          code: 143,
          killed: true,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      );
    });
  };

  registerJustCommand(pi, recipeExecutor);
  if (sessionStart === undefined || command === undefined) {
    throw new Error("/just command was not registered");
  }
  sessionStart({}, context([]));
  const baseContext = context([]);
  const commandContext = {
    ...baseContext,
    mode: "tui",
    ui: {
      ...baseContext.ui,
      onTerminalInput(handler: TestTerminalInput) {
        terminalInput = handler;
        return () => {
          terminalInput = undefined;
        };
      },
      custom(
        factory: (
          tui: { requestRender: () => void },
          theme: {
            fg: (_role: string, text: string) => string;
            bold: (text: string) => string;
            bg: (_role: string, text: string) => string;
          },
          keybindings: object,
          done: () => void,
        ) => TestModal,
      ) {
        return new Promise<void>((resolve) => {
          const modal = factory(
            { requestRender() {} },
            {
              fg: (_role: string, text: string) => text,
              bold: (text: string) => text,
              bg: (role: string, text: string) => `[${role}]${text}`,
            },
            {},
            () => resolve(),
          );
          modalComponent = modal;
          closeModal = () => modal.handleInput?.("\u001b");
        });
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionCommandContext;

  const execution = command.handler("shellcheck", commandContext);
  await started;
  if (terminalInput === undefined) throw new Error("terminal input handler was not registered");
  if (modalComponent?.render === undefined) throw new Error("output modal was not rendered");
  const renderedModal = modalComponent.render(80).join("\n");
  expect(renderedModal).toContain("live output");
  expect(renderedModal).toContain("[toolPendingBg]");
  expect(terminalInput("\u001b")).toEqual({ consume: true });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const completedModal = modalComponent.render(80).join("\n");
  expect(completedModal).toContain("output-39");
  expect(completedModal.split("\n").length).toBe(renderedModal.split("\n").length);
  modalComponent.handleInput?.("\u001b[H");
  expect(modalComponent.render(80).join("\n")).toContain("output-0");
  modalComponent.handleInput?.("\u001b[F");
  expect(modalComponent.render(80).join("\n")).toContain("output-39");
  if (closeModal === undefined) throw new Error("output modal was not opened");
  closeModal();
  await execution;
  expect(notifications).toEqual([]);
});

test("retries recipe completion discovery after a failed Justfile read", async () => {
  let command: TestJustCommand | undefined;
  let sessionStart: TestSessionStart | undefined;
  let discoveryAttempts = 0;
  const pi = {
    on(event: string, handler: TestSessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
    registerCommand(_name: string, definition: TestJustCommand) {
      command = definition;
    },
    async exec() {
      discoveryAttempts += 1;
      if (discoveryAttempts === 1) {
        return { stdout: "not json", stderr: "invalid Justfile", code: 1, killed: false };
      }
      return { stdout: JSON.stringify(dump()), stderr: "", code: 0, killed: false };
    },
  } as unknown as ExtensionAPI;

  registerJustCommand(pi);
  if (sessionStart === undefined || command?.getArgumentCompletions === undefined) {
    throw new Error("/just lifecycle was not registered");
  }
  sessionStart({}, context([]));
  await expect(command.getArgumentCompletions("shell")).resolves.toBeNull();
  const completions = await command.getArgumentCompletions("shell");
  expect(completions?.map(({ value }) => value)).toEqual(["shellcheck"]);
  expect(discoveryAttempts).toBe(2);
});

describe("Just tools extension", () => {
  test("discovers, activates, confirms, and executes a public recipe", async () => {
    const harness = createHarness(dump([parameter("target", "all")]));
    const confirmations: string[] = [];
    const ctx = context(confirmations);
    registerJustTools(harness.pi, harness.recipeExecutor);

    const recipeTool = await loadShellcheck(harness, ctx);
    const result = await recipeTool.execute(
      "recipe",
      { target: "scripts" },
      undefined,
      undefined,
      ctx,
    );

    expect(harness.activeTools).toContain("just_shellcheck");
    expect(harness.tools.has("just_hidden")).toBe(false);
    expect(confirmations[0]).toContain("Recipe: shellcheck");
    expect(confirmations[0]).toContain('["scripts"]');
    expect(harness.recipeExecutions.at(-1)).toEqual({
      cwd: "/repo",
      args: ["--yes", "--one", "--", "shellcheck", "scripts"],
    });
    expect(result.content[0]).toMatchObject({ type: "text", text: "stdout:\nchecked\n" });
  });

  test("includes recipe groups in discovery results", async () => {
    const harness = createHarness(dump());
    const ctx = context([]);
    registerJustTools(harness.pi);

    const loader = harness.tools.get("just_tools");
    if (loader === undefined) throw new Error("loader tool missing");
    const result = await loader.execute(
      "loader",
      { query: "shell checks" },
      undefined,
      undefined,
      ctx,
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "- just_shellcheck [group: validation]: Run shell checks.",
    });
  });

  test("requires reload when a registered recipe changes parameters", async () => {
    const harness = createHarness(dump());
    const ctx = context([]);
    registerJustTools(harness.pi, harness.recipeExecutor);
    const recipeTool = await loadShellcheck(harness, ctx);
    harness.setDump(dump([parameter("target")]));

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, ctx)).rejects.toThrow(
      "changed parameters; run `/reload`",
    );
  });

  test("fails closed when confirmation is unavailable or declined", async () => {
    const harness = createHarness(dump());
    registerJustTools(harness.pi, harness.recipeExecutor);
    const recipeTool = await loadShellcheck(harness, context([]));
    const noUi = { ...context([]), hasUI: false } as ExtensionContext;

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, noUi)).rejects.toThrow(
      "requires interactive confirmation",
    );
    await expect(
      recipeTool.execute("recipe", {}, undefined, undefined, context([], false)),
    ).rejects.toThrow("was declined");
    expect(harness.recipeExecutions).toEqual([]);
  });

  test("reports cancelled confirmation separately", async () => {
    const harness = createHarness(dump());
    registerJustTools(harness.pi, harness.recipeExecutor);
    const recipeTool = await loadShellcheck(harness, context([], true, undefined, true));

    await expect(
      recipeTool.execute("recipe", {}, undefined, undefined, context([], true, undefined, true)),
    ).rejects.toThrow("was cancelled");
    expect(harness.recipeExecutions).toEqual([]);
  });

  test("revalidates the recipe after confirmation", async () => {
    const harness = createHarness(dump());
    const ctx = context([], true, () => harness.setDump(dump([parameter("target")])));
    registerJustTools(harness.pi, harness.recipeExecutor);
    const recipeTool = await loadShellcheck(harness, ctx);

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, ctx)).rejects.toThrow(
      "changed during confirmation; run `/reload`",
    );
    expect(harness.recipeExecutions).toEqual([]);
  });

  test("reports timeouts distinctly", async () => {
    const harness = createHarness(dump());
    harness.setRecipeResult({
      stdout: "",
      stderr: "",
      code: 1,
      killed: true,
      timedOut: true,
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const ctx = context([]);
    registerJustTools(harness.pi, harness.recipeExecutor);
    const recipeTool = await loadShellcheck(harness, ctx);

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, ctx)).rejects.toThrow(
      "timed out after 600 seconds",
    );
  });

  test("publishes bounded recipe output while running", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-just-"));
    try {
      await writeFile(
        join(directory, "justfile"),
        "output:\n    @printf 'hello\\n'; printf 'warning\\n' >&2\n",
      );
      const updates: string[] = [];
      const result = await executeJustRecipe(
        directory,
        ["--one", "--", "output"],
        undefined,
        (output) => updates.push(output.text),
      );

      expect(result.stdout).toContain("hello");
      expect(result.stderr).toContain("warning");
      const finalOutput = updates.at(-1);
      if (finalOutput === undefined) throw new Error("recipe output was not published");
      expect(finalOutput).toContain("stdout:\nhello");
      expect(finalOutput).toContain("stderr:\nwarning");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("executes native confirmation recipes with bounded output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-just-"));
    try {
      await writeFile(
        join(directory, "justfile"),
        `[confirm]\nspam:\n    @i=0; while [ "$i" -lt 30000 ]; do printf x; i=$((i + 1)); done\n\nexact:\n    @i=0; while [ "$i" -lt 22000 ]; do printf x; i=$((i + 1)); done\n`,
      );

      const result = await executeJustRecipe(directory, ["--yes", "--one", "--", "spam"]);
      const exact = await executeJustRecipe(directory, ["--one", "--", "exact"]);

      expect(result.code).toBe(0);
      expect(result.stdoutTruncated).toBe(true);
      expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(22_000);
      expect(Buffer.byteLength(exact.stdout, "utf8")).toBe(22_000);
      expect(exact.stdoutTruncated).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("settles when a completed recipe leaves inherited output pipes open", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-just-"));
    try {
      await writeFile(join(directory, "justfile"), "background:\n    @sleep 2 & printf done\n");
      const startedAt = Date.now();

      const result = await executeJustRecipe(directory, ["--one", "--", "background"]);

      expect(result.code).toBe(0);
      expect(result.stdout).toBe("done");
      expect(Date.now() - startedAt).toBeLessThan(1_500);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("cancels a recipe process group", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-just-"));
    try {
      await writeFile(
        join(directory, "justfile"),
        "wait:\n    @trap '' TERM; while :; do sleep 1; done\n",
      );
      const controller = new AbortController();
      const execution = executeJustRecipe(directory, ["--one", "--", "wait"], controller.signal);
      setTimeout(() => controller.abort(), 100).unref();

      const result = await execution;

      expect(result.killed).toBe(true);
      expect(result.timedOut).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
