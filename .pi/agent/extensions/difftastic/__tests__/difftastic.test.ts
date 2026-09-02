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
  boundDiffOutput,
  buildGitInvocation,
  type DifftasticDetails,
  type DifftasticResult,
  registerDifftasticExtension,
  remapDifftasticColors,
  renderDiffLines,
  runDifftasticEditDiff,
  runDifftasticGitDiff,
  sanitizeTerminalOutput,
} from "..";

const details: DifftasticDetails = {
  display: "side-by-side",
  noChanges: false,
  output: "sample.ts --- TypeScript\n1 old    1 new",
  scope: "unstaged changes",
  width: 116,
};

const diffResult: DifftasticResult = {
  content: "sample.ts --- TypeScript\n1 old    1 new",
  details,
};

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected operation to reject");
}

describe("Difftastic Git invocation", () => {
  test("uses a side-by-side external diff for a wide terminal", () => {
    expect(buildGitInvocation({}, 120)).toEqual({
      args: [
        "--no-pager",
        "-c",
        "diff.external=difft --display=side-by-side --color=always --width=116 --context=3",
        "diff",
      ],
      display: "side-by-side",
      scope: "unstaged changes",
      width: 116,
    });
  });

  test("uses inline output when the terminal is narrow", () => {
    const invocation = buildGitInvocation({ display: "auto" }, 80);

    expect(invocation.display).toBe("inline");
    expect(invocation.width).toBe(76);
    expect(invocation.args[2]).toContain("--display=inline");
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
      "-c",
      "diff.external=difft --display=side-by-side --color=always --width=136 --context=8",
      "diff",
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

describe("Difftastic output handling", () => {
  test("keeps SGR styling and removes other terminal controls", () => {
    const input = "\u001b[31mred\u001b[0m\u001b]2;forged title\u0007safe\u001b[2J\u202e";

    expect(sanitizeTerminalOutput(input)).toBe("\u001b[31mred\u001b[0msafe");
  });

  test("maps Difftastic colors to Pi theme roles", () => {
    const theme = {
      getFgAnsi: (color: string) => `<${color}>`,
    } as Theme;
    const output =
      "\u001b[91;1mremoved\u001b[0m \u001b[92madded\u001b[39m \u001b[95mstring\u001b[0m";

    expect(remapDifftasticColors(output, theme)).toBe(
      "<toolDiffRemoved>\u001b[1mremoved\u001b[0m <toolDiffAdded>added\u001b[39m <syntaxString>string\u001b[0m",
    );
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

describe("Difftastic execution", () => {
  test("runs Git without a pager and returns plain model content", async () => {
    const executions: Array<{ command: string; args: string[]; options: ExecOptions }> = [];
    const result = await runDifftasticGitDiff(
      async (command, args, options) => {
        executions.push({ command, args, options });
        return {
          stdout: "\u001b[31m1 old\u001b[0m    \u001b[32m1 new\u001b[0m\n",
          stderr: "",
          code: 0,
          killed: false,
        };
      },
      { revision: "HEAD" },
      "/repo",
      { columns: 120 },
    );

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      command: "env",
      options: { cwd: "/repo", timeout: 60_000 },
    });
    expect(executions[0]?.args.slice(0, 4)).toEqual([
      "-u",
      "GIT_EXTERNAL_DIFF",
      "git",
      "--no-pager",
    ]);
    expect(result.content).toBe("1 old    1 new");
    expect(result.details.output).toContain("\u001b[31m");
    expect(result.details.scope).toBe("working tree against HEAD");
  });

  test("renders an edit diff from temporary before and after files", async () => {
    let executed: { command: string; args: string[]; options: ExecOptions } | undefined;
    const result = await runDifftasticEditDiff(
      async (command, args, options) => {
        executed = { command, args, options };
        return {
          stdout: `\u001b[91m${args[5]}\u001b[0m\n`,
          stderr: "",
          code: 0,
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

    expect(executed).toMatchObject({
      command: "difft",
      options: { cwd: "/repo", timeout: 10_000 },
    });
    expect(executed?.args.slice(0, 4)).toEqual([
      "--display=side-by-side",
      "--color=always",
      "--width=116",
      "--context=3",
    ]);
    expect(result.output).toContain("src/example.ts");
    expect(result.output).not.toContain("pi-difftastic-edit-");
    expect(result.scope).toBe("edit changes");
  });

  test("reports Git and Difftastic failures without terminal controls", async () => {
    const error = await rejection(
      runDifftasticGitDiff(
        async () => ({
          stdout: "",
          stderr: "\u001b[31merror: cannot run difft\u001b[0m",
          code: 128,
          killed: false,
        }),
        {},
        "/repo",
      ),
    );

    expect(error.message).toBe("Could not render structural Git diff:\nerror: cannot run difft");
  });

  test("reports cancellation distinctly", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(
      runDifftasticGitDiff(
        async () => ({ stdout: "", stderr: "", code: 1, killed: true }),
        {},
        "/repo",
        { signal: controller.signal },
      ),
    );

    expect(error.message).toBe("Structural Git diff was cancelled");
  });

  test("keeps a truncated diff when saving the full output fails", async () => {
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index + 1}`).join("\n");
    const result = await runDifftasticGitDiff(
      async () => ({ stdout: output, stderr: "", code: 0, killed: false }),
      {},
      "/repo",
      {
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

describe("Difftastic extension", () => {
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
        if (name === "difft") commandHandler = command.handler;
      },
      appendEntry: () => {},
    } as unknown as ExtensionAPI;
    registerDifftasticExtension(pi, { run: async () => diffResult });

    if (tool === undefined) throw new Error("git_diff tool was not registered");
    const toolResult = await tool.execute("diff-1", {}, undefined, undefined, {
      cwd: "/repo",
    } as ExtensionContext);
    expect(commandHandler).toBeDefined();
    expect(tool.name).toBe("git_diff");
    expect(toolResult.content[0]).toEqual({ type: "text", text: diffResult.content });
  });

  test("enables Difftastic edit previews from the settings option", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-difftastic-test-"));
    const filePath = join(root, "sample.ts");
    await writeFile(filePath, "const value = 1;\n", "utf8");

    const tools = new Map<string, ToolDefinition>();
    let sessionStart: ((event: unknown, context: ExtensionContext) => void) | undefined;
    const editDetails: DifftasticDetails = {
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
      registerDifftasticExtension(pi, {
        editPreviews: () => true,
        run: async () => diffResult,
        runEdit: async (request) => {
          editRun = request;
          if (failEditDiff) throw new Error("difft is unavailable");
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
      expect(result.details).toMatchObject({ difftastic: editDetails });

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

      failEditDiff = true;
      const fallbackResult = await editTool.execute(
        "edit-2",
        { path: "sample.ts", edits: [{ oldText: "2", newText: "3" }] },
        undefined,
        undefined,
        { cwd: root } as ExtensionContext,
      );
      expect(await readFile(filePath, "utf8")).toBe("const value = 3;\n");
      expect(fallbackResult.details).not.toHaveProperty("difftastic");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
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
    registerDifftasticExtension(pi, { run: async () => diffResult });

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
    registerDifftasticExtension(pi, {
      run: async () => {
        runs += 1;
        return diffResult;
      },
    });

    if (commandHandler === undefined) throw new Error("/difft command was not registered");
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
          "Usage: /difft\n\nShow unstaged working-tree changes using Difftastic.\nAsk the agent to use `git_diff` for staged changes, revisions, or path filters.\nSet `difftasticEditPreviews` to true in ~/.pi/agent/settings.json to use Difftastic for edit previews.",
        level: "info",
      },
    ]);
  });
});
