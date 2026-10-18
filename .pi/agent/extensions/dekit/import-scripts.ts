import { realpath } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isMatching } from "ts-pattern";
import { discoverScripts, inspectScript, type Script, scriptCommand, taskPath } from "./catalog";

type Executor = Pick<ExtensionAPI, "exec">;
type RegistrationOptions = { arguments?: string[]; start?: boolean; signal?: AbortSignal };

export async function registerScript(
  executor: Executor,
  project: string,
  script: Script,
  options: RegistrationOptions = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const command = scriptCommand(script, options.arguments ?? []);
  const path = taskPath(script, command);
  const required =
    inspectScript(script).parameters?.filter((parameter) => parameter.required) ?? [];
  const label = (
    script.id +
    (required.length > 0 && (options.arguments?.length ?? 0) === 0
      ? ` (requires: ${required.map((parameter) => parameter.name).join(", ")})`
      : "")
  ).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ");
  const result = await executor.exec(
    "dekit",
    [
      "-C",
      project,
      "--json",
      "register",
      path,
      "--cwd",
      project,
      "--label",
      label,
      ...(options.start === true ? ["--start"] : []),
      "--",
      ...command,
    ],
    {
      cwd: project,
      timeout: 10_000,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  options.signal?.throwIfAborted();
  if (result.killed || result.code !== 0)
    throw new Error(
      `Dekit registration failed for ${script.id}: ${(result.stderr.trim() || result.stdout.trim()).slice(0, 2000)}`,
    );
  try {
    if (!isMatching({ matched: 1 }, JSON.parse(result.stdout)))
      throw new Error("Expected exactly one registered task");
  } catch (error) {
    throw new Error("Invalid dekit register response", { cause: error });
  }
  return path;
}

export async function importScripts(executor: Executor, cwd: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const project = await realpath(cwd);
  const scripts = await discoverScripts(executor, project, signal);
  const tasks: string[] = [];
  for (const script of scripts) {
    tasks.push(
      await registerScript(executor, project, script, {
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  }
  return { project, imported: tasks.length, tasks };
}

if (import.meta.main) {
  const executor: Executor = {
    async exec(command, args, options) {
      const child = Bun.spawn([command, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: options?.timeout ?? 10_000,
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      // Bun marks normally exited subprocesses as killed too.
      return { stdout, stderr, code, killed: child.signalCode !== null };
    },
  };
  try {
    const project = process.argv[2];
    if (project === undefined) throw new Error("A project root is required");
    console.log(JSON.stringify(await importScripts(executor, project)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
