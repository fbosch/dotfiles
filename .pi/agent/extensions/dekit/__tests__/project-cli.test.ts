import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { withToolExecution } from "../../__tests__/fixtures/tool-context";
import { discoverScripts, scriptCommand, taskPath } from "../catalog";
import dekitExtension from "../index";
import { type ProjectTask, projectTasks } from "../project-cli";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function harness() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dekit-picker-")));
  directories.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      packageManager: "npm@10",
      scripts: { dev: "sleep 60", test: "echo test" },
    }),
  );
  const calls: Array<{ command: string; args: string[] }> = [];
  const state = {
    running: false,
    tasks: [] as ProjectTask[],
    code: 0,
    response: undefined as unknown,
  };
  const executor: Pick<ExtensionAPI, "exec"> = {
    async exec(command, args) {
      calls.push({ command, args });
      let data: unknown = { matched: 1 };
      if (command === "just")
        data = {
          aliases: {},
          recipes: {
            build: {
              name: "build",
              namepath: "build",
              doc: "Build it",
              private: false,
              parameters: [{ name: "target", kind: "singular", default: null }],
            },
            hidden: { name: "hidden", private: true },
          },
        };
      else if (args.includes("runner"))
        data = state.running ? { status: "running", root, kind: "project" } : { status: "absent" };
      else if (args.includes("ls")) data = { tasks: state.tasks };
      else if (args[3] === "spawn") {
        state.running = true;
        const path = args[4];
        if (path === undefined) throw new Error("Missing task path");
        state.tasks.push({ id: 42, path, state: "ready" });
      }
      return {
        code: state.code,
        stdout: JSON.stringify(state.response ?? data),
        stderr: "fixture error",
        killed: false,
      };
    },
  };
  const script = (await discoverScripts(executor, root))[0];
  if (script === undefined) throw new Error("Missing package fixture");
  const path = taskPath(script, scriptCommand(script, []));
  calls.length = 0;
  return { root, state, calls, executor, path };
}

test("browses both public catalogs without starting an absent runner", async () => {
  const h = await harness();
  await writeFile(join(h.root, "Justfile"), "build target:\n  echo ignored\n");
  const result = await projectTasks(h.root, { action: "list" }, h.executor);
  expect(result.entries?.map((entry) => entry.name)).toEqual([
    "just:build",
    "package:dev",
    "package:test",
  ]);
  expect(result.entries?.[0]?.requiredParameters).toEqual(["target"]);
  expect(result.entries?.every((entry) => entry.task === undefined)).toBe(true);
  expect(h.calls.map((call) => call.command)).toEqual(["just", "dekit"]);
  expect(h.calls[1]?.args.slice(3)).toEqual(["runner", "status"]);
});

test("agent start, picker running state, and human restart use one task identity", async () => {
  const h = await harness();
  let registered: ToolDefinition | undefined;
  dekitExtension({
    ...h.executor,
    on() {},
    registerTool(tool: ToolDefinition) {
      registered = tool;
    },
  } as unknown as ExtensionAPI);
  if (registered === undefined) throw new Error("Missing registered tool");
  const context = withToolExecution({
    cwd: h.root,
    hasUI: false,
    isProjectTrusted: () => true,
  } as unknown as ExtensionContext);
  const started = await registered.execute(
    "start",
    { action: "start", script: "package:dev" },
    undefined,
    undefined,
    context,
  );
  expect(started.details).toMatchObject({ task: h.path, accepted: true });
  const listed = await projectTasks(h.root, { action: "list" }, h.executor);
  const dev = listed.entries?.find((entry) => entry.script === "package:dev");
  expect(dev?.task).toEqual({ id: 42, path: h.path, state: "ready" });
  const restarted = await projectTasks(
    h.root,
    { action: "restart", task: h.path, id: 42 },
    h.executor,
  );
  expect(restarted.task).toBe(h.path);
  expect(h.calls.at(-1)?.args).toEqual(["-C", h.root, "--json", "restart", "--", h.path]);
  expect(h.calls.filter((call) => call.args[3] === "spawn")).toHaveLength(1);
});

