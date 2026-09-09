import { posix as posixPath } from "node:path";

/*
 * Derived from OpenAI Codex's command_safety/is_dangerous_command.rs and bash.rs at
 * https://github.com/openai/codex/tree/634ebc1865c6ac840ed3ba118f040d527bf4b55d/codex-rs/shell-command/src
 *
 * Copyright 2025 OpenAI
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy at
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * This TypeScript port is modified from the upstream Rust implementation.
 */

/** The dangerous-command rule matched by a POSIX command invocation. */
export type DangerousCommandMatch = "rm" | "forced-rm" | "other";
export type DangerousCommandAnalysis =
  | {
      kind: "dangerous";
      match: DangerousCommandMatch;
      /** Literal path operands eligible for a safe-location policy. */
      pathValues?: readonly string[];
    }
  | { kind: "no_match" }
  | { kind: "unknown" };
const MAX_WRAPPER_DEPTH = 8;
const BASH_PARSER_MODULE_URL = new URL(
  "../../npm/node_modules/@gotgenes/pi-permission-system/src/access-intent/bash/parser.ts",
  import.meta.url,
).href;

interface SyntaxNode {
  readonly type: string;
  readonly text: string;
  readonly childCount: number;
  readonly isNamed: boolean;
  readonly hasError: boolean;
  child(index: number): SyntaxNode | null;
}

interface BashParser {
  parse(source: string): { rootNode: SyntaxNode; delete(): void } | null;
}

interface BashParserModule {
  getParser(): Promise<BashParser>;
}

/** Classifies a tokenized POSIX command using the pinned Codex rules. */
export async function analyzeDangerousCommand(
  command: readonly string[],
): Promise<DangerousCommandAnalysis> {
  return analyzeDangerousCommandAtDepth(command, 0);
}

/** Returns the matched rule while preserving the detector's original convenience API. */
export async function dangerousCommandMatch(
  command: readonly string[],
): Promise<DangerousCommandMatch | undefined> {
  const analysis = await analyzeDangerousCommand(command);
  return analysis.kind === "dangerous" ? analysis.match : undefined;
}

/**
 * Check whether a dangerous command's path evidence is confined to safe roots.
 *
 * The dangerous-command detector supplies path values for location-scoped rules;
 * this policy helper does not need to know which executable produced the rule.
 * A single fully literal command is required so wrappers, chains, and dynamic
 * targets cannot hide another operation behind the location exception.
 */
export async function isDangerousCommandSafeInLocations(
  command: string,
  analysis: DangerousCommandAnalysis,
  safeLocations: readonly string[],
): Promise<boolean> {
  const pathValues = analysis.kind === "dangerous" ? analysis.pathValues : undefined;
  if (pathValues === undefined || pathValues.length === 0) return false;

  const parsed = await parseShellLcLiteralCommands(["bash", "-lc", command]);
  if (parsed.kind !== "parsed" || parsed.hasUnresolvedCommands || parsed.commands.length !== 1) {
    return false;
  }

  return pathValues.every((target) =>
    safeLocations.some((location) => isPathDescendant(target, location)),
  );
}

async function analyzeDangerousCommandAtDepth(
  command: readonly string[],
  wrapperDepth: number,
): Promise<DangerousCommandAnalysis> {
  if (wrapperDepth > MAX_WRAPPER_DEPTH) return { kind: "dangerous", match: "other" };

  const directMatch = await dangerousCommandMatchForExecutable(command, wrapperDepth);
  if (directMatch.kind !== "no_match") return directMatch;

  const parsed = await parseShellLcLiteralCommands(command);
  if (parsed.kind === "unknown") return parsed;
  for (const literalCommand of parsed.commands) {
    const analysis = await analyzeDangerousCommandAtDepth(literalCommand, wrapperDepth + 1);
    if (analysis.kind !== "no_match") return analysis;
  }
  return { kind: "no_match" };
}
async function dangerousCommandMatchForExecutable(
  command: readonly string[],
  wrapperDepth: number,
): Promise<DangerousCommandAnalysis> {
  const executable = executableName(command[0]);
  if (executable === "rm") {
    return {
      kind: "dangerous",
      match: includesForceOption(command.slice(1)) ? "forced-rm" : "rm",
      pathValues: commandOperands(command),
    };
  }
  if (executable === "sudo") {
    return analyzeDangerousCommandAtDepth(command.slice(1), wrapperDepth + 1);
  }
  if (executable === "env") {
    return analyzeDangerousCommandAtDepth(
      command.slice(envCommandIndex(command)),
      wrapperDepth + 1,
    );
  }
  if (executable === "trap") {
    const action = trapAction(command);
    return action === undefined
      ? { kind: "no_match" }
      : analyzeDangerousCommandAtDepth(["sh", "-c", action], wrapperDepth + 1);
  }
  return { kind: "no_match" };
}

function executableName(raw: string | undefined): string | undefined {
  const name = raw?.split("/").at(-1);
  return name?.length ? name : undefined;
}

function includesForceOption(args: readonly string[]): boolean {
  const endOfOptions = args.indexOf("--");
  return args.slice(0, endOfOptions === -1 ? undefined : endOfOptions).some((arg) => {
    if (arg === "--force") return true;
    return arg.startsWith("-") && !arg.startsWith("--") && arg.slice(1).includes("f");
  });
}

