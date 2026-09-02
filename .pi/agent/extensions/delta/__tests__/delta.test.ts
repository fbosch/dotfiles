import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  applyDiffTheme,
  boundDiffOutput,
  buildDeltaInvocation,
  buildGitInvocation,
  type DeltaDetails,
  type DeltaResult,
  loadDeltaConfig,
  registerDeltaExtension,
  renderDiffLines,
  runDeltaEditDiff,
  runDeltaGitDiff,
  sanitizeTerminalOutput,
} from "..";

const details: DeltaDetails = {
  display: "side-by-side",
  noChanges: false,
  output: "sample.ts --- TypeScript\n1 old    1 new",
  scope: "unstaged changes",
  width: 116,
};

const diffResult: DeltaResult = {
  content: "sample.ts --- TypeScript\n1 old    1 new",
  details,
};

test("loads edit preview and syntax theme settings from the dedicated config file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-delta-config-"));
  try {
    await writeFile(
      join(root, "delta.json"),
      '{"editPreviews":true,"syntaxTheme":"Zenwritten Dark"}',
      "utf8",
    );
    expect(loadDeltaConfig(root)).toEqual({
      editPreviews: true,
      syntaxTheme: "Zenwritten Dark",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unknown Delta config fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-delta-config-invalid-"));
  try {
    await writeFile(join(root, "delta.json"), '{"decorateHeaders":true}', "utf8");
    expect(() => loadDeltaConfig(root)).toThrow("delta config.decorateHeaders: unknown field");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}

describe("Delta Git invocation", () => {
  test("uses a side-by-side unified diff for a wide terminal", () => {
    expect(buildGitInvocation({}, 120)).toEqual({
      args: ["--no-pager", "diff", "--no-ext-diff", "--no-color", "--unified=3"],
      display: "side-by-side",
      scope: "unstaged changes",
      width: 116,
    });
  });

  test("uses inline Delta output when the terminal is narrow", () => {
    const invocation = buildGitInvocation({ display: "auto" }, 80);
    const deltaArgs = buildDeltaInvocation(invocation.display, invocation.width);

    expect(invocation.display).toBe("inline");
    expect(invocation.width).toBe(76);
    expect(deltaArgs).not.toContain("--side-by-side");
  });

  test("uses undecorated, background-free Delta styles", () => {
    const deltaArgs = buildDeltaInvocation("side-by-side", 116, {
      context: 8,
      edit: true,
      syntaxTheme: "Zenwritten Dark",
    });

    expect(deltaArgs).toContain("--side-by-side");
    expect(deltaArgs).toContain("--file-style=omit");
    expect(deltaArgs).toContain("--file-decoration-style=omit");
    expect(deltaArgs).toContain("--hunk-header-style=omit");
    expect(deltaArgs).toContain("--hunk-header-decoration-style=omit");
    expect(deltaArgs).toContain("--line-numbers-minus-style=88");
    expect(deltaArgs).toContain("--line-numbers-plus-style=28");
    expect(deltaArgs).toContain("--minus-style=syntax");
    expect(deltaArgs).toContain("--minus-emph-style=syntax");
    expect(deltaArgs).toContain("--plus-style=syntax");
    expect(deltaArgs).toContain("--plus-emph-style=syntax");
    expect(deltaArgs).toContain("--diff-args=-U8");
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

describe("Delta output handling", () => {
  test("keeps SGR styling and removes other terminal controls", () => {
    const input = "\u001b[31mred\u001b[0m\u001b]2;forged title\u0007safe\u001b[2J\u202e";

    expect(sanitizeTerminalOutput(input)).toBe("\u001b[31mred\u001b[0msafe");
  });

  test("preserves Delta truecolor syntax highlighting", () => {
    const output = "\u001b[38;2;200;100;50mconst\u001b[0m value";

    expect(sanitizeTerminalOutput(output)).toBe(output);
  });

  test("keeps the tool background solid and uses Pi's diff colors", () => {
    const theme = {
      getFgAnsi: (color: string) =>
        color === "toolDiffAdded" ? "\u001b[38;2;129;155;105m" : "\u001b[38;2;222;110;124m",
    } as Theme;
    const output =
      "\u001b[48;2;0;40;0;38;5;28madded\u001b[0m " + "\u001b[48;2;63;0;1;38;5;88mremoved\u001b[0m";
    const themed = applyDiffTheme(output, theme);

    expect(themed).toContain("\u001b[38;2;129;155;105madded");
    expect(themed).toContain("\u001b[38;2;222;110;124mremoved");
    expect(themed).not.toContain("\u001b[0m");
    expect(themed).not.toContain("48;2");
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
});

describe("Delta execution", () => {
  test("pipes a pager-free unified Git diff through Delta", async () => {
    const gitExecutions: Array<{ command: string; args: string[]; options: ExecOptions }> = [];
    const deltaExecutions: Array<{
      args: readonly string[];
      input: string | undefined;
      options: ExecOptions;
    }> = [];
    const unifiedDiff = "diff --git a/sample.ts b/sample.ts\n-old\n+new\n";
    const result = await runDeltaGitDiff(
      async (command, args, options) => {
        gitExecutions.push({ command, args, options });
        return { stdout: unifiedDiff, stderr: "", code: 0, killed: false };
      },
      { revision: "HEAD" },
      "/repo",
      {
        columns: 120,
        executeDelta: async (args, input, options) => {
          deltaExecutions.push({ args, input, options });
          return {
            stdout: "\u001b[31m1 old\u001b[0m    \u001b[32m1 new\u001b[0m\n",
            stderr: "",
            code: 0,
            killed: false,
          };
        },
      },
    );

    expect(gitExecutions).toHaveLength(1);
    expect(gitExecutions[0]).toMatchObject({
      command: "env",
      options: { cwd: "/repo", timeout: 60_000 },
    });
    expect(gitExecutions[0]?.args.slice(0, 4)).toEqual([
      "-u",
      "GIT_EXTERNAL_DIFF",
      "git",
      "--no-pager",
    ]);
    expect(deltaExecutions).toHaveLength(1);
    expect(deltaExecutions[0]?.input).toBe(unifiedDiff);
    expect(deltaExecutions[0]?.args).toContain("--no-gitconfig");
    expect(deltaExecutions[0]?.args).toContain("--side-by-side");
    expect(result.content).toBe("1 old    1 new");
    expect(result.details.output).toContain("\u001b[31m");
    expect(result.details.scope).toBe("working tree against HEAD");
  });

  test("does not invoke Delta for an empty Git diff", async () => {
    let deltaRuns = 0;
    const result = await runDeltaGitDiff(
      async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
      {},
      "/repo",
      {
        executeDelta: async () => {
          deltaRuns += 1;
          return { stdout: "", stderr: "", code: 0, killed: false };
        },
      },
    );

    expect(deltaRuns).toBe(0);
    expect(result.content).toBe("No unstaged changes.");
    expect(result.details.noChanges).toBeTrue();
  });

  test("renders an edit diff from temporary before and after files", async () => {
    let executed:
      | { args: readonly string[]; input: string | undefined; options: ExecOptions }
      | undefined;
    let comparedContent: string[] = [];
    const result = await runDeltaEditDiff(
      async (args, input, options) => {
        executed = { args, input, options };
        comparedContent = await Promise.all([
          readFile(args.at(-2) ?? "", "utf8"),
          readFile(args.at(-1) ?? "", "utf8"),
        ]);
        return {
          stdout:
            "\n\u001b[91m1 const value = 1;\u001b[0m    \u001b[92m1 const value = 2;\u001b[0m\n",
          stderr: "",
          code: 1,
          killed: false,
        };
      },
      {
        newContent: "const value = 2;\n",
        oldContent: "const value = 1;\n",
        path: "src/example.ts",
      },
      "/repo",
      { columns: 120 },
    );

    expect(executed?.input).toBeUndefined();
    expect(executed?.options).toMatchObject({ cwd: "/repo", timeout: 10_000 });
    expect(executed?.args).toContain("--side-by-side");
    expect(executed?.args).toContain("--file-style=omit");
    expect(executed?.args).toContain("--diff-args=-U3");
    expect(comparedContent).toEqual(["const value = 1;\n", "const value = 2;\n"]);
    expect(result.output).toStartWith("\u001b[91m1 const value");
    expect(result.output).not.toContain("pi-delta-edit-");
    expect(result.scope).toBe("edit changes");
  });

  test("reports Git failures without terminal controls", async () => {
    const error = await rejection(
      runDeltaGitDiff(
        async () => ({
          stdout: "",
          stderr: "\u001b[31mfatal: invalid revision\u001b[0m",
          code: 128,
          killed: false,
        }),
        {},
        "/repo",
      ),
    );

    expect(error.message).toBe("Could not read Git diff:\nfatal: invalid revision");
  });

  test("reports Delta failures without terminal controls", async () => {
    const error = await rejection(
      runDeltaGitDiff(
        async () => ({ stdout: "diff --git a/a b/a\n", stderr: "", code: 0, killed: false }),
        {},
        "/repo",
        {
          executeDelta: async () => ({
            stdout: "",
            stderr: "\u001b[31merror: unknown syntax theme\u001b[0m",
            code: 2,
            killed: false,
          }),
        },
      ),
    );

    expect(error.message).toBe(
      "Could not render Git diff with Delta:\nerror: unknown syntax theme",
    );
  });

  test("reports cancellation distinctly", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(
      runDeltaGitDiff(
        async () => ({ stdout: "", stderr: "", code: 1, killed: true }),
        {},
        "/repo",
        { signal: controller.signal },
      ),
    );

    expect(error.message).toBe("Git diff was cancelled");
  });

  test("keeps a truncated diff when saving the full output fails", async () => {
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index + 1}`).join("\n");
    const result = await runDeltaGitDiff(
      async () => ({ stdout: output, stderr: "", code: 0, killed: false }),
      {},
      "/repo",
      {
        executeDelta: async () => ({ stdout: output, stderr: "", code: 0, killed: false }),
        writeFullOutput: async () => {
          throw new Error("read-only temporary directory");
        },
      },
    );

    expect(result.details.truncation).toBeDefined();
    expect(result.details.warning).toBe(
      "Could not save the full diff: read-only temporary directory",
    );
    expect(result.content).toContain("Full output could not be saved.");
  });
});

describe("Delta extension", () => {
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
        if (name === "delta") commandHandler = command.handler;
      },
      appendEntry: () => {},
    } as unknown as ExtensionAPI;
    registerDeltaExtension(pi, { run: async () => diffResult });

    if (tool === undefined) throw new Error("git_diff tool was not registered");
    const toolResult = await tool.execute("diff-1", {}, undefined, undefined, {
      cwd: "/repo",
    } as ExtensionContext);
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
    const rendered = renderResult(toolResult, { expanded: false, isPartial: false }, theme, {
      args: {},
      argsComplete: true,
      cwd: "/repo",
      executionStarted: true,
      expanded: false,
      invalidate: () => {},
      isError: false,
      isPartial: false,
      lastComponent: undefined,
      showImages: false,
      state: {},
      toolCallId: "diff-1",
    }).render(24);

    expect(rendered[0]).toBe("");
    expect(rendered.slice(1).every((line) => visibleWidth(line) <= 24)).toBeTrue();
  });

  test("rerenders full unified context when a diff is expanded", async () => {
    let tool: ToolDefinition | undefined;
    const requests: Array<{ context?: number }> = [];
    const compactDetails: DeltaDetails = {
      ...details,
      output: "sample.ts --- TypeScript\n1 old    1 new",
    };
    const fullDetails: DeltaDetails = {
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
    registerDeltaExtension(pi, {
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

  test("enables Delta edit previews from the dedicated config option", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-delta-test-"));
    const filePath = join(root, "sample.ts");
    await writeFile(filePath, "const value = 1;\n", "utf8");

    const tools = new Map<string, ToolDefinition>();
    let sessionStart: ((event: unknown, context: ExtensionContext) => void) | undefined;
    const editDetails: DeltaDetails = {
      ...details,
      output: "\u001b[91m1 const value = 1;\u001b[0m\n\u001b[92m1 const value = 2;\u001b[0m",
      scope: "edit changes",
    };
    let editRun: { oldContent: string; newContent: string; path: string } | undefined;
    let failEditDiff = false;
    const pi = {
      registerEntryRenderer: () => {},
      on(_event: string, handler: (event: unknown, context: ExtensionContext) => void) {
        sessionStart = handler;
      },
      registerTool(definition: ToolDefinition) {
        tools.set(definition.name, definition);
      },
      registerCommand: () => {},
    } as unknown as ExtensionAPI;

    try {
      registerDeltaExtension(pi, {
        editPreviews: () => true,
        run: async () => diffResult,
        runEdit: async (request) => {
          editRun = request;
          if (failEditDiff) throw new Error("delta is unavailable");
          return editDetails;
        },
      });
      sessionStart?.({ type: "session_start" }, { cwd: root } as ExtensionContext);

      const editTool = tools.get("edit");
      if (editTool === undefined) throw new Error("edit override was not registered");
      const result = await editTool.execute(
        "edit-1",
        { path: "sample.ts", edits: [{ oldText: "1", newText: "2" }] },
        undefined,
        undefined,
        { cwd: root } as ExtensionContext,
      );

      expect(editRun).toEqual({
        oldContent: "const value = 1;\n",
        newContent: "const value = 2;\n",
        path: "sample.ts",
      });
      expect(await readFile(filePath, "utf8")).toBe("const value = 2;\n");
      expect(result.details).toMatchObject({ delta: editDetails });

      const renderResult = editTool.renderResult;
      if (renderResult === undefined) throw new Error("edit result renderer was not registered");
      const theme = {
        bg: (_color: string, text: string) => text,
        bold: (text: string) => text,
        fg: (_color: string, text: string) => text,
        getFgAnsi: (color: string) => `<${color}>`,
      } as Theme;
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
        { cwd: root } as ExtensionContext,
      );
      expect(await readFile(filePath, "utf8")).toBe("const value = 3;\n");
      expect(fallbackResult.details).not.toHaveProperty("delta");
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
    registerDeltaExtension(pi, { run: async () => diffResult });

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
    registerDeltaExtension(pi, { run: async () => diffResult });

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
    registerDeltaExtension(pi, {
      run: async () => {
        runs += 1;
        return diffResult;
      },
    });

    if (commandHandler === undefined) throw new Error("/delta command was not registered");
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
          "Usage: /delta\n\nShow unstaged working-tree changes using Delta.\nAsk the agent to use `git_diff` for staged changes, revisions, or path filters.\nSet `editPreviews` to true in ~/.pi/agent/delta.json to use Delta for edit previews.",
        level: "info",
      },
    ]);
  });
});
