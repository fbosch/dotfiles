import { visibleWidth } from "@earendil-works/pi-tui";
import { diffWordsWithSpace, type StructuredPatch } from "diff";
import {
  color,
  diffCell,
  diffRule,
  emptyDiffCell,
  hunkSeparator,
  lineBackground,
  RESET,
  RESET_TEXT,
  splitDivider,
} from "./presentation";
import {
  DEFAULT_SYNTAX_THEME,
  type DiffRenderEngine,
  type DiffRenderOptions,
  ESCAPE,
  type RenderedDiff,
  SIDE_BY_SIDE_MIN_WIDTH,
  sanitizeTerminalOutput,
  stripSgrCodes,
} from "./shared";
import { createSyntaxHighlighter, type SyntaxToken } from "./syntax";

type Line = {
  content: string;
  kind: " " | "+" | "-" | "\\";
  old?: number;
  next?: number;
  omitted?: number;
};
type Row = { left?: Line; right?: Line };
type Range = readonly [number, number];
const WORD_ADDED = "#354629";
const WORD_REMOVED = "#5C3339";

function clean(text: string): string {
  // Source SGR is data, never trusted styling. Only generated token styles reach the terminal.
  return stripSgrCodes(sanitizeTerminalOutput(text)).replaceAll("\t", "    ");
}

function linesForPatch(patch: StructuredPatch): Line[] {
  const lines: Line[] = [];
  let previousEnd: number | undefined;
  for (const hunk of patch.hunks) {
    let old = hunk.oldStart;
    let next = hunk.newStart;
    if (lines.length)
      lines.push({
        content: "…",
        kind: "\\",
        omitted: Math.max(0, hunk.oldStart - (previousEnd ?? hunk.oldStart)),
      });
    previousEnd = hunk.oldStart + hunk.oldLines;
    for (const raw of hunk.lines) {
      const kind = raw[0];
      const content = clean(raw.slice(1));
      if (kind === " ") lines.push({ content, kind, old: old++, next: next++ });
      else if (kind === "-") lines.push({ content, kind, old: old++ });
      else if (kind === "+") lines.push({ content, kind, next: next++ });
      else if (kind === "\\") lines.push({ content: clean(raw), kind });
    }
  }
  return lines;
}

function pairedRows(lines: readonly Line[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.kind !== "-" && line.kind !== "+") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: Line[] = [],
      added: Line[] = [];
    while (lines[i]?.kind === "-") {
      const line = lines[i++];
      if (line) removed.push(line);
    }
    while (lines[i]?.kind === "+") {
      const line = lines[i++];
      if (line) added.push(line);
    }
    for (let j = 0; j < Math.max(removed.length, added.length); j++) {
      const left = removed[j],
        right = added[j];
      rows.push({ ...(left ? { left } : {}), ...(right ? { right } : {}) });
    }
  }
  return rows;
}

function wordRanges(old: string, next: string): { old: Range[]; next: Range[] } {
  if (old.length + next.length > 4096) return { old: [], next: [] };
  const changes = diffWordsWithSpace(old, next, { timeout: 10, maxEditLength: 200 });
  const result: { old: Range[]; next: Range[] } = { old: [], next: [] };
  let oldOffset = 0,
    nextOffset = 0;
  for (const change of changes ?? []) {
    if (change.removed) result.old.push([oldOffset, oldOffset + change.value.length]);
    if (change.added) result.next.push([nextOffset, nextOffset + change.value.length]);
    if (!change.added) oldOffset += change.value.length;
    if (!change.removed) nextOffset += change.value.length;
  }
  return result;
}

function tokenAnsi(
  tokens: readonly SyntaxToken[],
  ranges: readonly Range[],
  background: string,
  emphasis: string,
  dim = false,
): string {
  let offset = 0;
  return tokens
    .map((token) => {
      const start = offset;
      offset += token.content.length;
      const cuts = new Set([start, offset]);
      for (const [from, to] of ranges) {
        if (from > start && from < offset) cuts.add(from);
        if (to > start && to < offset) cuts.add(to);
      }
      const boundaries = [...cuts].sort((a, b) => a - b);
      return boundaries
        .slice(0, -1)
        .map((from, index) => {
          const to = boundaries[index + 1] ?? offset;
          const emph = ranges.some(([a, b]) => a <= from && from < b);
          const style = token.fontStyle ?? 0;
          return (
            RESET_TEXT +
            color(emph ? emphasis : background, true) +
            color(token.color ?? "#BBBBBB") +
            (dim ? `${ESCAPE}[2m` : "") +
            (style & 1 ? `${ESCAPE}[3m` : "") +
            (style & 2 ? `${ESCAPE}[1m` : "") +
            (style & 4 ? `${ESCAPE}[4m` : "") +
            token.content.slice(from - start, to - start)
          );
        })
        .join("");
    })
    .join("");
}

