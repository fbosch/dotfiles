import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import diffRenderingExtension, {
  boundDiffOutput,
  buildGitInvocation,
  type DiffDetails,
  type DiffRenderEngine,
  type DiffResult,
  loadDiffRenderingConfig,
  normalizeHashlineDiffDetails,
  registerDiffRenderingExtension,
  renderDiffLines,
  sanitizeTerminalOutput,
} from "..";

test("prewarms the renderer at session start and disposes it at shutdown", async () => {
  const hooks = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void>>();
  const calls: string[] = [];
  const engine: DiffRenderEngine = {
    prewarm: async () => {
      calls.push("prewarm");
    },
    dispose: async () => {
      calls.push("dispose");
    },
    render: testEngine.render,
  };
  const pi = {
    registerToolRenderer() {},
    registerTool() {},
    registerEntryRenderer() {},
    registerCommand() {},
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void>) =>
      hooks.set(event, handler),
  } as unknown as ExtensionAPI;
  registerDiffRenderingExtension(pi, { engine, config: { editPreviews: false } });
  expect(calls).toEqual([]);
  const ctx = { cwd: "/repo" } as ExtensionContext;
  await hooks.get("session_start")?.({}, ctx);
  await hooks.get("session_shutdown")?.({}, ctx);
  expect(calls).toEqual(["prewarm", "dispose"]);
});
const testEngine: DiffRenderEngine = {
  prewarm: async () => {},
  dispose: async () => {},
  render: async () => ({ output: "", display: "inline" }),
};

const details: DiffDetails = {
  display: "side-by-side",
  noChanges: false,
  output: "sample.ts --- TypeScript\n1 old    1 new",
  scope: "unstaged changes",
  width: 116,
};

const diffResult: DiffResult = {
  content: "sample.ts --- TypeScript\n1 old    1 new",
  details,
};

