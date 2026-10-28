export interface ShellWord {
  value: string;
  start: number;
  end: number;
}
export interface ShellCommand {
  words: ShellWord[];
  redirects: { operator: ">" | ">>" | "<"; target: ShellWord }[];
}
export type ShellParse = { kind: "parsed"; commands: ShellCommand[] } | { kind: "unknown" };

// shortcut: this is a literal shell subset, not a shell AST. Unsupported syntax must
// require local approval, never become an empty/safe parse. Upgrade to an audited
// parser before supporting expansions, heredocs, groups, or shell control flow.
export function parseShell(command: string): ShellParse {
  if (command.length > 16_000) return { kind: "unknown" };
  const commands: ShellCommand[] = [];
  let current: ShellCommand = { words: [], redirects: [] };
  let value = "";
  let start = -1;
  let quote: "'" | '"' | undefined;
  let redirect: ">" | ">>" | "<" | undefined;
  const flush = (end: number): boolean => {
    if (start < 0) return true;
    const word = { value, start, end };
    if (redirect) {
      current.redirects.push({ operator: redirect, target: word });
      redirect = undefined;
    } else current.words.push(word);
    value = "";
    start = -1;
    return true;
  };
  const finish = (end: number): boolean => {
    flush(end);
    if (redirect) return false;
    if (current.words.length || current.redirects.length) commands.push(current);
    current = { words: [], redirects: [] };
    return true;
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i] ?? "";
    if (quote) {
      if (char === quote) quote = undefined;
      else if (quote === '"' && "$`".includes(char)) return { kind: "unknown" };
      else if (quote === '"' && char === "\\") {
        const next = command[++i];
        if (next === undefined) return { kind: "unknown" };
        if (next !== "\n") value += '"$`\\'.includes(next) ? next : `\\${next}`;
      } else value += char;
      continue;
    }
    if (char === "\\") {
      const next = command[++i];
      if (next === undefined) return { kind: "unknown" };
      if (next !== "\n") {
        if (start < 0) start = i - 1;
        value += next;
      }
    } else if (char === "'" || char === '"') {
      if (start < 0) start = i;
      quote = char;
    } else if (char === "#" && start < 0) {
      const newline = command.indexOf("\n", i);
      i = newline < 0 ? command.length : newline - 1;
    } else if (char === "\n" || char === ";" || char === "|" || char === "&") {
      if (!finish(i)) return { kind: "unknown" };
      if (char === "&" && command[i + 1] !== "&") return { kind: "unknown" };
      if ((char === "|" || char === "&") && command[i + 1] === char) i++;
    } else if (char === ">" || char === "<") {
      // File-descriptor duplication and heredocs need semantics this subset lacks.
      if ((start >= 0 && /^\d+$/.test(value)) || redirect) return { kind: "unknown" };
      flush(i);
      if (command[i + 1] === char) {
        if (char === "<") return { kind: "unknown" };
        redirect = ">>";
        i++;
      } else redirect = char;
      if ("&|()".includes(command[i + 1] ?? "\0")) return { kind: "unknown" };
    } else if (/\s/.test(char)) {
      if (char === "\r") return { kind: "unknown" };
      flush(i);
    } else {
      if ("()$`{}*?[]".includes(char) || char.charCodeAt(0) < 32) return { kind: "unknown" };
      if (start < 0) start = i;
      value += char;
    }
  }
  if (quote || !finish(command.length)) return { kind: "unknown" };
  return { kind: "parsed", commands };
}

export function executableWords(words: readonly ShellWord[]): readonly ShellWord[] | undefined {
  let index = 0;
  // Assignments can change PATH, shell startup, or interpreter behavior.
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]?.value ?? "")) return undefined;
  while (["command", "builtin"].includes(words[index]?.value ?? "")) {
    index++;
    if (words[index]?.value === "--") index++;
    if (words[index]?.value.startsWith("-")) return undefined;
  }
  return words.slice(index);
}
