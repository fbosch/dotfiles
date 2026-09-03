import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { fitColumns, paintDockBottomEdge, paintDockRow } from "../prompt-ui/dock-rendering";
import type { TrackedFile } from "./model";

const COLLAPSED_FILE_LIMIT = 6;
const PANEL_PADDING_X = 2;

export function sanitizeDisplayPath(path: string): string {
  return Array.from(path, (character) => {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || (codePoint >= 0x20 && (codePoint < 0x7f || codePoint > 0x9f))) {
      return character;
    }
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\x${codePoint.toString(16).padStart(2, "0")}`;
  }).join("");
}

function pathTail(path: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(path) <= width) return path;
  if (width === 1) return "…";

  let tail = "";
  for (const character of [...path].reverse()) {
    if (visibleWidth(`${character}${tail}`) > width - 1) break;
    tail = `${character}${tail}`;
  }
  return `…${tail}`;
}

function renderCounts(change: TrackedFile, theme: Pick<Theme, "fg">): string {
  const counts = [
    change.added > 0 ? theme.fg("success", `+${change.added}`) : undefined,
    change.removed > 0 ? theme.fg("error", `-${change.removed}`) : undefined,
  ].filter((count) => count !== undefined);

  return counts.length > 0 ? counts.join(" ") : theme.fg("dim", "0 lines");
}

function renderFileRow(
  change: TrackedFile,
  branch: "├─" | "└─",
  width: number,
  theme: Pick<Theme, "fg">,
): string {
  const counts = renderCounts(change, theme);
  const marker = change.kind === "added" ? "A" : "M";
  const prefix = `${branch} ${marker} `;
  const pathWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(counts) - 1);
  const displayPath = pathTail(sanitizeDisplayPath(change.path), pathWidth);
  const left = theme.fg("muted", prefix) + theme.fg("text", displayPath);
  return fitColumns(left, counts, width);
}

export function renderChangeRows(
  changes: readonly TrackedFile[],
  theme: Pick<Theme, "fg">,
  width: number,
  expanded: boolean,
): string[] {
  const sorted = [...changes].sort((left, right) => left.path.localeCompare(right.path));
  const limit = expanded ? sorted.length : COLLAPSED_FILE_LIMIT;
  const visible = sorted.slice(0, limit);
  const hiddenCount = sorted.length - visible.length;
  const rows = visible.map((change, index) => {
    const isLast = index === visible.length - 1 && hiddenCount === 0;
    return renderFileRow(change, isLast ? "└─" : "├─", width, theme);
  });

  if (hiddenCount > 0) {
    rows.push(theme.fg("dim", `└─ ${hiddenCount} more`));
  }

  return rows;
}

export class FileChangesWidget implements Component {
  constructor(
    private readonly changes: readonly TrackedFile[],
    private readonly theme: Theme,
    private readonly isExpanded: () => boolean,
  ) {}

  render(width: number): string[] {
    if (width <= 0 || this.changes.length === 0) return [];

    const paddingX = width >= PANEL_PADDING_X * 2 + 1 ? PANEL_PADDING_X : 0;
    const contentWidth = Math.max(0, width - paddingX * 2);
    const header = `${this.theme.fg("accent", "●")} ${this.theme.bold("Changes")}`;
    const content = [
      header,
      ...renderChangeRows(this.changes, this.theme, contentWidth, this.isExpanded()),
    ].map((line) => `${" ".repeat(paddingX)}${line}`);
    const background = this.theme.getBgAnsi("toolPendingBg");
    const rows = ["", ...content].map((line) => paintDockRow(line, width, "", background));

    return [...rows, paintDockBottomEdge(width, "", "", background)];
  }

  invalidate(): void {}
}
