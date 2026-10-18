import { realpath } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isMatching, P } from "ts-pattern";
import { parseJustCommandArguments } from "../just";
import {
  discoverScripts,
  inspectScript,
  scriptCommand,
  scriptSearchDescription,
  taskPath,
} from "./catalog";

const TaskPattern = {
  id: P.number,
  path: P.string,
  state: P.string,
  label: P.optional(P.string),
  exit_code: P.optional(P.number),
};
export type ProjectTask = {
  id: number;
  path: string;
  state: string;
  label?: string;
  exit_code?: number;
};
export type PickerEntry = {
  name: string;
  description?: string;
  script?: string;
  requiredParameters?: string[];
  task?: ProjectTask;
};
type Request =
  | { action: "list" }
  | { action: "start"; script: string; input: string }
  | { action: "view" | "restart" | "stop"; task: string; id: number };
type Result = { project: string; entries?: PickerEntry[]; task?: string };
type Executor = Pick<ExtensionAPI, "exec">;

const nativeExecutor: Executor = {
  async exec(command, args, options) {
    const child = Bun.spawn([command, ...args], {
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      stdout: "pipe",
      stderr: "pipe",
      timeout: options?.timeout ?? 10_000,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code, killed: child.killed };
  },
};

export async function projectTasks(
  cwd: string,
  request: Request,
  executor: Executor = nativeExecutor,
): Promise<Result> {
  const project = await realpath(cwd);
  async function cli(args: string[]): Promise<unknown> {
    const result = await executor.exec("dekit", ["-C", project, "--json", ...args], {
      cwd: project,
      timeout: 10_000,
    });
    if (result.killed || result.code !== 0)
      throw new Error(`dekit ${args[0]} failed: ${result.stderr.slice(0, 2000)}`);
    return JSON.parse(result.stdout);
  }
  async function tasks(): Promise<ProjectTask[]> {
    const status = await cli(["runner", "status"]);
    if (isMatching({ status: "absent" }, status)) return [];
    if (!isMatching({ status: "running", root: project, kind: "project" }, status))
      throw new Error("Project runner is not running");
    const result = await cli(["ls"]);
    if (!isMatching({ tasks: P.array(TaskPattern) }, result))
      throw new Error("Invalid project task list");
    return result.tasks.map((task) => ({
      id: task.id,
      path: task.path,
      state: task.state,
      ...(task.label === undefined ? {} : { label: task.label }),
      ...(task.exit_code === undefined ? {} : { exit_code: task.exit_code }),
    }));
  }
  async function accept(args: string[]): Promise<void> {
    if (!isMatching({ matched: 1 }, await cli(args)))
      throw new Error("Expected exactly one affected task");
  }

  if (request.action === "list") {
    const catalog = await discoverScripts(executor, project);
    const running = await tasks();
    const byPath = new Map(running.map((task) => [task.path, task]));
    const entries: PickerEntry[] = catalog.map((script) => {
      const path = taskPath(script, scriptCommand(script, []));
      const task = byPath.get(path);
      byPath.delete(path);
      return {
        name: script.id,
        description: scriptSearchDescription(script),
        script: script.id,
        requiredParameters:
          inspectScript(script)
            .parameters?.filter((parameter) => parameter.required)
            .map((parameter) => parameter.name) ?? [],
        ...(task === undefined ? {} : { task }),
      };
    });
    for (const task of byPath.values()) entries.push({ name: task.label ?? task.path, task });
    return { project, entries };
  }

  if (request.action === "start") {
    const args = parseJustCommandArguments(request.input);
    if (args.some((arg) => arg.includes("\0")))
      throw new Error("Arguments cannot contain NUL bytes");
    const script = (await discoverScripts(executor, project)).find(
      (candidate) => candidate.id === request.script,
    );
    if (script === undefined) throw new Error("Script is no longer public or does not exist");
    const command = scriptCommand(script, args);
    const path = taskPath(script, command);
    const existing = (await tasks()).find((task) => task.path === path);
    // A stale picker must attach to an agent-started task, never spawn a duplicate.
    if (existing !== undefined) {
      if (existing.state === "exited" || existing.state === "stopped")
        await accept(["restart", "--", path]);
    } else {
      await accept(["spawn", path, "--cwd", project, "--", ...command]);
    }
    return { project, task: path };
  }

  const path = request.task;
  if (
    !/^[\p{L}\p{N}_][\p{L}\p{N}_.-]*(?:\/[\p{L}\p{N}_.-]+)*$/u.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Use an exact project task path");
  const task = (await tasks()).find((candidate) => candidate.path === path);
  if (task === undefined || task.id !== request.id)
    throw new Error("Task changed; refresh the picker");
  if (request.action !== "view") await accept([request.action, "--", path]);
  return { project, task: path };
}

if (import.meta.main) {
  try {
    const cwd = process.argv[2];
    if (cwd === undefined) throw new Error("A project root is required");
    const input: unknown = JSON.parse(await Bun.stdin.text());
    if (
      !isMatching(
        P.union(
          { action: "list" },
          { action: "start", script: P.string, input: P.string },
          { action: P.union("view", "restart", "stop"), task: P.string, id: P.number },
        ),
        input,
      )
    )
      throw new Error("Invalid project task request");
    console.log(JSON.stringify(await projectTasks(cwd, input)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
