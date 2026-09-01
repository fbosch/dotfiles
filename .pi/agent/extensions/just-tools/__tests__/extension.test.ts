import { describe, expect, test } from "bun:test";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import justToolsExtension from "../index";

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
  setDump(value: unknown): void;
}

function createHarness(initialDump: unknown): Harness {
  let currentDump = initialDump;
  const tools = new Map<string, ToolDefinition>();
  const activeTools = ["read"];
  const executions: Array<{ command: string; args: string[]; options?: ExecOptions }> = [];
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

  return {
    pi,
    tools,
    activeTools,
    executions,
    setDump(value) {
      currentDump = value;
    },
  };
}

function context(confirmations: string[], confirmed = true): ExtensionContext {
  return {
    cwd: "/repo",
    hasUI: true,
    isProjectTrusted: () => true,
    ui: {
      async confirm(_title: string, message: string) {
        confirmations.push(message);
        return confirmed;
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
    justToolsExtension(harness.pi);

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
    expect(harness.executions.at(-1)).toMatchObject({
      command: "just",
      args: ["--one", "--", "shellcheck", "scripts"],
      options: { cwd: "/repo" },
    });
    expect(result.content[0]).toMatchObject({ type: "text", text: "stdout:\nchecked\n" });
  });

  test("requires reload when a registered recipe changes parameters", async () => {
    const harness = createHarness(dump());
    const ctx = context([]);
    justToolsExtension(harness.pi);
    const recipeTool = await loadShellcheck(harness, ctx);
    harness.setDump(dump([parameter("target")]));

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, ctx)).rejects.toThrow(
      "changed parameters; run `/reload`",
    );
  });

  test("fails closed when confirmation is unavailable or declined", async () => {
    const harness = createHarness(dump());
    justToolsExtension(harness.pi);
    const recipeTool = await loadShellcheck(harness, context([]));
    const noUi = { ...context([]), hasUI: false } as ExtensionContext;

    await expect(recipeTool.execute("recipe", {}, undefined, undefined, noUi)).rejects.toThrow(
      "requires interactive confirmation",
    );
    await expect(
      recipeTool.execute("recipe", {}, undefined, undefined, context([], false)),
    ).rejects.toThrow("was declined");
    expect(harness.executions.filter(({ args }) => !args.includes("--json"))).toEqual([]);
  });
});
