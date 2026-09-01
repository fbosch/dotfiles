import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, resolve } from "node:path";
import type { FormatterExecutionResult } from "./command-runner";
import type { FormatterCommand, FormatterRule, ResolvedFormatterSettings } from "./settings";

export type FormatterExecutor = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly signal?: AbortSignal; readonly timeoutMs: number },
) => Promise<FormatterExecutionResult>;

export type CommandAvailability = (command: string, cwd: string) => Promise<boolean>;

interface FormatFileOptions {
  readonly commandAvailable?: CommandAvailability;
  readonly cwd: string;
  readonly execute: FormatterExecutor;
  readonly filePath: string;
  readonly settings: ResolvedFormatterSettings;
  readonly signal?: AbortSignal;
}

interface ResolvedCommand {
  readonly command: FormatterCommand;
  readonly cwd: string;
}

interface CommandOutcome {
  readonly startupFailed: boolean;
  readonly warning?: string;
}

function matchesRule(rule: FormatterRule, filePath: string): boolean {
  return rule.extensions.includes(extname(filePath)) || rule.fileNames.includes(basename(filePath));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findFormatterRoot(
  filePath: string,
  command: FormatterCommand,
  fallbackCwd: string,
): Promise<string | undefined> {
  if (command.rootMarkers.length === 0) {
    return command.requireRootMarker ? undefined : resolve(fallbackCwd);
  }

  let directory = dirname(filePath);
  for (;;) {
    for (const marker of command.rootMarkers) {
      if (await pathExists(resolve(directory, marker))) return directory;
    }

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return command.requireRootMarker ? undefined : resolve(fallbackCwd);
}

export async function commandAvailable(command: string, cwd: string): Promise<boolean> {
  if (isAbsolute(command) || command.includes("/")) {
    try {
      const candidate = resolve(cwd, command);
      await access(candidate, constants.X_OK);
      return (await stat(candidate)).isFile();
    } catch {
      return false;
    }
  }

  const path = process.env.PATH;
  if (path === undefined) return false;
  for (const directory of path.split(delimiter)) {
    try {
      const candidate = resolve(cwd, directory, command);
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return true;
    } catch {
      // Continue through PATH entries.
    }
  }
  return false;
}

async function resolveCommands(
  rule: FormatterRule,
  filePath: string,
  fallbackCwd: string,
): Promise<readonly ResolvedCommand[]> {
  const commands: ResolvedCommand[] = [];
  for (const command of rule.commands) {
    const cwd = await findFormatterRoot(filePath, command, fallbackCwd);
    if (cwd !== undefined) commands.push({ command, cwd });
  }
  return commands;
}

function failureMessage(
  rule: FormatterRule,
  command: FormatterCommand,
  filePath: string,
  result: FormatterExecutionResult,
): string | undefined {
  if (result.kind === "success") return undefined;
  if (result.kind === "spawn_error") {
    return `Formatter ${rule.id}: unable to start ${command.command} for ${filePath}: ${result.message}`;
  }
  if (result.kind === "timeout") {
    return `Formatter ${rule.id}: ${command.command} timed out after ${result.timeoutMs}ms for ${filePath}${result.stderr === "" ? "" : `: ${result.stderr}`}`;
  }
  if (result.kind === "cancelled") {
    return `Formatter ${rule.id}: ${command.command} cancelled for ${filePath}${result.stderr === "" ? "" : `: ${result.stderr}`}`;
  }
  const status =
    result.exitCode === null
      ? `signal ${result.signal ?? "unknown"}`
      : `exit code ${result.exitCode}`;
  return `Formatter ${rule.id}: ${command.command} failed for ${filePath} (${status})${result.stderr === "" ? "" : `: ${result.stderr}`}`;
}

async function runCommand(
  rule: FormatterRule,
  resolvedCommand: ResolvedCommand,
  filePath: string,
  options: FormatFileOptions,
): Promise<CommandOutcome> {
  const args = resolvedCommand.command.args.map((argument) =>
    argument.replaceAll("$FILE", filePath),
  );
  try {
    const result = await options.execute(resolvedCommand.command.command, args, {
      cwd: resolvedCommand.cwd,
      timeoutMs: options.settings.timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const warning = failureMessage(rule, resolvedCommand.command, filePath, result);
    return {
      startupFailed: result.kind === "spawn_error",
      ...(warning === undefined ? {} : { warning }),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      startupFailed: true,
      warning: `Formatter ${rule.id}: unable to start ${resolvedCommand.command.command} for ${filePath}: ${message}`,
    };
  }
}

async function formatWithRule(
  rule: FormatterRule,
  filePath: string,
  options: FormatFileOptions,
): Promise<readonly string[]> {
  const resolvedCommands = await resolveCommands(rule, filePath, options.cwd);
  if (resolvedCommands.length === 0) return [];
  const isAvailable = options.commandAvailable ?? commandAvailable;

  if (rule.mode === "first_available") {
    const startupWarnings: string[] = [];
    for (const resolvedCommand of resolvedCommands) {
      if ((await isAvailable(resolvedCommand.command.command, resolvedCommand.cwd)) === false) {
        continue;
      }
      const outcome = await runCommand(rule, resolvedCommand, filePath, options);
      if (outcome.startupFailed) {
        if (outcome.warning !== undefined) startupWarnings.push(outcome.warning);
        continue;
      }
      return outcome.warning === undefined ? [] : [outcome.warning];
    }
    if (startupWarnings.length > 0) return startupWarnings;
    return [
      `Formatter ${rule.id}: no configured command is available (${resolvedCommands.map(({ command }) => command.command).join(", ")})`,
    ];
  }

  const warnings: string[] = [];
  for (const resolvedCommand of resolvedCommands) {
    if ((await isAvailable(resolvedCommand.command.command, resolvedCommand.cwd)) === false) {
      warnings.push(
        `Formatter ${rule.id}: command is not available: ${resolvedCommand.command.command}`,
      );
      continue;
    }
    const outcome = await runCommand(rule, resolvedCommand, filePath, options);
    if (outcome.warning !== undefined) warnings.push(outcome.warning);
  }
  return warnings;
}

export async function formatFile(options: FormatFileOptions): Promise<readonly string[]> {
  const filePath = resolve(options.cwd, options.filePath);
  try {
    if ((await stat(filePath)).isFile() === false) return [];
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "ENOENT" || cause.code === "ENOTDIR")
    ) {
      return [];
    }
    return [
      `Formatter: unable to inspect ${filePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
    ];
  }

  const warnings: string[] = [];
  for (const rule of options.settings.rules) {
    if (matchesRule(rule, filePath) === false) continue;
    warnings.push(...(await formatWithRule(rule, filePath, options)));
  }
  return warnings;
}
