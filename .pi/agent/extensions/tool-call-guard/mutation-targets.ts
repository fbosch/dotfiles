import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseShell, type ShellWord } from "./shell";

/**
 * A path a Bash command may create, overwrite, delete, move, or re-permission.
 * `cwds` lists every directory a relative path may resolve against; `undefined`
 * means the directory is unknown (for example after `cd -`).
 * `intoDirectory` holds source basenames when the target may be a destination
 * directory, as in `cp a b dir/`.
 */
export interface MutationTarget {
  path: string;
  cwds: readonly (string | undefined)[];
  intoDirectory?: readonly string[];
}

// Every operand may be mutated. Option values also count: including a harmless
// value such as `truncate -s 0` costs nothing, while omitting a target would miss it.
const ALL_OPERANDS = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "truncate",
  "touch",
  "tee",
  "mkdir",
  "chmod",
  "chown",
  "chgrp",
]);
// Sources stay intact; only the destination is written.
const DESTINATION_ONLY = new Set(["cp", "ln", "install"]);
// Wrappers that run the following words as a command.
const WRAPPERS = new Set(["command", "builtin", "exec", "nohup", "sudo", "doas", "env", "nice"]);
const WRAPPER_VALUE_OPTIONS: Record<string, ReadonlySet<string>> = {
  sudo: new Set(["-u", "-g", "-C", "-D", "-h", "-p", "-U"]),
  doas: new Set(["-u", "-C"]),
  env: new Set(["-u", "-C", "-S"]),
  nice: new Set(["-n"]),
};

const expandHome = (path: string) =>
  path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

function commandWords(words: readonly ShellWord[]): string[] {
  const values = words.map((word) => word.value);
  let index = 0;
  for (;;) {
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(values[index] ?? "")) index++;
    const name = basename(values[index] ?? "");
    if (!WRAPPERS.has(name)) break;
    index++;
    const valueOptions = WRAPPER_VALUE_OPTIONS[name];
    while ((values[index] ?? "").startsWith("-")) {
      const option = values[index++] ?? "";
      if (option === "--") break;
      if (valueOptions?.has(option)) index++;
    }
  }
  return values.slice(index);
}

function nonOptionWords(args: readonly string[]): string[] {
  const words: string[] = [];
  let options = true;
  for (const arg of args) {
    if (options && arg === "--") {
      options = false;
      continue;
    }
    if (options && arg.startsWith("-") && arg !== "-") {
      const value = arg.match(/^--[^=]+=(.+)$/)?.[1];
      if (value) words.push(value);
      continue;
    }
    words.push(arg);
  }
  return words;
}

function targetDirectory(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--") return undefined;
    if (arg === "-t" || arg === "--target-directory") return args[index + 1];
    if (arg.startsWith("--target-directory=")) return arg.slice("--target-directory=".length);
    if (/^-[a-zA-Z]*t.+/.test(arg)) return arg.slice(arg.indexOf("t") + 1);
  }
  return undefined;
}

function destinationTargets(
  name: string,
  args: readonly string[],
): {
  path: string;
  intoDirectory?: string[];
}[] {
  if (name === "install" && args.some((arg) => arg === "-d" || arg === "--directory"))
    return nonOptionWords(args).map((path) => ({ path }));
  const directory = targetDirectory(args);
  const words = nonOptionWords(args).filter((word) => word !== directory);
  if (directory) return [{ path: directory, intoDirectory: words.map((word) => basename(word)) }];
  const destination = words.at(-1);
  if (!destination) return [];
  const sources = words.slice(0, -1);
  const noTargetDirectory = args.some((arg) => arg === "-T" || arg === "--no-target-directory");
  return [
    {
      path: destination,
      ...(noTargetDirectory ? {} : { intoDirectory: sources.map((source) => basename(source)) }),
    },
  ];
}

function operationTargets(words: readonly string[]): { path: string; intoDirectory?: string[] }[] {
  const name = basename(words[0] ?? "");
  const args = words.slice(1);
  if (ALL_OPERANDS.has(name)) return nonOptionWords(args).map((path) => ({ path }));
  if (name === "mv") {
    const [destination] = destinationTargets(name, args);
    const directory = targetDirectory(args);
    const sources = nonOptionWords(args).filter(
      (word) => word !== directory && word !== (directory ? undefined : destination?.path),
    );
    return [...sources.map((path) => ({ path })), ...(destination ? [destination] : [])];
  }
  if (DESTINATION_ONLY.has(name)) return destinationTargets(name, args);
  if (name === "dd")
    return args.filter((arg) => arg.startsWith("of=")).map((arg) => ({ path: arg.slice(3) }));
  if (name === "sed" && args.some((arg) => /^-[a-zA-Z]*i|^--in-place/.test(arg)))
    return nonOptionWords(args).map((path) => ({ path }));
  return [];
}

/**
 * Returns the paths a literal Bash command may mutate, or `undefined` when the
 * command uses syntax the literal parser cannot resolve. Commands without known
 * mutation semantics, including Git, yield no targets.
 */
export function bashMutationTargets(command: string, cwd: string): MutationTarget[] | undefined {
  const parsed = parseShell(command);
  if (parsed.kind === "unknown") return undefined;
  // The parser flattens `&&`, `;`, and `|`, so a `cd` may or may not apply to later
  // commands. Keep every candidate directory and treat a target as protected if any
  // candidate resolves to a protected path.
  let cwds: (string | undefined)[] = [cwd];
  const targets: MutationTarget[] = [];
  for (const part of parsed.commands) {
    const words = commandWords(part.words);
    for (const redirect of part.redirects) {
      if (redirect.operator !== "<") targets.push({ path: redirect.target.value, cwds });
    }
    const name = basename(words[0] ?? "");
    if (name === "cd") {
      const destination = words
        .slice(1)
        .filter((word) => word !== "--" && word !== "-P" && word !== "-L");
      const next =
        destination.length === 0
          ? homedir()
          : destination.length === 1 && destination[0] !== "-"
            ? expandHome(destination[0] ?? "")
            : undefined;
      const resolved = cwds.map((base) =>
        next === undefined ? undefined : isAbsolute(next) ? next : base && resolve(base, next),
      );
      cwds = [...new Set([...cwds, ...resolved])];
      continue;
    }
    if (name === "pushd" || name === "popd") {
      cwds = [...new Set([...cwds, undefined])];
      continue;
    }
    for (const target of operationTargets(words)) targets.push({ ...target, cwds });
  }
  return targets;
}
