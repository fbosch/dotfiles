import type { ClassifierAnswer, ClassifierContext } from "@earendil-works/pi-ai";

const OPERATIONS = [
  "rm",
  "rmdir",
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

export function inspectCommand(command: string): Inspection {
  if (command.length > MAX_COMMAND_CHARS) return { kind: "oversized" };
  // shortcut: lexical selection and summaries can miss shell semantics.
  // Use a shell parser before claiming comprehensive command coverage.
  if (/^\s*(?:cat|ls|pwd|rg|grep|head|tail|wc|echo|printf)\b[^;|&$`\n<>]*$/.test(command))
    return { kind: "skip" };

  const evidence: string[] = [];
  const addEvidence = (label: string, match: RegExpMatchArray) => {
    const leading = match[0].length - match[0].trimStart().length;
    const offset = (match.index ?? 0) + leading;
    const prefix = command.slice(0, offset);
    const line = prefix.split("\n").length;
    const column = Array.from(prefix.slice(prefix.lastIndexOf("\n") + 1)).length + 1;
    evidence.push(`${label}: ${JSON.stringify(match[0].trim())} (line ${line}, column ${column})`);
  };
  const matches = [...command.matchAll(/[A-Za-z][A-Za-z0-9._-]*/g)];
  const words = new Set(matches.map((match) => match[0]));
  const operations = OPERATIONS.filter((operation) => words.has(operation));
  const gitActions = GIT_ACTIONS.filter((action) => words.has(action));
  for (const [label, names] of [
    ["Operation name", operations],
    ["Git action name", gitActions],
  ] as const) {
    for (const name of names) {
      const match = matches.find((match) => match[0] === name);
      if (match) addEvidence(label, match);
    }
  }
  const indicators = Object.fromEntries(
    Object.entries(INDICATORS).map(([key, [label, pattern]]) => {
      const match = pattern.exec(command);
      if (match) addEvidence(label, match);
      return [key, match !== null];
    }),
  );
  const inlineCode = indicators.inlineCode;
  const risky =
    operations.some(
      (operation) => !["git", "bash", "sh", "zsh", "python", "python3", "node"].includes(operation),
    ) ||
    (operations.includes("git") && gitActions.length > 0) ||
    inlineCode;
  if (!risky) return { kind: "skip" };

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
        evidenceLimit:
          "Lexical summary only. Names, values, paths, code, and user intent are omitted. This does not establish safety or authorization.",
      },
      questions: {
        destructive: {
          type: "bool",
          instructions:
            "Does this lexical summary indicate an operation with destructive capability: deleting or overwriting file contents, damaging storage, or discarding or replacing Git history? Judge the operation's capability, not whether loss will definitely occur, whether the affected data matters, or whether the action is authorized. Use operation labels together with flags. Exact targets, option values and omitted code are unknown.",
          criteria: {
            true: "An indicated operation can discard existing data or history: rm or shred deletes data; truncate can remove existing file contents; dd can overwrite data; mkfs or wipefs can destroy storage contents; rsync with deleteDestination can delete destination data; Git reset with hardReset or Git clean can discard local work; Git push with force or deleteDestination can replace or remove remote history. Actual data loss need not be certain. Recursive deletion and homeTarget, rootTarget or deviceTarget increase scope.",
            false:
              "Evidence of read-only activity, a download without destructive indicators, an ordinary Git push without force or deletion, a reset without hardReset, or routine moves, copies or permission changes without destructive indicators. inlineCode, commandSubstitution, recursive, force or outputRedirection alone do not establish data loss. Missing detail is not proof of safety.",
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
