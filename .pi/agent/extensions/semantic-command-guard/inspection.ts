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

export type Inspection =
  | { kind: "skip" }
  | { kind: "oversized" }
  | { kind: "review"; input: ClassifierContext };

export function inspectCommand(command: string): Inspection {
  if (command.length > MAX_COMMAND_CHARS) return { kind: "oversized" };
  // shortcut: lexical selection and summaries can miss shell semantics.
  // Use a shell parser before claiming comprehensive command coverage.
  if (/^\s*(?:cat|ls|pwd|rg|grep|head|tail|wc|echo|printf)\b[^;|&$`\n<>]*$/.test(command))
    return { kind: "skip" };
  if (/^\s*rm\s+(?:-[rfRF]+\s+)*(?:\.\/)?(?:dist|build|\.cache)\/?\s*$/.test(command))
    return { kind: "skip" };

  const words = new Set(command.match(/[A-Za-z][A-Za-z0-9._-]*/g) ?? []);
  const operations = OPERATIONS.filter((operation) => words.has(operation));
  const gitActions = GIT_ACTIONS.filter((action) => words.has(action));
  const inlineCode =
    /(?:\b(?:bash|sh|zsh|python3?)\b[^\n]*\s-[a-z]*c\b|\bnode\b[^\n]*\s(?:-e|--eval)\b|\beval\b)/.test(
      command,
    );
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
    input: {
      state: {
        operations,
        gitActions,
        recursive: /(?:\s-[^-\s]*[rR]|--recursive\b)/.test(command),
        force: /(?:\s-[^-\s]*f|--force(?:-with-lease)?\b)/.test(command),
        hardReset: /--hard\b/.test(command),
        deleteDestination: /--delete\b/.test(command),
        homeTarget: /(?:~\/|\$HOME\b|\/home\/|\/Users\/)/.test(command),
        deviceTarget: /\/dev\//.test(command),
        rootTarget: /(?:^|[\s"'])\/(?:\*|[\s"']|$)/.test(command),
        networkDestination: /(?:https?:\/\/|ssh:\/\/|\b[^\s]+@[^\s]+:)/.test(command),
        localDataReference:
          /(?:--data(?:-binary|-raw)?|--upload-file|\s-[dT]\s|\b(?:scp|rsync)\b)/.test(command),
        credentialReference:
          /(?:token|secret|password|authorization|api[_-]?key|\.env\b|\.ssh\b)/i.test(command),
        inlineCode,
        commandSubstitution: command.includes("$(") || command.includes("`"),
        outputRedirection: />/.test(command),
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
