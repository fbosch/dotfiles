import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { formatAnsiTextRanges } from "../../../lib/ansi-text-ranges";
import type { ProjectReference } from "./types";

const REFERENCE_OR_IMAGE_PATH_PATTERN =
  /(^|\s)(@(?:"[^"]+"|[^\s]+)|(?:"[^"]+\.(?:gif|jpe?g|png|webp)"|[^\s@]+\.(?:gif|jpe?g|png|webp)))(?=\s|$)/giu;
const IMAGE_PATH_PATTERN = /\.(?:gif|jpe?g|png|webp)$/iu;

interface ReferenceMentionMatch {
  start: number;
  end: number;
  isImagePath: boolean;
}

function referenceValue(token: string): string {
  const value = token.startsWith("@") ? token.slice(1) : token;
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function resolveReferencePath(value: string, cwd: string): string {
  const expandedPath =
    value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return isAbsolute(expandedPath) ? expandedPath : resolve(cwd, expandedPath);
}

function referencePathExists(value: string, cwd: string): boolean {
  return existsSync(resolveReferencePath(value, cwd));
}

function isImagePath(value: string, cwd: string): boolean {
  if (IMAGE_PATH_PATTERN.test(value) === false) return false;

  try {
    return statSync(resolveReferencePath(value, cwd)).isFile();
  } catch {
    return false;
  }
}

function matchReferenceMentions(
  text: string,
  references: readonly ProjectReference[],
  cwd: string,
): ReferenceMentionMatch[] {
  const referenceNames = new Set(references.map((reference) => reference.name.toLowerCase()));
  const matches: ReferenceMentionMatch[] = [];

  for (const match of text.matchAll(REFERENCE_OR_IMAGE_PATH_PATTERN)) {
    const token = match[2];
    if (token === undefined) continue;

    const value = referenceValue(token);
    const imagePath = isImagePath(value, cwd);
    if (
      imagePath === false &&
      (token.startsWith("@") === false ||
        (referenceNames.has(value.toLowerCase()) === false &&
          referencePathExists(value, cwd) === false))
    ) {
      continue;
    }

    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    matches.push({
      start,
      end: start + token.length,
      isImagePath: imagePath,
    });
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
  imageForegroundAnsi = foregroundAnsi,
): string {
  return formatAnsiTextRanges(
    text,
    (plainText) => matchReferenceMentions(plainText, references, cwd),
    (match) => (match.isImagePath ? imageForegroundAnsi : foregroundAnsi),
    restoreAnsi,
  );
}
