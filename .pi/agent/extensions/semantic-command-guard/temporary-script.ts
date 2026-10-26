import { dirname } from "node:path";
import { commandFileAccesses } from "./file-access";

const TEMPORARY_PATH = "/__guard_temporary_directory__";
const OPERATIONS = new Set(["rm", "rmdir", "unlink", "chmod", "truncate", "touch", "shred"]);

function plainPath(path: string): boolean {
  return path
    .split("/")
    .slice(1)
    .every((part) => part !== "." && part !== "..");
}

function temporaryOperand(token: string, variable: string): string | undefined {
  // Quoting avoids dependence on inherited IFS and shell field splitting.
  if (!token.startsWith('"') || !token.endsWith('"')) return undefined;
  const value = token.slice(1, -1);
  const reference = [`$${variable}`, `\${${variable}}`].find(
    (candidate) => value === candidate || value.startsWith(`${candidate}/`),
  );
  if (!reference) return undefined;
  const suffix = value.slice(reference.length);
  if (suffix && (!/^(?:\/[A-Za-z0-9_.-]+)+$/.test(suffix) || !plainPath(suffix))) return undefined;
  return `${TEMPORARY_PATH}${suffix}`;
}

// shortcut: recognize a closed grammar, not arbitrary shell syntax. Unknown commands,
// variable mutations, and symlink-producing operations must remain under review.
export function temporaryScriptParent(command: string): string | undefined {
  if ([...command].some((char) => char.charCodeAt(0) < 32 && char !== "\n" && char !== "\t"))
    return undefined;
  // Every subsequent operation must depend on successful creation. A semicolon
  // after "&& chmod" would release later operations even when mktemp failed.
  const steps = command
    .trim()
    .split("&&")
    .map((step) => step.trim());
  const creation = steps
    .shift()
    ?.match(/^([a-z][a-z0-9_]*|T)=\$\(mktemp[ \t]+-d[ \t]+((?:\/[A-Za-z0-9_.-]+)+)\)$/);
  if (!creation || steps.length === 0) return undefined;
  const [, variable, template] = creation;
  if (!variable || !template || !plainPath(template) || !/X{3,}$/.test(template)) return undefined;
  for (const step of steps) {
    const words = step.split(/[ \t]+/);
    if (!OPERATIONS.has(words[0] ?? "")) return undefined;
    const resolved: string[] = [];
    for (const word of words) {
      const operand = temporaryOperand(word, variable);
      if (operand) resolved.push(operand);
      else if (/^[A-Za-z0-9_:.-]+$/.test(word)) resolved.push(word);
      else return undefined;
    }
    // Giving another user write access would invalidate the private-directory model.
    if (words[0] === "chmod" && !resolved.some((word) => /^0?[0-7]00$/.test(word)))
      return undefined;
    const accesses = commandFileAccesses(resolved.join(" "));
    if (
      !accesses?.length ||
      accesses.some(
        ({ path, access }) =>
          access !== "write" || (path !== TEMPORARY_PATH && !path.startsWith(`${TEMPORARY_PATH}/`)),
      )
    )
      return undefined;
  }
  // Check the whole parent, not a fabricated random name. This conservatively
  // rejects denied descendants and exact-file grants before the directory exists.
  return dirname(template);
}
