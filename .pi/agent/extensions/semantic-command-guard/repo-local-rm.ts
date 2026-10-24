import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function repositoryRoot(cwd: string): { cwd: string; root: string } | undefined {
  let canonicalCwd: string;
  try {
    canonicalCwd = realpathSync(cwd);
  } catch {
    return undefined;
  }

  let current = canonicalCwd;
  while (true) {
    try {
      lstatSync(join(current, ".git"));
      return { cwd: canonicalCwd, root: current };
    } catch (error) {
      if (!isMissingPath(error)) return undefined;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function isWithin(root: string, candidate: string, allowRoot: boolean): boolean {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "") return allowRoot;
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot);
}

// Reject expansion and compound shell syntax rather than guessing at final targets.
function parseSimpleRm(command: string): string[] | undefined {
  if (/[\r\n]/.test(command)) return undefined;

  const words: string[] = [];
  const operators = new Set(["|", "&", ";", "<", ">", "(", ")", "$", "`", "{", "}"]);
  let word = "";
  let started = false;
  let quote: "single" | "double" | undefined;

  const flush = () => {
    if (!started) return;
    words.push(word);
    word = "";
    started = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";
    if (quote === "single") {
      if (character === "'") quote = undefined;
      else word += character;
      continue;
    }
    if (quote === "double") {
      if (character === '"') quote = undefined;
      else if (character === "$" || character === "`" || character === "\\") return undefined;
      else word += character;
      continue;
    }

    if (character === "\\") {
      const escaped = command[index + 1];
      if (escaped === undefined || escaped === "\n" || escaped === "\r") return undefined;
      word += escaped;
      started = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character === "'" ? "single" : "double";
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if (
      operators.has(character) ||
      (character === "#" && !started) ||
      (character === "~" && !started) ||
      "*?[]".includes(character) ||
      (character.charCodeAt(0) < 32 && character !== "\t")
    ) {
      return undefined;
    }
    word += character;
    started = true;
  }

  if (quote !== undefined) return undefined;
  flush();
  if (words[0] !== "rm") return undefined;

  const targets: string[] = [];
  let options = true;
  const shortOptions = new Set(["d", "f", "i", "I", "r", "R", "v"]);
  const longOptions = new Set([
    "--dir",
    "--force",
    "--interactive",
    "--no-preserve-root",
    "--one-file-system",
    "--preserve-root",
    "--recursive",
    "--verbose",
  ]);

  for (const argument of words.slice(1)) {
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("--")) {
      if (!longOptions.has(argument)) return undefined;
      continue;
    }
    if (options && argument.startsWith("-") && argument !== "-") {
      if (!/^-[A-Za-z]+$/.test(argument)) return undefined;
      if ([...argument.slice(1)].some((option) => !shortOptions.has(option))) return undefined;
      continue;
    }
    if (argument.length === 0) return undefined;
    targets.push(argument);
  }

  return targets.length > 0 ? targets : undefined;
}

function targetIsInside(root: string, cwd: string, target: string): boolean {
  const normalizedTarget = resolve(cwd, target);
  if (!isWithin(root, normalizedTarget, false)) return false;

  const absoluteTarget = isAbsolute(target) ? target : `${cwd}${sep}${target}`;
  const pathRoot = parse(absoluteTarget).root;
  let candidate = pathRoot;
  // Resolve each component before applying `..`: Bun normalizes raw paths even with native realpath.
  for (const component of absoluteTarget.slice(pathRoot.length).split(sep)) {
    if (component === "" || component === ".") continue;
    if (component === "..") {
      candidate = dirname(candidate);
      continue;
    }
    const next = join(candidate, component);
    try {
      candidate = realpathSync.native(next);
    } catch (error) {
      if (!isMissingPath(error)) return false;
      candidate = next;
    }
  }
  return isWithin(root, candidate, false);
}

export function isRepoLocalRm(command: string, cwd: string): boolean {
  const targets = parseSimpleRm(command);
  if (targets === undefined) return false;

  const repository = repositoryRoot(cwd);
  if (repository === undefined) return false;
  return targets.every((target) => targetIsInside(repository.root, repository.cwd, target));
}
