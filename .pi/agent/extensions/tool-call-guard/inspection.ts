import { basename } from "node:path";
import type { ClassifierAnswer, ClassifierContext } from "@earendil-works/pi-ai";
import { executableWords, parseShell, type ShellWord } from "./shell";

const OPERATIONS = [
  "rm",
  "rmdir",
  "unlink",
  "cp",
  "tee",
  "find",
  "touch",
  "mv",
  "dd",
  "shred",
  "wipefs",
  "mkfs",
  "truncate",
  "chmod",
  "chown",
  "git",
  "curl",
  "wget",
  "scp",
  "rsync",
  "eval",
  "bash",
  "sh",
  "zsh",
  "python",
  "python3",
  "node",
] as const;
const GIT_ACTIONS = ["push", "reset", "clean", "rebase", "branch"] as const;
const MAX_COMMAND_CHARS = 16_000;
const INDICATORS = {
  recursive: ["Recursive flag", /(?:\s-[^-\s]*[rR]|--recursive\b)/],
  force: ["Force flag", /(?:\s-[^-\s]*f|--force(?:-with-lease)?\b)/],
  hardReset: ["Hard reset flag", /--hard\b/],
  deleteDestination: ["Delete flag", /--delete\b/],
  homeTarget: ["Home path reference", /(?:~\/|\$HOME\b|\/home\/|\/Users\/)/],
  deviceTarget: ["Device path reference", /\/dev\//],
  rootTarget: ["Root path reference", /(?:^|[\s"'])\/(?:\*|[\s"']|$)/],
  networkDestination: ["Network reference", /(?:https?:\/\/|ssh:\/\/|\b[^\s]+@[^\s]+:)/],
  localDataReference: [
    "Local data reference",
    /(?:--data(?:-binary|-raw)?|--upload-file|\s-[dT]\s|\b(?:scp|rsync)\b)/,
  ],
  credentialReference: [
    "Credential reference",
    /(?:token|secret|password|authorization|api[_-]?key|\.env\b|\.ssh\b)/i,
  ],
  inlineCode: [
    "Inline code indicator",
    /(?:\b(?:bash|sh|zsh|python3?)\b[^\n]*\s-[a-z]*c\b|\bnode\b[^\n]*\s(?:-e|--eval)\b|\beval\b)/,
  ],
  commandSubstitution: ["Command substitution marker", /\$\(|`/],
  outputRedirection: ["Output redirection marker", />/],
} satisfies Record<string, readonly [string, RegExp]>;

export type Inspection =
  | { kind: "skip" }
  | { kind: "oversized" }
  | { kind: "review"; input: ClassifierContext; evidence: readonly string[] };

interface Part {
  operation: string;
  words: readonly ShellWord[];
}

const WRAPPERS_AND_KEYWORDS = new Set([
  "sudo",
  "doas",
  "env",
  "exec",
  "nohup",
  "nice",
  "time",
  "timeout",
  "xargs",
  "watch",
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "for",
  "!",
  "{",
]);
const INTERPRETERS = new Set(["eval", "bash", "sh", "zsh", "python", "python3", "node"]);
// Opaque commands are scanned for these names only. Copies, `tee`, `find`, and `touch`
// rarely destroy data on their own and would make every script look risky.
const LEXICAL_OPERATIONS = new Set<string>(
  OPERATIONS.filter(
    (name) => !INTERPRETERS.has(name) && !["cp", "tee", "find", "touch"].includes(name),
  ),
);

/**
 * Nono grants decide what opaque code may touch. For syntax or execution the literal
 * parser cannot resolve, the guard only looks for known destructive or transfer
 * operation names anywhere in the text and asks the classifier about those; commands
 * without such names run without review.
 */
function lexicalInspection(command: string): Inspection {
  const tokens: ShellWord[] = [...command.matchAll(/[A-Za-z][A-Za-z0-9._-]*/g)].map((match) => ({
    value: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  const tail: ShellWord = { value: "", start: command.length, end: command.length };
  const parts: Part[] = [];
  for (const [index, token] of tokens.entries()) {
    if (token.value === "git") {
      const action = tokens
        .slice(index + 1)
        .find((candidate) => GIT_ACTIONS.some((name) => name === candidate.value));
      if (action) parts.push({ operation: "git", words: [token, action, tail] });
    } else if (LEXICAL_OPERATIONS.has(token.value)) {
      parts.push({ operation: token.value, words: [token, tail] });
    }
  }
  if (!parts.length) return { kind: "skip" };
  return buildReview(command, parts, false, true);
}

export function inspectCommand(command: string): Inspection {
  if (command.length > MAX_COMMAND_CHARS) return { kind: "oversized" };
  const parsed = parseShell(command);
  const unknown = () => lexicalInspection(command);
  if (parsed.kind === "unknown") return unknown();
  const selected: Part[] = [];
  let shellOverwrite = false;
  for (const part of parsed.commands) {
    const words = executableWords(part.words);
    if (!words) return unknown();
    const operation = basename(words[0]?.value ?? "");
    const executable = words[0]?.value ?? "";
    if (executable.includes("/") && !/^\/(?:usr\/)?bin\/[^/]+$/.test(executable)) return unknown();
    const args = words.slice(1).map((word) => word.value);
    if (operation === "printf" && args.includes("-v")) return unknown();
    if (operation === "rg" && args.some((arg) => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg)))
      return unknown();
    shellOverwrite ||= part.redirects.some((redirect) => redirect.operator === ">");
    // `sort -o` writes its output file, so it cannot share the read-only skip below.
    if (operation === "sort" && args.some((arg) => /^-[a-zA-Z]*o|^--output/.test(arg)))
      return unknown();
    if (
      [
        "cat",
        "ls",
        "pwd",
        "rg",
        "grep",
        "head",
        "tail",
        "wc",
        "echo",
        "printf",
        "true",
        "false",
        "cd",
        "pushd",
        "popd",
        "jq",
        "cut",
        "tr",
        "sort",
        "stat",
        "du",
        "file",
        "realpath",
        "basename",
        "dirname",
        "which",
      ].includes(operation)
    )
      continue;
    if (operation === "" && part.redirects.length) continue;
    // Wrappers and shell keywords run the following words as a command, so the text is
    // scanned as a whole rather than skipped as an unknown program.
    if (WRAPPERS_AND_KEYWORDS.has(operation)) return unknown();
    // Programs without destructive or transfer semantics are ordinary work within the grants.
    if (!OPERATIONS.some((name) => name === operation)) continue;
    if (INTERPRETERS.has(operation)) return unknown();
    if (
      operation === "find" &&
      args.some((arg) => /^-(?:exec|execdir|ok|okdir|fprint|fprintf|fls)/.test(arg))
    )
      return unknown();
    if (
      operation === "curl" &&
      args.some((arg) => arg === "-K" || arg.startsWith("--config") || arg === "--next")
    )
      return unknown();
    if (operation === "git") {
      // `-C dir` and `--no-pager` only change where and how Git runs; `-c` can set
      // executables such as core.pager, so it stays opaque.
      let index = 0;
      while (args[index] === "-C" || args[index] === "--no-pager")
        index += args[index] === "-C" ? 2 : 1;
      const action = args[index];
      if (!action || action.startsWith("-")) return unknown();
      if (["status", "diff", "log", "show", "rev-parse", "ls-files"].includes(action)) {
        if (
          args.some((arg) =>
            ["--ext-diff", "--textconv", "--output"].some(
              (flag) => arg === flag || arg.startsWith(`${flag}=`),
            ),
          )
        )
          return unknown();
        continue;
      }
      // Other Git commands (commit, add, fetch, checkout, ...) are ordinary repository work.
      if (!GIT_ACTIONS.some((name) => name === action)) continue;
      selected.push({
        operation,
        words: [words[0] ?? part.words[0], ...words.slice(index + 1)].filter(
          (word): word is ShellWord => word !== undefined,
        ),
      });
      continue;
    }
    selected.push({ operation, words });
  }
  if (!selected.length && !shellOverwrite) return { kind: "skip" };
  return buildReview(command, selected, shellOverwrite, false);
}

function buildReview(
  command: string,
  selected: readonly Part[],
  shellOverwrite: boolean,
  lexical: boolean,
): Inspection {
  const evidence: string[] = [];
  const addEvidence = (label: string, match: RegExpMatchArray) => {
    const leading = match[0].length - match[0].trimStart().length;
    const offset = (match.index ?? 0) + leading;
    const prefix = command.slice(0, offset);
    const line = prefix.split("\n").length;
    const column = Array.from(prefix.slice(prefix.lastIndexOf("\n") + 1)).length + 1;
    evidence.push(`${label}: ${JSON.stringify(match[0].trim())} (line ${line}, column ${column})`);
  };
  const operations = OPERATIONS.filter((operation) =>
    selected.some((part) => part.operation === operation),
  );
  const gitActions = GIT_ACTIONS.filter((action) =>
    selected.some((part) => part.operation === "git" && part.words[1]?.value === action),
  );
  for (const part of selected) {
    const first = part.words[0];
    if (first) {
      const match = /.+/.exec(command.slice(first.start, first.end));
      if (match) {
        match.index = first.start;
        addEvidence("Operation name", match);
      }
    }
  }
  // Indicators inspect selected command spans, not quoted data passed to read-only commands.
  const indicators = Object.fromEntries(
    Object.entries(INDICATORS).map(([key, [label, pattern]]) => {
      let found = false;
      for (const part of selected) {
        const first = part.words[0];
        const last = part.words.at(-1);
        if (!first || !last) continue;
        const match = pattern.exec(command.slice(first.start, last.end));
        if (match) {
          match.index = (match.index ?? 0) + first.start;
          addEvidence(label, match);
          found = true;
        }
      }
      return [key, found];
    }),
  );
  const findDelete = selected.some(
    (part) => part.operation === "find" && part.words.some((word) => word.value === "-delete"),
  );
  const teeOverwrite = selected.some(
    (part) =>
      part.operation === "tee" &&
      !part.words.some((word) => word.value === "-a" || word.value === "--append"),
  );
  const branchDelete = selected.some(
    (part) =>
      part.operation === "git" &&
      part.words[1]?.value === "branch" &&
      part.words.some((word) => /^-[dD]$|^--delete$/.test(word.value)),
  );

  // Only fixed labels and booleans leave the machine. Never include substrings
  // from arguments: redacting recognizable secrets alone cannot protect arbitrary data.
  return {
    kind: "review",
    evidence,
    input: {
      state: {
        operations,
        gitActions,
        ...indicators,
        shellOverwrite,
        findDelete,
        teeOverwrite,
        branchDelete,
        lexicalOnly: lexical,
        evidenceLimit: lexical
          ? "Lexical summary of a command the local parser could not resolve: operation names may appear in data or code rather than run. Names, values, paths, code, and user intent are omitted. This does not establish safety or authorization."
          : "Literal-shell summary only. Names, values, paths, code, and user intent are omitted. This does not establish safety or authorization.",
      },
      questions: {
        destructive: {
          type: "bool",
          instructions:
            "Does this lexical summary indicate an operation with destructive capability: deleting or overwriting file contents, damaging storage, or discarding or replacing Git history? Judge the operation's capability, not whether loss will definitely occur, whether the affected data matters, or whether the action is authorized. Use operation labels together with flags. Exact targets, option values and omitted code are unknown.",
          criteria: {
            true: "An indicated operation can discard existing data or history: shellOverwrite or teeOverwrite can overwrite file contents; find with findDelete, Git branch with branchDelete, rm, unlink or shred deletes data; truncate can remove existing file contents; dd can overwrite data; mkfs or wipefs can destroy storage contents; rsync with deleteDestination can delete destination data; Git reset with hardReset or Git clean can discard local work; Git push with force or deleteDestination can replace or remove remote history. Actual data loss need not be certain. Recursive deletion and homeTarget, rootTarget or deviceTarget increase scope.",
            false:
              "Evidence of read-only activity, a download without destructive indicators, an ordinary Git push without force or deletion, a reset without hardReset, or routine moves, copies or permission changes without destructive indicators. recursive, force or outputRedirection alone do not establish data loss. Missing detail is not proof of safety.",
          },
        },
        exfiltration: {
          type: "bool",
          instructions:
            "Using only this lexical summary, does the indicated operation risk transferring local data or credentials to a network destination? Distinguish outbound transfer from inbound download and local copying. Consider networkDestination, localDataReference, credentialReference and operation labels together. Do not invent a destination's trust, consent, payload contents or the behavior of omitted inline code.",
          criteria: {
            true: "Evidence of outbound transfer: networkDestination together with localDataReference, especially when credentialReference is present. curl or wget can upload as well as download; scp or rsync with a network destination can transfer local data. Credentials need not be present for an upload to be risky.",
            false:
              "Evidence of download-only activity without an outbound data or credential transfer, local copying without a network destination, or non-network activity. A network operation, credential mention, inlineCode or commandSubstitution alone does not establish an upload. Missing detail is not proof of safety.",
          },
        },
      },
    },
  };
}

export function flaggedRisks(input: Record<string, ClassifierAnswer>): string[] {
  const risks: string[] = [];
  if (input.destructive?.type === "bool" && input.destructive.probability >= 0.9)
    risks.push("destructive changes");
  if (input.exfiltration?.type === "bool" && input.exfiltration.probability >= 0.7)
    risks.push("a local data upload");
  return risks;
}
