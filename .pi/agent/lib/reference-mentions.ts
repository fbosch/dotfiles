import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ProjectReference } from "../extensions/project-references";
import { formatAnsiTextRanges } from "./ansi-text-ranges";

const REFERENCE_MENTION_PATTERN = /(^|\s)(@(?:"[^"]+"|[^\s]+))(?=\s|$)/g;

interface ReferenceMentionMatch {
  start: number;
  end: number;
}

function referenceValue(token: string): string {
  const value = token.slice(1);
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function referencePathExists(value: string, cwd: string): boolean {
  const expandedPath =
    value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return existsSync(isAbsolute(expandedPath) ? expandedPath : resolve(cwd, expandedPath));
}

function matchReferenceMentions(
  text: string,
  references: readonly ProjectReference[],
  cwd: string,
): ReferenceMentionMatch[] {
  const referenceNames = new Set(references.map((reference) => reference.name.toLowerCase()));
  const matches: ReferenceMentionMatch[] = [];

  for (const match of text.matchAll(REFERENCE_MENTION_PATTERN)) {
    const token = match[2];
    if (token === undefined) continue;

    const value = referenceValue(token);
    if (
      referenceNames.has(value.toLowerCase()) === false &&
      referencePathExists(value, cwd) === false
    ) {
      continue;
    }

    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    matches.push({ start, end: start + token.length });
  }

  return matches;
}

export function formatReferenceMentions(
  text: string,
  references: readonly ProjectReference[],
  cwd: string,
  format: (text: string) => string,
): string {
  let formatted = text;
  const matches = matchReferenceMentions(text, references, cwd);
  for (const match of matches.reverse()) {
    formatted =
      formatted.slice(0, match.start) +
      format(text.slice(match.start, match.end)) +
      formatted.slice(match.end);
  }
  return formatted;
}

export function formatAnsiReferenceMentions(
  text: string,
  references: readonly ProjectReference[],
  cwd: string,
  foregroundAnsi: string,
  restoreAnsi = "\u001b[39m",
): string {
  return formatAnsiTextRanges(
    text,
    (plainText) => matchReferenceMentions(plainText, references, cwd),
    () => foregroundAnsi,
    restoreAnsi,
  );
}
