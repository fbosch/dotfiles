import { isToolCallEventType, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RAW_BLOCK_DEVICE =
  /^\/dev\/(?:(?:sd|nvme|vd|xvd|mmcblk|rdisk|dm-|md|disk)[^/\s]*|mapper\/[^/\s]+|disk\/by-id\/[^/\s]+)$/;
const FORMAT_BLOCK_DEVICE =
  /^\/dev\/(?:(?:sd|nvme|vd|xvd|mmcblk|rdisk|dm-|md|disk|loop)[^/\s]*|mapper\/[^/\s]+|disk\/by-id\/[^/\s]+)$/;
const FORMATTER = /^(?:mkfs(?:[._-].*)?|mkdosfs|mke2fs|mkswap|newfs(?:[._-].*)?|wipefs)$/i;
const SHELLS = new Set(["bash", "sh", "zsh"]);
const WRAPPERS = new Set(["command", "doas", "env", "exec", "sudo"]);
const CONTROL_WORDS = new Set([
  "!",
  "{",
  "do",
  "elif",
  "else",
  "if",
  "then",
  "time",
  "until",
  "while",
]);
const MAX_INSPECTION_DEPTH = 4;
const MAX_WRAPPER_DEPTH = 12;

type WordToken = {
  kind: "word";
  text: string;
  activeGlobOffsets: readonly number[];
};

type RedirectionToken = {
  kind: "redirect";
  operator: string;
  fd?: string;
};

type Token = WordToken | RedirectionToken;

type Heredoc = {
  delimiter: string;
  stripTabs: boolean;
};

function executableName(word: string): string {
  return word.slice(word.lastIndexOf("/") + 1);
}

function quotedHeredocs(line: string): Heredoc[] {
  const heredocs: Heredoc[] = [];
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "#" && (index === 0 || /[\s;|&()]/.test(line[index - 1] ?? ""))) break;
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character !== "<" || line[index + 1] !== "<" || line[index + 2] === "<") continue;

    let cursor = index + 2;
    let stripTabs = false;
    if (line[cursor] === "-") {
      stripTabs = true;
      cursor += 1;
    }
    while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;

    const delimiterQuote = line[cursor];
    if (delimiterQuote === "'" || delimiterQuote === '"') {
      const end = line.indexOf(delimiterQuote, cursor + 1);
      if (end !== -1) {
        heredocs.push({ delimiter: line.slice(cursor + 1, end), stripTabs });
        index = end;
      }
      continue;
    }

    let rawDelimiter = "";
    let quoted = false;
    while (cursor < line.length && !/[\s;|&()<>]/.test(line[cursor] ?? "")) {
      if (line[cursor] === "\\" && cursor + 1 < line.length) {
        quoted = true;
        cursor += 1;
      }
      rawDelimiter += line[cursor] ?? "";
      cursor += 1;
    }
    if (quoted && rawDelimiter.length > 0) heredocs.push({ delimiter: rawDelimiter, stripTabs });
    index = cursor - 1;
  }

  return heredocs;
}

function withoutQuotedHeredocBodies(command: string): string {
  const lines = command.split("\n");
  const result: string[] = [];
  const pending: Heredoc[] = [];

  for (const line of lines) {
    const heredoc = pending[0];
    if (heredoc !== undefined) {
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
      if (candidate === heredoc.delimiter) pending.shift();
      result.push("");
      continue;
    }

    result.push(line);
    pending.push(...quotedHeredocs(line));
  }

  return result.join("\n");
}

function splitCommands(command: string): string[] {
  const commands: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let comment = false;

  const flush = () => {
    if (current.trim().length > 0) commands.push(current);
    current = "";
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";

    if (comment) {
      if (character === "\n") {
        comment = false;
        flush();
      }
      continue;
    }
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      current += character;
      escaped = true;
      continue;
    }
    if (quote !== undefined) {
      current += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "#" && (current.length === 0 || /\s/.test(current.at(-1) ?? ""))) {
      comment = true;
      continue;
    }
    if (character === ";" || character === "\n") {
      flush();
      continue;
    }
    if (character === "&") {
      if (command[index + 1] === ">" || current.endsWith(">") || current.endsWith("<")) {
        current += character;
      } else {
        flush();
        if (command[index + 1] === "&") index += 1;
      }
      continue;
    }
    if (character === "|") {
      if (current.endsWith(">")) current += character;
      else {
        flush();
        if (command[index + 1] === "|") index += 1;
      }
      continue;
    }
    if (character === "(" || character === ")") {
      flush();
      continue;
    }
    current += character;
  }

  flush();
  return commands;
}

