import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  executeJustRecipe,
  type RecipeExecutionResult,
  type RecipeExecutor,
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
): ExtensionContext {
  return {
    cwd: "/repo",
    hasUI: true,
    mode: "rpc",
    isProjectTrusted: () => true,
    ui: {
      async select(title: string, options: string[]) {
        confirmations.push(title);
        expect(options).toEqual(["1. Yes", "2. No"]);
        onConfirm?.();
        return confirmed ? "1. Yes" : "2. No";
      },
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

  test("executes native confirmation recipes with bounded output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-just-tools-"));
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
    const directory = await mkdtemp(join(tmpdir(), "pi-just-tools-"));
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
    const directory = await mkdtemp(join(tmpdir(), "pi-just-tools-"));
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
