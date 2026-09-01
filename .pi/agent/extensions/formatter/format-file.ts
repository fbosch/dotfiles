import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, resolve } from "node:path";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";
import type { FormatterCommand, FormatterRule, ResolvedFormatterSettings } from "./settings";

const MAX_STDERR_CHARACTERS = 4_000;

export type FormatterExecutor = (
  command: string,
  args: string[],
  options: ExecOptions,
) => Promise<ExecResult>;

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
      await access(resolve(cwd, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const path = process.env.PATH;
  if (path === undefined) return false;
  for (const directory of path.split(delimiter)) {
    try {
      await access(resolve(directory || cwd, command), constants.X_OK);
      return true;
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
  result: ExecResult,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): string | undefined {
  if (result.killed) {
    const reason = signal?.aborted ? "cancelled" : `timed out after ${timeoutMs}ms`;
    return `Formatter ${rule.id}: ${command.command} ${reason} for ${filePath}`;
  }
  if (result.code === 0) return undefined;

  const stderr = result.stderr.trim().slice(-MAX_STDERR_CHARACTERS);
  return `Formatter ${rule.id}: ${command.command} failed for ${filePath} (exit code ${result.code})${stderr === "" ? "" : `: ${stderr}`}`;
}

async function runCommand(
  rule: FormatterRule,
  resolvedCommand: ResolvedCommand,
  filePath: string,
  options: FormatFileOptions,
): Promise<string | undefined> {
  const args = resolvedCommand.command.args.map((argument) =>
    argument.replaceAll("$FILE", filePath),
  );
  try {
    const result = await options.execute(resolvedCommand.command.command, args, {
      cwd: resolvedCommand.cwd,
      timeout: options.settings.timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return failureMessage(
      rule,
      resolvedCommand.command,
      filePath,
      result,
      options.settings.timeoutMs,
      options.signal,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return `Formatter ${rule.id}: unable to start ${resolvedCommand.command.command} for ${filePath}: ${message}`;
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
    for (const resolvedCommand of resolvedCommands) {
      if ((await isAvailable(resolvedCommand.command.command, resolvedCommand.cwd)) === false) {
        continue;
      }
      const warning = await runCommand(rule, resolvedCommand, filePath, options);
      return warning === undefined ? [] : [warning];
    }
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
    const warning = await runCommand(rule, resolvedCommand, filePath, options);
    if (warning !== undefined) warnings.push(warning);
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
