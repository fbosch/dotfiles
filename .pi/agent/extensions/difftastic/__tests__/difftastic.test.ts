import { describe, expect, test } from "bun:test";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  boundDiffOutput,
  buildGitInvocation,
  type DifftasticDetails,
  type DifftasticResult,
  registerDifftasticExtension,
  renderDiffLines,
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

  test("bounds output by complete lines", () => {
    const output = Array.from({ length: 2_001 }, (_, index) => `line ${index + 1}`).join("\n");
    const bounded = boundDiffOutput(output);

    expect(bounded.truncation).toMatchObject({ outputLines: 2_000, totalLines: 2_001 });
    expect(bounded.plain).toEndWith("line 2000");
    expect(bounded.plain).not.toContain("line 2001");
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
    expect(executions[0]).toMatchObject({ command: "git", options: { cwd: "/repo" } });
    expect(result.content).toBe("1 old    1 new");
    expect(result.details.output).toContain("\u001b[31m");
    expect(result.details.scope).toBe("working tree against HEAD");
  });

  test("reports Git and Difftastic failures without terminal controls", async () => {
    await expect(
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
    ).rejects.toThrow("Could not render structural Git diff:\nerror: cannot run difft");
  });
});

describe("Difftastic extension", () => {
  test("registers the tool and appends command output to the transcript", async () => {
    let tool: ToolDefinition | undefined;
    let commandHandler:
      | ((args: string, context: ExtensionCommandContext) => Promise<void> | void)
      | undefined;
    const entries: Array<{ type: string; data: DifftasticDetails }> = [];
    const pi = {
      registerEntryRenderer: () => {},
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
      appendEntry(type: string, data: DifftasticDetails) {
        entries.push({ type, data });
      },
    } as unknown as ExtensionAPI;
    registerDifftasticExtension(pi, { run: async () => diffResult });

    if (tool === undefined) throw new Error("git_diff tool was not registered");
    const toolResult = await tool.execute("diff-1", {}, undefined, undefined, {
      cwd: "/repo",
    } as ExtensionContext);
    if (commandHandler === undefined) throw new Error("/difft command was not registered");
    await commandHandler("", {
      cwd: "/repo",
      ui: { notify: () => {} },
    } as unknown as ExtensionCommandContext);

    expect(tool.name).toBe("git_diff");
    expect(toolResult.content[0]).toEqual({ type: "text", text: diffResult.content });
    expect(entries).toEqual([{ type: "difftastic-git-diff", data: details }]);
  });

  test("shows command help without executing a diff", async () => {
    let commandHandler:
      | ((args: string, context: ExtensionCommandContext) => Promise<void> | void)
      | undefined;
    const notifications: Array<{ message: string; level: string }> = [];
    let runs = 0;
    const pi = {
      registerEntryRenderer: () => {},
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
          "Usage: /difft\n\nShow unstaged working-tree changes using Difftastic.\nAsk the agent to use `git_diff` for staged changes, revisions, or path filters.",
        level: "info",
      },
    ]);
  });
});