function tokenize(command: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  let activeGlobOffsets: number[] = [];
  let quote: "'" | '"' | undefined;

  const flushWord = () => {
    if (text.length > 0) tokens.push({ kind: "word", text, activeGlobOffsets });
    text = "";
    activeGlobOffsets = [];
  };

  const append = (character: string, activeGlob: boolean) => {
    if (activeGlob && character === "*") activeGlobOffsets.push(text.length);
    text += character;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? "";

    if (character === "\\" && quote !== "'") {
      const next = command[index + 1];
      if (next === "\n") {
        index += 1;
        continue;
      }
      if (next !== undefined) {
        append(next, false);
        index += 1;
      } else {
        append(character, false);
      }
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else append(character, false);
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      flushWord();
      continue;
    }

    const startsRedirection =
      character === ">" || character === "<" || (character === "&" && command[index + 1] === ">");
    if (startsRedirection) {
      let fd: string | undefined;
      if (/^\d+$/.test(text)) {
        fd = text;
        text = "";
        activeGlobOffsets = [];
      } else {
        flushWord();
      }

      const remainder = command.slice(index);
      const operator =
        ["&>>", "<<-", ">>", ">|", ">&", "<<<", "<<", "<&", "<>", "&>", ">", "<"].find(
          (candidate) => remainder.startsWith(candidate),
        ) ?? character;
      tokens.push({ kind: "redirect", operator, ...(fd === undefined ? {} : { fd }) });
      index += operator.length - 1;
      continue;
    }

    append(character, true);
  }

  flushWord();
  return tokens;
}

function isAssignment(token: Token | undefined): boolean {
  return token?.kind === "word" && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text);
}

function wordAt(tokens: readonly Token[], index: number): WordToken | undefined {
  const token = tokens[index];
  return token?.kind === "word" ? token : undefined;
}

function skipRedirection(tokens: readonly Token[], index: number): number {
  return tokens[index]?.kind === "redirect" ? Math.min(index + 2, tokens.length) : index;
}