export function createDiffRenderer(themeName = DEFAULT_SYNTAX_THEME): DiffRenderEngine {
  const syntax = createSyntaxHighlighter(themeName);
  let disposed = false;
  return {
    prewarm: () => syntax.prewarm(),
    async dispose() {
      disposed = true;
      await syntax.dispose();
    },
    async render(
      patches: readonly StructuredPatch[],
      options: DiffRenderOptions,
    ): Promise<RenderedDiff> {
      if (disposed) throw new Error("Diff renderer is disposed");
      options.signal?.throwIfAborted();
      const prepared = patches.map((patch) => ({ patch, lines: linesForPatch(patch) }));
      const maxNumber = prepared.reduce(
        (max, { lines }) =>
          lines.reduce((n, line) => Math.max(n, line.old ?? 0, line.next ?? 0), max),
        1,
      );
      const numberWidth = Math.max(2, String(maxNumber).length);
      const gutterWidth = numberWidth + 5;
      const halfWidth = Math.floor((options.width - 1) / 2);
      const sideCodeWidth = halfWidth - gutterWidth;
      const canSplit =
        options.display === "side-by-side" &&
        sideCodeWidth >= 20 &&
        (options.auto === false ||
          (options.width >= SIDE_BY_SIDE_MIN_WIDTH && sideCodeWidth >= 60));
      let fallback = false;
      if (canSplit && options.auto !== false) {
        const sourceLines = prepared
          .flatMap(({ lines }) => lines)
          .filter((line) => line.kind !== "\\");
        const wraps = sourceLines.filter(
          (line) => visibleWidth(line.content) > sideCodeWidth,
        ).length;
        fallback = wraps >= 8 || (wraps >= sourceLines.length * 0.2 && wraps > 0);
      }
      const display = canSplit && !fallback ? "side-by-side" : "inline";
      const output: string[] = [];
      const warnings = new Set<string>();
      for (const { patch, lines } of prepared) {
        options.signal?.throwIfAborted();
        const path = clean(
          patch.newFileName === "/dev/null" ? patch.oldFileName : patch.newFileName,
        );
        output.push(
          `${color("#686868")}${path.replace(patch.oldFileName.startsWith("a/") && patch.newFileName.startsWith("b/") ? /^b\//u : /^$/u, "")}${RESET}`,
        );
        if (!lines.length) {
          if (patch.oldFileName !== patch.newFileName)
            output.push(`${clean(patch.oldFileName)} → ${clean(patch.newFileName)}`);
          continue;
        }
        const oldLines = lines.filter((line) => line.kind === " " || line.kind === "-");
        const newLines = lines.filter((line) => line.kind === " " || line.kind === "+");
        const [oldHL, newHL] = await Promise.all([
          syntax.highlight(oldLines.map((line) => line.content).join("\n"), path, options.signal),
          syntax.highlight(newLines.map((line) => line.content).join("\n"), path, options.signal),
        ]);
        if (oldHL.warning) warnings.add(oldHL.warning);
        if (newHL.warning) warnings.add(newHL.warning);
        const highlighted = new Map<Line, readonly SyntaxToken[]>();
        oldLines.forEach((line, i) => {
          highlighted.set(line, oldHL.lines[i] ?? [{ content: line.content }]);
        });
        newLines.forEach((line, i) => {
          highlighted.set(line, newHL.lines[i] ?? [{ content: line.content }]);
        });
        const rows = pairedRows(lines);
        const ranges = new Map<Line, readonly Range[]>();
        for (const { left, right } of rows) {
          if (left?.kind === "-" && right?.kind === "+") {
            const result = wordRanges(left.content, right.content);
            ranges.set(left, result.old);
            ranges.set(right, result.next);
          }
        }
        const cell = (line: Line | undefined, width: number, side: "old" | "next"): string[] => {
          if (!line) return [emptyDiffCell(width, numberWidth)];
          const body = tokenAnsi(
            highlighted.get(line) ?? [{ content: line.content }],
            ranges.get(line) ?? [],
            lineBackground(line.kind),
            line.kind === "+" ? WORD_ADDED : WORD_REMOVED,
            line.kind === " ",
          );
          return diffCell(
            body,
            line.kind,
            side === "old" ? line.old : line.next,
            width,
            numberWidth,
          );
        };
        const frame =
          display === "inline"
            ? diffRule(options.width)
            : diffRule(halfWidth) + splitDivider(true) + diffRule(halfWidth);
        output.push(frame);
        if (display === "inline") {
          for (const line of lines) {
            if (line.omitted !== undefined) output.push(hunkSeparator(options.width, line.omitted));
            else output.push(...cell(line, options.width, line.kind === "-" ? "old" : "next"));
          }
        } else {
          for (const { left, right } of rows) {
            if (left?.omitted !== undefined) {
              output.push(
                hunkSeparator(halfWidth, left.omitted) +
                  splitDivider(true) +
                  hunkSeparator(halfWidth, left.omitted),
              );
              continue;
            }
            const a = cell(left, halfWidth, "old"),
              b = cell(right, halfWidth, "next");
            for (let i = 0; i < Math.max(a.length, b.length); i++) {
              output.push(
                (a[i] ?? emptyDiffCell(halfWidth, numberWidth, !left)) +
                  splitDivider() +
                  (b[i] ?? emptyDiffCell(halfWidth, numberWidth, !right)),
              );
            }
          }
        }
        output.push(frame);
      }
      options.signal?.throwIfAborted();
      return {
        output: output.join("\n"),
        display,
        ...(warnings.size ? { warning: [...warnings].join("\n") } : {}),
      };
    },
  };
}
