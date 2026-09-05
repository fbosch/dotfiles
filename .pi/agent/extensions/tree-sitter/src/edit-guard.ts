/**
 * Pre-write edit simulation — runs the edit tool's own execute with file
 * operations redirected to memory, so the guard validates exactly the
 * content the tool would write, with no copied matching logic.
 *
 * The edit tool matches oldText by substring search (exact first, then
 * fuzzy-normalized), which means an oldText that is only a PREFIX of the
 * file content matches silently and leaves trailing characters behind.
 * This module detects that pattern so the guard can name it as the likely
 * cause of a blocked edit instead of reporting the resulting syntax error
 * alone.
 */

import {
  createEditToolDefinition,
  type EditToolInput,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface PrefixLeftover {
  /** 0-based index into the edits array. */
  editIndex: number;
  /** 1-based line number of the match. */
  line: number;
  /** Characters remaining after the match on the same line. */
  leftover: string;
}

/**
 * Run the edit tool's real execute in memory and return the file content it
 * would write, or null when the tool itself would fail the call (empty
 * oldText, text not found, non-unique match, overlapping edits, no change).
 * The guard stays silent in those cases and lets the tool report its precise
 * error.
 */
export async function simulateEditContent(
  rawContent: string,
  path: string,
  edits: EditToolInput["edits"],
  cwd: string,
  ctx: ExtensionContext,
): Promise<string | null> {
  let proposed: string | null = null;
  const definition = createEditToolDefinition(cwd, {
    operations: {
      access: async () => undefined,
      readFile: async () => Buffer.from(rawContent, "utf-8"),
      writeFile: async (_absolutePath, content) => {
        proposed = content;
      },
    },
  });
  try {
    await definition.execute("", { path, edits }, new AbortController().signal, undefined, ctx);
  } catch {
    return null;
  }
  return proposed;
}

/** The tool's fuzzy normalization: strip trailing whitespace per line,
 *  normalize smart quotes/dashes/Unicode spaces to ASCII. */
function normalizeForFuzzyMatch(text: string): string {
  return text
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

/**
 * Find the first edit whose oldText matched only a prefix of a line, leaving
 * closing delimiters after the match. Uses the same matching space as the
 * tool (exact first, fuzzy fallback). Diagnostic hint for blocked edits —
 * computed from the input alone, no full matching machinery needed.
 */
export function findPrefixLeftover(
  rawContent: string,
  edits: EditToolInput["edits"],
): PrefixLeftover | undefined {
  const base = normalizeToLF(stripBom(rawContent));
  const normalized = edits.map((edit) => normalizeToLF(edit.oldText));
  const anyFuzzy = normalized.some((oldText) => base.indexOf(oldText) === -1);
  const matchBase = anyFuzzy ? normalizeForFuzzyMatch(base) : base;
  for (const [editIndex, normalizedOldText] of normalized.entries()) {
    const oldText = anyFuzzy ? normalizeForFuzzyMatch(normalizedOldText) : normalizedOldText;
    const index = matchBase.indexOf(oldText);
    if (index === -1) continue;
    const restOfLine = matchBase.slice(index + oldText.length).split("\n")[0] ?? "";
    if (/[)\]}]$/.test(oldText.trimEnd()) && /^[)\]}]/.test(restOfLine)) {
      const line = matchBase.slice(0, index).split("\n").length;
      return { editIndex, line, leftover: restOfLine };
    }
  }
  return undefined;
}

/** Human-readable diagnosis for a prefix match that leaves trailing delimiters. */
export function describePrefixLeftover(info: PrefixLeftover): string {
  const shown = info.leftover.length > 40 ? `${info.leftover.slice(0, 40)}…` : info.leftover;
  return (
    `edit #${info.editIndex + 1}: oldText matched only a prefix of line ${info.line} \u2014 ` +
    `${info.leftover.length} character(s) after the match (${JSON.stringify(shown)}) would remain in the result. ` +
    `Include them in oldText if they belong to the replaced text.`
  );
}
