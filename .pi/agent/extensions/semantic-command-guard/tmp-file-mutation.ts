import { realpathSync } from "node:fs";
import { parseLiteralWords, parseSimpleRm, targetIsInside } from "./repo-local-rm";

function mutationTargets(command: string): string[] | undefined {
  const words = parseLiteralWords(command);
  if (!words?.length) return undefined;
  const [operation, ...args] = words;
  if (operation === "rm") return parseSimpleRm(command);

  const flags: Record<string, RegExp> = {
    rmdir: /^-v+$/,
    unlink: /^$/,
    mv: /^-[finvT]+$/,
    chmod: /^-[Rfv]+$/,
    chown: /^-[Rfhv]+$/,
    truncate: /^-[c]+$/,
    touch: /^-[acm]+$/,
    tee: /^-[ai]+$/,
    shred: /^-[fuzv]+$/,
  };
  const allowed = operation && Object.hasOwn(flags, operation) ? flags[operation] : undefined;
  if (!allowed) return undefined;
  const operands: string[] = [];
  let options = true;
  let size = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) return undefined;
    if (options && arg === "--") {
      options = false;
      continue;
    }
    if (options && operation === "truncate" && (arg === "-s" || arg === "--size")) {
      const value = args[++index];
      if (!value || !/^[0-9]+[KMGTP]?$/.test(value)) return undefined;
      size = true;
      continue;
    }
    if (options && arg.startsWith("-")) {
      if (!allowed.test(arg)) return undefined;
      continue;
    }
    operands.push(arg);
  }
  if (operation === "truncate" && !size) return undefined;
  if (operation === "chmod" || operation === "chown") {
    const value = operands.shift();
    if (
      !value ||
      (operation === "chmod"
        ? !/^[0-7]{3,4}$/.test(value)
        : !/^[a-zA-Z0-9_]+(?::[a-zA-Z0-9_]+)?$/.test(value))
    )
      return undefined;
  }
  if (operation === "mv" && operands.length < 2) return undefined;
  return operands.length > 0 ? operands : undefined;
}

export function isTmpFileMutation(command: string, cwd: string): boolean {
  const targets = mutationTargets(command);
  if (!targets) return false;
  try {
    // Resolve /tmp itself for platforms where it is a symlink; never exempt its root.
    const root = realpathSync("/tmp");
    const canonicalCwd = realpathSync(cwd);
    return targets.every((target) => targetIsInside(root, canonicalCwd, target));
  } catch {
    return false;
  }
}