test("includes manually configured tasks and argument-specific Pi tasks", async () => {
  const h = await harness();
  h.state.running = true;
  const manual: ProjectTask = { id: 8, path: "services/web", label: "Web server", state: "ready" };
  const variant: ProjectTask = {
    id: 9,
    path: `pi/package/${"b".repeat(24)}`,
    state: "exited",
    exit_code: 7,
  };
  h.state.tasks = [manual, variant];
  const listed = await projectTasks(h.root, { action: "list" }, h.executor);
  expect(listed.entries?.slice(-2)).toEqual([
    { name: "Web server", task: manual },
    { name: variant.path, task: variant },
  ]);
});

test("preserves literal argument boundaries and npm's separator", async () => {
  const h = await harness();
  const result = await projectTasks(
    h.root,
    {
      action: "start",
      script: "package:dev",
      input: '"a b" "$(touch /tmp/no)"',
    },
    h.executor,
  );
  const task = result.task;
  if (task === undefined) throw new Error("Missing started task");
  expect(h.calls.at(-1)?.args).toEqual([
    "-C",
    h.root,
    "--json",
    "spawn",
    task,
    "--cwd",
    h.root,
    "--",
    "npm",
    "run",
    "dev",
    "--",
    "a b",
    "$(touch /tmp/no)",
  ]);
});

test("does not duplicate or restart an already running task after a stale picker selection", async () => {
  const h = await harness();
  h.state.running = true;
  h.state.tasks = [{ id: 42, path: h.path, state: "ready" }];
  expect(
    (await projectTasks(h.root, { action: "start", script: "package:dev", input: "" }, h.executor))
      .task,
  ).toBe(h.path);
  expect(h.calls.map((call) => call.args[3])).toEqual(["runner", "ls"]);
  h.state.tasks[0] = { id: 42, path: h.path, state: "exited", exit_code: 0 };
  await projectTasks(h.root, { action: "start", script: "package:dev", input: "" }, h.executor);
  expect(h.calls.at(-1)?.args.slice(3)).toEqual(["restart", "--", h.path]);
});

test.each(["view", "restart", "stop"] as const)(
  "revalidates the selected task before %s",
  async (action) => {
    const h = await harness();
    h.state.running = true;
    h.state.tasks = [{ id: 43, path: h.path, state: "ready" }];
    await expect(
      projectTasks(h.root, { action, task: h.path, id: 42 }, h.executor),
    ).rejects.toThrow("Task changed");
    h.state.tasks[0] = { id: 42, path: h.path, state: "ready" };
    await projectTasks(h.root, { action, task: h.path, id: 42 }, h.executor);
    expect(h.calls.at(-1)?.args.slice(3)).toEqual(
      action === "view" ? ["ls"] : [action, "--", h.path],
    );
  },
);

test.each(["**", "+tag", "../web", "host::web", "-a", "a/../b"])(
  "rejects non-exact task target %s",
  async (task) => {
    const h = await harness();
    await expect(
      projectTasks(h.root, { action: "restart", task, id: 1 }, h.executor),
    ).rejects.toThrow("exact project task");
    expect(h.calls).toEqual([]);
  },
);

test("canonicalizes symlink roots to the same runner Pi uses", async () => {
  const h = await harness();
  const link = h.root + "-link";
  await symlink(h.root, link);
  directories.push(link);
  expect((await projectTasks(link, { action: "list" }, h.executor)).project).toBe(h.root);
  expect(h.calls[0]?.args.slice(0, 3)).toEqual(["-C", h.root, "--json"]);
});

test("fails on removed scripts, malformed arguments, runner errors and invalid acknowledgements", async () => {
  const h = await harness();
  await expect(
    projectTasks(h.root, { action: "start", script: "package:missing", input: "" }, h.executor),
  ).rejects.toThrow("does not exist");
  await expect(
    projectTasks(
      h.root,
      { action: "start", script: "package:dev", input: "'unclosed" },
      h.executor,
    ),
  ).rejects.toThrow("unterminated");
  await expect(
    projectTasks(h.root, { action: "start", script: "package:dev", input: "\0" }, h.executor),
  ).rejects.toThrow("NUL");
  h.state.response = { status: "running", kind: "project", root: "/" };
  await expect(projectTasks(h.root, { action: "list" }, h.executor)).rejects.toThrow("not running");
  h.state.response = undefined;
  h.state.code = 1;
  await expect(projectTasks(h.root, { action: "list" }, h.executor)).rejects.toThrow(
    "fixture error",
  );
  h.state.code = 0;
  h.state.running = true;
  h.state.response = { tasks: [{ path: "wrong" }] };
  await expect(projectTasks(h.root, { action: "list" }, h.executor)).rejects.toThrow();
});
