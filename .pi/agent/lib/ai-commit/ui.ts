import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { createInterface } from "node:readline/promises";

export class InteractiveInputError extends Error {}
export class PromptInterruptedError extends Error {}

type StatusKind = "Info" | "Working" | "Success" | "Warning" | "Error";

const STATUS_COLORS: Record<StatusKind, number> = {
  Info: 36,
  Working: 36,
  Success: 32,
  Warning: 33,
  Error: 31,
};

function colorEnabled(): boolean {
  if (process.env.TERM === "dumb") return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR.length > 0) return false;
  return process.stderr.isTTY || process.env.CLICOLOR_FORCE === "1";
}

function sanitizeTerminalText(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return " ";
      const isControl =
        codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f);
      return isControl ? " " : character;
    })
    .join("");
}

export function status(kind: StatusKind, message: string): void {
  const label = kind.padEnd(7);
  const renderedLabel = colorEnabled()
    ? `\u001b[1;${STATUS_COLORS[kind]}m${label}\u001b[0m`
    : label;
  process.stderr.write(`${renderedLabel}  ${sanitizeTerminalText(message)}\n`);
}

export function writeResult(message: string): void {
  process.stdout.write(`${sanitizeTerminalText(message).trimEnd()}\n`);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function formatCommitCommand(message: string): string {
  return `git commit -m ${shellQuote(message)}`;
}

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export function copyCommitCommandToClipboard(message: string): void {
  const command = formatCommitCommand(message);
  const candidates: Array<{ command: string; args: string[] }> =
    platform() === "darwin"
      ? [{ command: "pbcopy", args: [] }]
      : [
          { command: "wl-copy", args: [] },
          { command: "xclip", args: ["-selection", "clipboard"] },
        ];

  for (const candidate of candidates) {
    if (commandExists(candidate.command) === false) continue;
    const result = spawnSync(candidate.command, candidate.args, {
      input: command,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (result.status === 0) return;
  }
}

function assertInteractiveInput(): void {
  if (process.stdin.isTTY !== true) {
    throw new InteractiveInputError(
      "Interactive input is unavailable; pass --yes to accept the generated message",
    );
  }
}

async function question(prompt: string): Promise<string | undefined> {
  assertInteractiveInput();
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  let interrupted = false;
  readline.on("SIGINT", () => {
    interrupted = true;
    readline.close();
  });

  try {
    return await readline.question(prompt);
  } catch (error) {
    if (interrupted) throw new PromptInterruptedError("Prompt interrupted");
    if (error instanceof Error && error.message === "readline was closed") return undefined;
    throw error;
  } finally {
    readline.close();
  }
}

export async function input(message: string, initialValue: string): Promise<string | undefined> {
  process.stderr.write(`${sanitizeTerminalText(message)}\n`);
  process.stderr.write(`  Current  ${sanitizeTerminalText(initialValue)}\n`);
  const answer = await question("\nEnter a commit message, or press Enter to accept: ");
  if (answer === undefined) return undefined;
  const trimmed = answer.trim();
  return trimmed.length === 0 ? initialValue : trimmed;
}

export async function choose(
  message: string,
  options: readonly string[],
): Promise<string | undefined> {
  if (options.length === 0) return undefined;
  process.stderr.write(`${sanitizeTerminalText(message)}\n`);
  for (const [index, option] of options.entries()) {
    process.stderr.write(`  ${index + 1}. ${sanitizeTerminalText(option)}\n`);
  }

  const answer = await question("\nEnter a number [1]: ");
  if (answer === undefined) return undefined;
  const selected = answer.trim().length === 0 ? 1 : Number.parseInt(answer.trim(), 10);
  return Number.isInteger(selected) && selected >= 1 && selected <= options.length
    ? options[selected - 1]
    : undefined;
}
