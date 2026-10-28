import { basename } from "node:path";

interface FileAccess {
  path: string;
  access: "read" | "write";
  destinationNames?: string[];
}

// shortcut: only literal, standalone commands are resolved. Use a shell AST before
// expanding this exemption to compound commands, expansions, redirects, or inline code.
function literalWords(command: string): string[] | undefined {
  if (/[\r\n]/.test(command)) return undefined;
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  const flush = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (quote) {
      if (char === quote) quote = undefined;
      else if (quote === '"' && /[$`\\]/.test(char)) return undefined;
      else word += char;
      continue;
    }
    if (char === "\\") {
      const escaped = command[++index];
      if (escaped === undefined) return undefined;
      word += escaped;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      flush();
    } else {
      if (
        "|&;<>()$`{}*?[]".includes(char) ||
        ((char === "#" || char === "~") && !started) ||
        char.charCodeAt(0) < 32
      )
        return undefined;
      word += char;
      started = true;
    }
  }
  if (quote) return undefined;
  flush();
  return words;
}

const OPTIONS: Record<string, RegExp> = {
  rm: /^-[dfiIrRv]+$|^--(?:dir|force|interactive|no-preserve-root|one-file-system|preserve-root|recursive|verbose)$/,
  rmdir: /^-v+$/,
  unlink: /^$/,
  mv: /^-[finvT]+$/,
  cp: /^-[finvT]+$/,
  chmod: /^-[Rfv]+$/,
  chown: /^-[Rfhv]+$/,
  truncate: /^-c+$/,
  touch: /^-[acm]+$/,
  tee: /^-[ai]+$/,
  shred: /^-[fuzv]+$/,
};

export function commandFileAccesses(command: string): FileAccess[] | undefined {
  const words = literalWords(command);
  const operation = words?.[0];
  if (!operation || !Object.hasOwn(OPTIONS, operation)) return undefined;
  const allowed = OPTIONS[operation];
  const operands: string[] = [];
  let options = true;
  let size = false;
  for (let index = 1; index < words.length; index += 1) {
    const arg = words[index];
    if (!arg) return undefined;
    if (options && arg === "--") {
      options = false;
      continue;
    }
    if (options && operation === "truncate" && (arg === "-s" || arg === "--size")) {
      const value = words[++index];
      if (!value || !/^[0-9]+[KMGTP]?$/.test(value)) return undefined;
      size = true;
      continue;
    }
    if (options && arg.startsWith("-")) {
      if (!allowed?.test(arg)) return undefined;
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
  if ((operation === "mv" || operation === "cp") && operands.length < 2) return undefined;
  if (operands.length === 0) return undefined;
  return operands.map((path, index) => ({
    path,
    access: operation === "cp" && index < operands.length - 1 ? "read" : "write",
    ...((operation === "cp" || operation === "mv") && index === operands.length - 1
      ? { destinationNames: operands.slice(0, -1).map((source) => basename(source)) }
      : {}),
  }));
}