test("loads edit preview and syntax theme settings from the global settings file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-diff-rendering-config-"));
  try {
    await writeFile(
      join(root, "settings.json"),
      '{"diffRendering":{"editPreviews":true,"syntaxTheme":"zenwritten_dark"}}',
      "utf8",
    );
    expect(loadDiffRenderingConfig(root)).toEqual({
      editPreviews: true,
      syntaxTheme: "zenwritten_dark",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid Diff setting values", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-diff-rendering-config-invalid-"));
  try {
    await writeFile(
      join(root, "settings.json"),
      '{"diffRendering":{"editPreviews":"true"}}',
      "utf8",
    );
    expect(() => loadDiffRenderingConfig(root)).toThrow(
      "settings.diffRendering.editPreviews: expected a boolean",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("Diff Git invocation", () => {
  test("uses a side-by-side unified diff for a wide terminal", () => {
    expect(buildGitInvocation({}, 180)).toEqual({
      args: ["--no-pager", "diff", "--no-ext-diff", "--no-color", "--unified=3"],
      display: "side-by-side",
      scope: "unstaged changes",
      width: 176,
    });
  });

  test("uses inline Diff output when the terminal is narrow", () => {
    const invocation = buildGitInvocation({ display: "auto" }, 80);

    expect(invocation.display).toBe("inline");
    expect(invocation.width).toBe(76);
  });

  test("places revisions before safely separated pathspecs", () => {
    const invocation = buildGitInvocation(
      {
        staged: true,
        revision: "HEAD~1",
        paths: ["@src/example.ts", "path with spaces.ts"],
        context: 8,
      },
      140,
    );

    expect(invocation.args).toEqual([
      "--no-pager",
      "diff",
      "--no-ext-diff",
      "--no-color",
      "--unified=8",
      "--cached",
      "HEAD~1",
      "--",
      "src/example.ts",
      "path with spaces.ts",
    ]);
    expect(invocation.scope).toBe("staged changes against HEAD~1");
  });

  test("rejects revisions that could be parsed as options", () => {
    expect(() => buildGitInvocation({ revision: "--output=/tmp/result" }, 120)).toThrow(
      "Git revision must not begin with '-'",
    );
  });
});

describe("Diff output handling", () => {
  test("keeps SGR styling and removes other terminal controls", () => {
    const input = "\u001b[31mred\u001b[0m\u001b]2;forged title\u0007safe\u001b[2J\u202e";

    expect(sanitizeTerminalOutput(input)).toBe("\u001b[31mred\u001b[0msafe");
  });

  test("preserves truecolor syntax highlighting", () => {
    const output = "\u001b[38;2;200;100;50mconst\u001b[0m value";

    expect(sanitizeTerminalOutput(output)).toBe(output);
  });

  test("bounds output by complete lines", () => {
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index + 1}`).join("\n");
    const bounded = boundDiffOutput(output);

    expect(bounded.truncation).toMatchObject({ outputLines: 2_000, totalLines: 2_001 });
    expect(bounded.plain).toEndWith("line 2000");
    expect(bounded.plain).not.toContain("line 2001");
  });

  test("bounds output by UTF-8 bytes as well as lines", () => {
    const bounded = boundDiffOutput(Array.from({ length: 600 }, () => "ø".repeat(100)).join("\n"));

    expect(bounded.truncation).toBeDefined();
    expect(Buffer.byteLength(bounded.plain, "utf8")).toBeLessThanOrEqual(50 * 1024);
  });

  test("wraps rendered lines without exceeding the available width", () => {
    const lines = renderDiffLines(["\u001b[31m123456789\u001b[0m"], 4);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => visibleWidth(line) <= 4)).toBeTrue();
  });
  test("hides hashline metadata from rendered diff details", () => {
    const details = {
      diff: " MSos│done\n+IPal│grep -Fq 'runtime/desktop/waybar-monitor.sh'",
      diffLineNumbers: [65, 66],
      classification: "applied",
    };
    expect(normalizeHashlineDiffDetails(details)).toEqual({
      diff: " done\n+grep -Fq 'runtime/desktop/waybar-monitor.sh'",
      diffLineNumbers: details.diffLineNumbers,
      classification: details.classification,
    });
  });
});

describe("Diff extension", () => {
  test("default factory returns synchronously without registering hashline tools", () => {
    const registeredTools: string[] = [];
    let rendererRegistrations = 0;
    const pi = {
      registerToolRenderer: () => {
        rendererRegistrations++;
      },
      registerEntryRenderer: () => {},
      on: () => {},
      registerTool(tool: ToolDefinition) {
        registeredTools.push(tool.name);
      },
      registerCommand: () => {},
    } as unknown as Parameters<typeof diffRenderingExtension>[0];

    expect(diffRenderingExtension(pi)).toBeUndefined();
    expect(registeredTools).toEqual(["git_diff"]);
    expect(rendererRegistrations).toBe(2);
  });

  test("defers hashline loading until the first agent turn and registers once per session", async () => {
    type Handler = (event: unknown, context: ExtensionContext) => Promise<void> | void;
    const handlers = new Map<string, Handler>();
    const registeredTools: string[] = [];
    let loads = 0;
    const hashlineTool = { name: "replace" } as ToolDefinition;
    const pi = {
      registerEntryRenderer: () => {},
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      registerTool(tool: ToolDefinition) {
        registeredTools.push(tool.name);
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;

    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      config: { editPreviews: true },
      loadHashlineTools: async () => {
        loads += 1;
        return [hashlineTool];
      },
      run: async () => diffResult,
    });
    const sessionStart = handlers.get("session_start");
    const beforeAgentStart = handlers.get("before_agent_start");
    if (sessionStart === undefined || beforeAgentStart === undefined) {
      throw new Error("Diff lifecycle handlers were not registered");
    }

    await sessionStart({}, { cwd: "/repo-a" } as ExtensionContext);
    expect(loads).toBe(0);
    expect(registeredTools.filter((name) => name === "replace")).toHaveLength(0);

    await beforeAgentStart({}, { cwd: "/repo-a" } as ExtensionContext);
    await beforeAgentStart({}, { cwd: "/repo-a" } as ExtensionContext);
    expect(loads).toBe(1);
    expect(registeredTools.filter((name) => name === "replace")).toHaveLength(1);

    await sessionStart({}, { cwd: "/repo-b" } as ExtensionContext);
    expect(loads).toBe(1);
    await beforeAgentStart({}, { cwd: "/repo-b" } as ExtensionContext);
    await beforeAgentStart({}, { cwd: "/repo-b" } as ExtensionContext);
    expect(loads).toBe(2);
    expect(registeredTools.filter((name) => name === "replace")).toHaveLength(2);
  });

  test("never loads hashline tools when edit previews are disabled", async () => {
    type Handler = (event: unknown, context: ExtensionContext) => Promise<void> | void;
    const handlers = new Map<string, Handler>();
    let loads = 0;
    const pi = {
      registerEntryRenderer: () => {},
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
      },
      registerTool: () => {},
      registerCommand: () => {},
    } as unknown as ExtensionAPI;

    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      config: { editPreviews: false },
      loadHashlineTools: async () => {
        loads += 1;
        return [];
      },
      run: async () => diffResult,
    });
    await handlers.get("session_start")?.({}, { cwd: "/repo" } as ExtensionContext);
    await handlers.get("before_agent_start")?.({}, { cwd: "/repo" } as ExtensionContext);
    expect(loads).toBe(0);
  });

  test("registers the model tool and interactive command", async () => {
    let tool: ToolDefinition | undefined;
    let commandHandler:
      | ((args: string, context: ExtensionCommandContext) => Promise<void> | void)
      | undefined;
    const pi = {
      registerEntryRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
      registerCommand(
        name: string,
        command: {
          handler: (args: string, context: ExtensionCommandContext) => Promise<void> | void;
        },
      ) {
        if (name === "diff") commandHandler = command.handler;
      },
      appendEntry: () => {},
    } as unknown as ExtensionAPI;
    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      run: async () => diffResult,
    });

    if (tool === undefined) throw new Error("git_diff tool was not registered");
    const toolResult = await tool.execute(
      "diff-1",
      {},
      undefined,
      undefined,
      withToolExecution({ cwd: "/repo" } as ExtensionContext),
    );
    expect(commandHandler).toBeDefined();
    expect(tool.name).toBe("git_diff");
    expect(toolResult.content[0]).toEqual({ type: "text", text: diffResult.content });

    const renderResult = tool.renderResult;
    if (renderResult === undefined) throw new Error("git_diff result renderer was not registered");
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
      getFgAnsi: (color: string) => `<${color}>`,
    } as Theme;
    const context: Parameters<typeof renderResult>[3] = {
      args: {},
      argsComplete: true,
      cwd: "/repo",
      executionStarted: true,
      expanded: false,
      invalidate: () => {},
      isError: false,
      durationMs: undefined,
      outputPad: 1,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "diff-1",
    };
    const rendered = renderResult(
      toolResult,
      { expanded: false, isPartial: false },
      theme,
      context,
    ).render(24);

    expect(rendered[0]).toBe("");
    expect(rendered.slice(1).every((line) => visibleWidth(line) <= 24)).toBeTrue();

    const emptyResult = {
      content: [{ type: "text" as const, text: "No unstaged changes." }],
      details: { ...details, noChanges: true, output: "" },
    };
    const emptyRendered = renderResult(
      emptyResult,
      { expanded: false, isPartial: false },
      theme,
      context,
    ).render(24);

    expect(emptyRendered).toEqual([""]);
  });

  test("rerenders full unified context when a diff is expanded", async () => {
    let tool: ToolDefinition | undefined;
    const requests: Array<{ context?: number }> = [];
    const compactDetails: DiffDetails = {
      ...details,
      output: "sample.ts --- TypeScript\n1 old    1 new",
    };
    const fullDetails: DiffDetails = {
      ...compactDetails,
      output: "sample.ts --- TypeScript\n1 old    1 new\nunchanged line",
    };
    const pi = {
      registerEntryRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;
    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      run: async (request) => {
        requests.push(request);
        return request.context === 2_000
          ? { content: "full", details: fullDetails }
          : { content: "compact", details: compactDetails };
      },
    });

    if (tool === undefined || tool.renderResult === undefined) {
      throw new Error("git_diff renderer was not registered");
    }
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
      getFgAnsi: (color: string) => `<${color}>`,
    } as Theme;
    const result = {
      content: [{ type: "text" as const, text: "compact" }],
      details: compactDetails,
    };
    const context = {
      args: {},
      argsComplete: true,
      cwd: "/repo",
      executionStarted: true,
      expanded: true,
      invalidate: () => {},
      isError: false,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "diff-1",
    } as Parameters<typeof tool.renderResult>[3];

    const initial = tool.renderResult(result, { expanded: true, isPartial: false }, theme, context);
    expect(initial.render(120).join("\n")).toContain("1 old    1 new");

    await new Promise((resolve) => setTimeout(resolve, 0));
    const expanded = tool.renderResult(
      result,
      { expanded: true, isPartial: false },
      theme,
      context,
    );

    expect(requests).toEqual([{ context: 2_000 }]);
    expect(expanded.render(120).join("\n")).toContain("unchanged line");
    expect(expanded.render(120).join("\n")).not.toContain("..\n");
  });

  test("enables Diff edit previews from the global settings option", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-diff-rendering-test-"));
    const filePath = join(root, "sample.ts");
    await writeFile(filePath, "const value = 1;\n", "utf8");

    const tools = new Map<string, ToolDefinition>();
    type LifecycleHandler = (event: unknown, context: ExtensionContext) => Promise<void> | void;
    let sessionStart: LifecycleHandler | undefined;
    let beforeAgentStart: LifecycleHandler | undefined;
    const editDetails: DiffDetails = {
      ...details,
      output: "\u001b[91m1 const value = 1;\u001b[0m\n\u001b[92m1 const value = 2;\u001b[0m",
      scope: "edit changes",
    };
    let editRun: { oldContent: string; newContent: string; path: string } | undefined;
    let failEditDiff = false;
    const pi = {
      registerEntryRenderer: () => {},
      on(event: string, handler: LifecycleHandler) {
        if (event === "session_start") sessionStart = handler;
        if (event === "before_agent_start") beforeAgentStart = handler;
      },
      registerTool(definition: ToolDefinition) {
        tools.set(definition.name, definition);
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;

    try {
      registerDiffRenderingExtension(pi, {
        engine: testEngine,
        editPreviews: () => true,
        run: async () => diffResult,
        runEdit: async (request) => {
          editRun = request;
          if (failEditDiff) throw new Error("diffRendering is unavailable");
          return editDetails;
        },
      });
      await sessionStart?.({ type: "session_start" }, { cwd: root } as ExtensionContext);

      const editTool = tools.get("edit");
      if (editTool === undefined) throw new Error("edit override was not registered");
      expect(tools.has("replace")).toBeFalse();
      await beforeAgentStart?.({ type: "before_agent_start" }, { cwd: root } as ExtensionContext);
      const replaceTool = tools.get("replace");
      if (replaceTool === undefined)
        throw new Error("hashline replace override was not registered");
      const result = await editTool.execute(
        "edit-1",
        { path: "sample.ts", edits: [{ oldText: "1", newText: "2" }] },
        undefined,
        undefined,
        withToolExecution({ cwd: root } as ExtensionContext),
      );

      expect(editRun).toEqual({
        oldContent: "const value = 1;\n",
        newContent: "const value = 2;\n",
        path: "sample.ts",
      });
      expect(await readFile(filePath, "utf8")).toBe("const value = 2;\n");
      expect(result.details).toMatchObject({ diffRendering: editDetails });

      const renderResult = editTool.renderResult;
      if (renderResult === undefined) throw new Error("edit result renderer was not registered");
      const theme = {
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
        getBgAnsi: () => "\u001b[48;2;34;34;34m",
        getFgAnsi: (color: string) => `<${color}>`,
      } as unknown as Theme;
      const replaceRenderCall = replaceTool.renderCall;
      if (replaceRenderCall === undefined)
        throw new Error("hashline replace renderer was not registered");
      expect(
        replaceRenderCall(
          { path: "sample.ts" },
          theme,
          {} as Parameters<typeof replaceRenderCall>[2],
        )
          .render(120)
          .map((line) => line.trimEnd()),
      ).toEqual(["replace sample.ts"]);
      const rendered = renderResult(result, { expanded: true, isPartial: false }, theme, {
        args: { path: "sample.ts", edits: [{ oldText: "1", newText: "2" }] },
        argsComplete: true,
        cwd: root,
        executionStarted: true,
        expanded: true,
        invalidate: () => {},
        isError: false,
        isPartial: false,
        lastComponent: undefined,
        showImages: false,
        state: {},
        toolCallId: "edit-1",
      } as Parameters<typeof renderResult>[3]);

      expect(rendered.render(120).join("\n")).toContain("const value = 2;");

      const deduplicated = renderResult(result, { expanded: true, isPartial: false }, theme, {
        args: { path: "sample.ts", edits: [{ oldText: "1", newText: "2" }] },
        argsComplete: true,
        cwd: root,
        executionStarted: true,
        expanded: true,
        invalidate: () => {},
        isError: false,
        isPartial: false,
        lastComponent: rendered,
        showImages: false,
        state: { preview: editDetails },
        toolCallId: "edit-1",
      } as Parameters<typeof renderResult>[3]);
      expect(deduplicated.render(120)).toEqual([]);

      failEditDiff = true;
      const fallbackResult = await editTool.execute(
        "edit-2",
        { path: "sample.ts", edits: [{ oldText: "2", newText: "3" }] },
        undefined,
        undefined,
        withToolExecution({ cwd: root } as ExtensionContext),
      );
      expect(await readFile(filePath, "utf8")).toBe("const value = 3;\n");
      expect(fallbackResult.details).not.toHaveProperty("diffRendering");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  test("shows a path count instead of repeating a single filename", () => {
    let tool: ToolDefinition | undefined;
    const pi = {
      registerEntryRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;
    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      run: async () => diffResult,
    });

    const renderCall = tool?.renderCall;
    if (renderCall === undefined) throw new Error("git_diff call renderer was not registered");
    const args = { paths: [".pi/agent/lib/ai-commit/cli.ts"] };
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    } as Theme;
    const context: Parameters<typeof renderCall>[2] = {
      args,
      argsComplete: true,
      cwd: "/repo",
      executionStarted: false,
      expanded: false,
      invalidate: () => {},
      isError: false,
      durationMs: undefined,
      outputPad: 1,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "diff-1",
    };

    const rendered = renderCall(args, theme, context).render(80).join("\n").trim();

    expect(rendered).toBe("git diff -- 1 path");
    expect(rendered).not.toContain("cli.ts");
  });

  test("compacts multiple paths in the tool call header", () => {
    let tool: ToolDefinition | undefined;
    const pi = {
      registerEntryRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      registerTool(definition: ToolDefinition) {
        tool = definition;
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;
    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      run: async () => diffResult,
    });

    const renderCall = tool?.renderCall;
    if (renderCall === undefined) throw new Error("git_diff call renderer was not registered");
    const args = {
      paths: [
        ".pi/agent/extensions/prompt-ui/subagent-widget-frame.ts",
        ".pi/agent/extensions/prompt-ui/__tests__/subagent-widget-frame.test.ts",
      ],
    };
    const theme = {
      bold: (text: string) => text,
      fg: (_color: string, text: string) => text,
    } as Theme;
    const context: Parameters<typeof renderCall>[2] = {
      args,
      argsComplete: true,
      cwd: "/repo",
      executionStarted: false,
      expanded: false,
      invalidate: () => {},
      isError: false,
      durationMs: undefined,
      outputPad: 1,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "diff-1",
    };

    const rendered = renderCall(args, theme, context).render(147).join("\n").trim();

    expect(rendered).toBe("git diff -- 2 paths");
  });

  test("shows command help without executing a diff", async () => {
    let commandHandler:
      | ((args: string, context: ExtensionCommandContext) => Promise<void> | void)
      | undefined;
    const notifications: Array<{ message: string; level: string }> = [];
    let runs = 0;
    const pi = {
      registerEntryRenderer: () => {},
      registerFlag: () => {},
      on: () => {},
      registerTool: () => {},
      registerCommand(
        _name: string,
        command: {
          handler: (args: string, context: ExtensionCommandContext) => Promise<void> | void;
        },
      ) {
        commandHandler = command.handler;
      },
      appendEntry: () => {},
    } as unknown as ExtensionAPI;
    registerDiffRenderingExtension(pi, {
      engine: testEngine,
      run: async () => {
        runs += 1;
        return diffResult;
      },
    });

    if (commandHandler === undefined) throw new Error("/diff command was not registered");
    await commandHandler("--help", {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    } as unknown as ExtensionCommandContext);

    expect(runs).toBe(0);
    expect(notifications).toEqual([
      {
        message:
          "Usage: /diff\n\nShow unstaged working-tree changes with syntax highlighting.\nAsk the agent to use `git_diff` for staged changes, revisions, or path filters.\nSet `diffRendering.editPreviews` to true in ~/.pi/agent/settings.json to enable syntax-highlighted edit previews.",
        level: "info",
      },
    ]);
  });
});