function skipInterstices(tokens: readonly Token[], start: number): number {
  let index = start;
  while (index < tokens.length) {
    const afterRedirection = skipRedirection(tokens, index);
    if (afterRedirection !== index) {
      index = afterRedirection;
      continue;
    }
    if (isAssignment(tokens[index])) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
}

function commandStart(tokens: readonly Token[]): number {
  let index = skipInterstices(tokens, 0);
  while (CONTROL_WORDS.has(wordAt(tokens, index)?.text ?? "")) {
    index = skipInterstices(tokens, index + 1);
  }
  return index;
}

function optionValueCount(wrapper: string, option: string): number {
  if (wrapper === "env") return new Set(["-u", "--unset", "-C", "--chdir"]).has(option) ? 1 : 0;
  if (wrapper === "doas") return new Set(["-u", "-C"]).has(option) ? 1 : 0;
  if (wrapper === "exec") return option === "-a" ? 1 : 0;
  if (wrapper === "sudo") {
    return new Set([
      "-u",
      "--user",
      "-g",
      "--group",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-C",
      "--close-from",
      "-T",
      "--command-timeout",
      "-R",
      "--chroot",
      "-D",
      "--chdir",
      "-r",
      "--role",
      "-t",
      "--type",
    ]).has(option)
      ? 1
      : 0;
  }
  return 0;
}

function skipWrapper(tokens: readonly Token[], index: number, wrapper: string): number {
  let cursor = index + 1;

  while (cursor < tokens.length) {
    const afterRedirection = skipRedirection(tokens, cursor);
    if (afterRedirection !== cursor) {
      cursor = afterRedirection;
      continue;
    }

    const token = wordAt(tokens, cursor)?.text;
    if (token === undefined) return tokens.length;
    if (token === "--") return skipInterstices(tokens, cursor + 1);
    if (wrapper === "env" && isAssignment(tokens[cursor])) {
      cursor += 1;
      continue;
    }
    if (wrapper === "command" && (token === "-v" || token === "-V")) return tokens.length;
    if (!token.startsWith("-") || token === "-") return cursor;

    cursor += 1 + optionValueCount(wrapper, token);
  }

  return cursor;
}

function envSplitString(
  tokens: readonly Token[],
  envIndex: number,
): { payload: string; restIndex: number } | undefined {
  let cursor = envIndex + 1;

  while (cursor < tokens.length) {
    const token = wordAt(tokens, cursor)?.text;
    if (token === undefined) {
      cursor = skipRedirection(tokens, cursor);
      continue;
    }
    if (token === "-S" || token === "--split-string") {
      const payload = wordAt(tokens, cursor + 1)?.text;
      return payload === undefined ? undefined : { payload, restIndex: cursor + 2 };
    }
    if (token.startsWith("-S") && token.length > 2) {
      return { payload: token.slice(2), restIndex: cursor + 1 };
    }
    if (token.startsWith("--split-string=")) {
      return { payload: token.slice("--split-string=".length), restIndex: cursor + 1 };
    }
    if (token === "--" || (!token.startsWith("-") && !isAssignment(tokens[cursor])))
      return undefined;
    cursor += 1 + optionValueCount("env", token);
  }

  return undefined;
}

function shellPayload(tokens: readonly Token[], executableIndex: number): string | undefined {
  let index = executableIndex + 1;

  while (index < tokens.length) {
    const token = wordAt(tokens, index)?.text;
    if (token === undefined) {
      index = skipRedirection(tokens, index);
      continue;
    }
    if (token === "--") return undefined;
    if (token === "-o" || token === "+o") {
      index += 2;
      continue;
    }
    if (/^-[^-]*c[^-]*$/.test(token)) return wordAt(tokens, index + 1)?.text;
    if (!token.startsWith("-") && !token.startsWith("+")) return undefined;
    index += 1;
  }

  return undefined;
}

function argumentWords(tokens: readonly Token[], executableIndex: number): WordToken[] {
  const words: WordToken[] = [];
  let index = executableIndex + 1;

  while (index < tokens.length) {
    if (tokens[index]?.kind === "redirect") {
      index += 2;
      continue;
    }
    const word = wordAt(tokens, index);
    if (word !== undefined) words.push(word);
    index += 1;
  }

  return words;
}

function normalizeAbsolutePath(path: string): string | undefined {
  if (!path.startsWith("/")) return undefined;
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

function isRootTarget(token: WordToken): boolean {
  const normalized = normalizeAbsolutePath(token.text);
  if (normalized === "/") return true;
  if (normalized !== "/*") return false;

  const starOffset = token.text.indexOf("*");
  return (
    token.text.indexOf("*", starOffset + 1) === -1 && token.activeGlobOffsets.includes(starOffset)
  );
}

function isRootDeletion(tokens: readonly Token[], executableIndex: number): boolean {
  let recursive = false;
  let force = false;
  const targets: WordToken[] = [];
  let optionsEnded = false;

  for (const token of argumentWords(tokens, executableIndex)) {
    if (!optionsEnded && token.text === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (token.text === "--recursive" || token.text === "--rec")) {
      recursive = true;
      continue;
    }
    if (!optionsEnded && token.text === "--force") {
      force = true;
      continue;
    }
    if (!optionsEnded && /^-[^-]+$/.test(token.text)) {
      recursive ||= token.text.includes("r") || token.text.includes("R");
      force ||= token.text.includes("f");
      continue;
    }
    targets.push(token);
  }

  return recursive && force && targets.some(isRootTarget);
}

function hasStdoutRedirectToDevice(tokens: readonly Token[], executableIndex: number): boolean {
  for (let index = executableIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "redirect") continue;
    const redirectsStdout =
      token.operator.startsWith(">") || token.operator === "&>" || token.operator === "&>>";
    if (!redirectsStdout || (token.fd !== undefined && token.fd !== "1")) continue;
    if (RAW_BLOCK_DEVICE.test(wordAt(tokens, index + 1)?.text ?? "")) return true;
  }
  return false;
}

function formatterReason(executable: string, args: readonly WordToken[]): string | undefined {
  const deviceTarget = args.some((token) => FORMAT_BLOCK_DEVICE.test(token.text));
  if (!deviceTarget) return undefined;

  const lowerExecutable = executable.toLowerCase();
  if (lowerExecutable === "wipefs") {
    const noAct = args.some((token) => token.text === "--no-act" || /^-[^-]*n/.test(token.text));
    const destructive = args.some(
      (token) =>
        token.text === "--all" ||
        token.text === "--offset" ||
        token.text.startsWith("--offset=") ||
        /^-[^-]*[ao]/.test(token.text),
    );
    return destructive && !noAct
      ? "Blocked destructive wipefs operation on block device."
      : undefined;
  }

  const extDryRun =
    (lowerExecutable === "mke2fs" || /^mkfs[._-]ext[234]?$/.test(lowerExecutable)) &&
    args.some((token) => token.text === "-n");
  return extDryRun ? undefined : "Blocked filesystem formatter command on block device.";
}

function inspectSimpleCommand(tokens: readonly Token[], depth: number): string | undefined {
  let executableIndex = commandStart(tokens);

  for (let wrapperDepth = 0; wrapperDepth < MAX_WRAPPER_DEPTH; wrapperDepth += 1) {
    executableIndex = skipInterstices(tokens, executableIndex);
    const executable = executableName(wordAt(tokens, executableIndex)?.text ?? "");
    if (!WRAPPERS.has(executable)) break;

    if (executable === "env") {
      const split = envSplitString(tokens, executableIndex);
      if (split !== undefined && depth < MAX_INSPECTION_DEPTH) {
        return inspectSimpleCommand(
          [...tokenize(split.payload), ...tokens.slice(split.restIndex)],
          depth + 1,
        );
      }
    }
    executableIndex = skipWrapper(tokens, executableIndex, executable);
  }

  const executable = executableName(wordAt(tokens, executableIndex)?.text ?? "");
  if (executable.length === 0) return undefined;

  if (FORMATTER.test(executable)) {
    const reason = formatterReason(executable, argumentWords(tokens, executableIndex));
    if (reason !== undefined) return reason;
  }

  if (executable.toLowerCase() === "diskutil") {
    const operation = wordAt(tokens, executableIndex + 1)?.text.toLowerCase();
    if (operation === "erasedisk" || operation === "partitiondisk") {
      return "Blocked whole-disk diskutil operation.";
    }
  }

  if (executable === "dd") {
    const outputs = argumentWords(tokens, executableIndex).filter((token) =>
      token.text.startsWith("of="),
    );
    const output = outputs.at(-1)?.text.slice(3);
    if (
      (output !== undefined && RAW_BLOCK_DEVICE.test(output)) ||
      hasStdoutRedirectToDevice(tokens, executableIndex)
    ) {
      return "Blocked raw write to block device.";
    }
  }

  if (
    executable === "shred" &&
    argumentWords(tokens, executableIndex).some((token) => RAW_BLOCK_DEVICE.test(token.text))
  ) {
    return "Blocked shred of block device.";
  }

  if (executable === "rm" && isRootDeletion(tokens, executableIndex)) {
    return "Blocked recursive deletion of filesystem root.";
  }

  if (depth < MAX_INSPECTION_DEPTH && SHELLS.has(executable)) {
    const payload = shellPayload(tokens, executableIndex);
    if (payload !== undefined) return inspectCommand(payload, depth + 1);
  }

  return undefined;
}

function inspectCommand(command: string, depth: number): string | undefined {
  // Intentionally bounded and literal-only: dynamic expansion, eval, and unquoted heredoc execution are out of scope.
  for (const segment of splitCommands(withoutQuotedHeredocBodies(command))) {
    const reason = inspectSimpleCommand(tokenize(segment), depth);
    if (reason !== undefined) return reason;
  }
  return undefined;
}

export function catastrophicCommandReason(command: string): string | undefined {
  return inspectCommand(command, 0);
}

export default function catastrophicCommandGuard(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const reason = catastrophicCommandReason(event.input.command);
    return reason === undefined ? undefined : { block: true, reason };
  });
}