function commandOperands(command: readonly string[]): string[] {
  let options = true;
  const operands: string[] = [];

  for (const argument of command.slice(1)) {
    if (options && argument === "--") {
      options = false;
      continue;
    }
    if (options && argument.startsWith("-") && argument !== "-") continue;
    operands.push(argument);
  }

  return operands;
}

function isPathDescendant(target: string, safeLocation: string): boolean {
  if (!posixPath.isAbsolute(target) || !posixPath.isAbsolute(safeLocation)) return false;

  const normalizedTarget = normalizeAbsolutePath(target);
  const normalizedLocation = normalizeAbsolutePath(safeLocation);
  if (normalizedLocation === "/" || normalizedTarget === normalizedLocation) return false;
  return normalizedTarget.startsWith(`${normalizedLocation}/`);
}

function normalizeAbsolutePath(path: string): string {
  const normalized = posixPath.normalize(path);
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function envCommandIndex(command: readonly string[]): number {
  let index = 1;
  while (index < command.length) {
    const argument = command[index];
    if (argument === "--") return index + 1;
    if (
      argument === "-i" ||
      argument === "--ignore-environment" ||
      isEnvironmentAssignment(argument)
    ) {
      index++;
      continue;
    }
    break;
  }
  return index;
}

function isEnvironmentAssignment(argument: string | undefined): boolean {
  if (argument === undefined) return false;
  const separator = argument.indexOf("=");
  return separator > 0 && !argument.startsWith("-");
}

function trapAction(command: readonly string[]): string | undefined {
  const action = command[command[1] === "--" ? 2 : 1];
  return action === undefined || action.startsWith("-") ? undefined : action;
}

type ParsedLiteralCommands =
  | { kind: "parsed"; commands: string[][]; hasUnresolvedCommands: boolean }
  | { kind: "unknown" };
async function parseShellLcLiteralCommands(
  command: readonly string[],
): Promise<ParsedLiteralCommands> {
  const script = shellScript(command);
  if (script === undefined) {
    return { kind: "parsed", commands: [], hasUnresolvedCommands: false };
  }

  try {
    const { getParser } = (await import(BASH_PARSER_MODULE_URL)) as BashParserModule;
    const tree = (await getParser()).parse(script);
    if (tree === null) return { kind: "unknown" };
    try {
      if (tree.rootNode.hasError) return { kind: "unknown" };
      return { kind: "parsed", ...literalCommands(tree.rootNode) };
    } finally {
      tree.delete();
    }
  } catch {
    return { kind: "unknown" };
  }
}

function shellScript(command: readonly string[]): string | undefined {
  const [shell, flag, script] = command;
  if (command.length !== 3 || (flag !== "-c" && flag !== "-lc")) return undefined;
  return ["sh", "bash", "zsh"].includes(executableName(shell) ?? "") ? script : undefined;
}

function literalCommands(root: SyntaxNode): {
  commands: string[][];
  hasUnresolvedCommands: boolean;
} {
  const commandNodes: SyntaxNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (node.type === "command") commandNodes.push(node);
    for (let index = 0; index < node.childCount; index++) {
      const child = node.child(index);
      if (child?.isNamed) stack.push(child);
    }
  }

  const commands = commandNodes.map(literalCommandWords);
  return {
    commands: commands.filter((words): words is string[] => words !== undefined),
    hasUnresolvedCommands: commands.some((words) => words === undefined),
  };
}

function literalCommandWords(command: SyntaxNode): string[] | undefined {
  const words: string[] = [];
  let foundCommandName = false;
  for (const child of namedChildren(command)) {
    if (child.type === "command_name") {
      const name = firstNamedChild(child);
      const value = name === undefined ? undefined : literalShellWord(name);
      if (value === undefined) return undefined;
      words.push(value);
      foundCommandName = true;
    } else if (foundCommandName) {
      const value = literalShellWord(child);
      if (value !== undefined) words.push(value);
    }
  }
  return foundCommandName ? words : undefined;
}

function literalShellWord(node: SyntaxNode): string | undefined {
  if ((node.type === "word" || node.type === "number") && namedChildren(node).length === 0) {
    return isLiteralWord(node.text) ? node.text : undefined;
  }
  if (node.type === "string") return literalDoubleQuotedString(node);
  if (node.type === "raw_string") return literalRawString(node.text);
  if (node.type === "concatenation") {
    const parts = namedChildren(node).map(literalShellWord);
    return parts.some((part) => part === undefined) ? undefined : parts.join("") || undefined;
  }
  return undefined;
}

function isLiteralWord(word: string): boolean {
  return !word.startsWith("=") && !/[{}*?[\]\\~^#$`]/.test(word);
}

function literalDoubleQuotedString(node: SyntaxNode): string | undefined {
  if (namedChildren(node).some((child) => child.type !== "string_content")) return undefined;
  const text = node.text;
  if (!text.startsWith('"') || !text.endsWith('"')) return undefined;
  const value = text.slice(1, -1);
  return /\\[$`"\\\n]/.test(value) ? undefined : value;
}

function literalRawString(text: string): string | undefined {
  return text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : undefined;
}

function namedChildren(node: SyntaxNode): SyntaxNode[] {
  const children: SyntaxNode[] = [];
  for (let index = 0; index < node.childCount; index++) {
    const child = node.child(index);
    if (child?.isNamed) children.push(child);
  }
  return children;
}

function firstNamedChild(node: SyntaxNode): SyntaxNode | undefined {
  return namedChildren(node)[0];
}
