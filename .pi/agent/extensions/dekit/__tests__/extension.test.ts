import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecOptions,
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import justExtension from "../../just";
import { discoverScripts, isManagedTask, scriptCommand, taskPath } from "../catalog";
import dekitExtension from "../index";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const path = `pi/package/${"a".repeat(24)}`;
async function harness() {
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
      recipes: {
        build: {
          name: "build",
          namepath: "build",
          doc: "Build the project",
          parameters: [],
          private: false,
        },
        hidden: { name: "hidden", private: true },
      },
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

test("discovers public Just recipes and package scripts without contacting the runner", async () => {
  const h = await harness();
  await writeFile(join(h.cwd, "justfile"), "build:\n  echo build\n");
  const result = await h.invoke({ action: "discover" });
  expect(result.details).toMatchObject({
    scripts: [
      { id: "just:build", description: "Build the project" },
      { id: "package:test", description: "printf hello" },
      { id: "package:serve" },
    ],
  });
  expect(h.calls.map((call) => call.command)).toEqual(["just"]);
  expect(h.calls[0]?.args).toContain(join(h.cwd, "justfile"));
  expect(h.state.confirmations).toEqual([]);
});

test("searches and bounds discovery results", async () => {
  const h = await harness();
  expect((await h.invoke({ action: "discover", query: "printf", limit: 1 })).details).toMatchObject(
    { scripts: [{ id: "package:test" }] },
  );
  expect((await h.invoke({ action: "discover", query: "missing" })).details).toMatchObject({
    scripts: [],
  });
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
    Object.assign(h.state.just.recipes.build, { body: ["different command"] });
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
