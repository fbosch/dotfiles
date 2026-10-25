import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { ESCAPE, ZENWRITTEN_ADDED_BACKGROUND, ZENWRITTEN_REMOVED_BACKGROUND } from "./shared";

export type DiffLineKind = " " | "+" | "-" | "\\";
export const RESET = `${ESCAPE}[0m`;
export const RESET_TEXT = `${ESCAPE}[39;22;23;24m`;
const BASE = "#191919";
const RULE = "#333333";
const STRIPE = "#303030";
const FOREGROUND = { " ": "#686868", "+": "#819B69", "-": "#DE6E7C", "\\": "#686868" };

const foregroundColors = new Map<string, string>();
const backgroundColors = new Map<string, string>();

export function color(hex: string, background = false): string {
  const cache = background ? backgroundColors : foregroundColors;
  const cached = cache.get(hex);
  if (cached !== undefined) return cached;
  if (!/^#[0-9a-f]{6}$/iu.test(hex)) throw new Error("Invalid syntax color");
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const ansi = `${ESCAPE}[${background ? 48 : 38};2;${rgb.join(";")}m`;
  // Bundled themes can introduce new colors; do not retain palettes without a bound.
  if (cache.size >= 256) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(hex, ansi);
  return ansi;
}

export function lineBackground(kind: DiffLineKind): string {
  return kind === "+"
    ? ZENWRITTEN_ADDED_BACKGROUND
    : kind === "-"
      ? ZENWRITTEN_REMOVED_BACKGROUND
      : BASE;
}

export function diffRule(width: number): string {
  return color(BASE, true) + color(RULE) + "─".repeat(Math.max(0, width)) + RESET;
}

export function splitDivider(header = false): string {
  return color(BASE, true) + color(RULE) + (header ? "┊" : "│") + RESET;
}

export function hunkSeparator(width: number, omitted?: number): string {
  const label = omitted === undefined ? " ··· " : ` ${omitted} unmodified lines `;
  const available = Math.min(width, 72);
  const text = visibleWidth(label) <= available ? label : "···";
  const padding = Math.max(0, available - visibleWidth(text));
  return (
    color(BASE, true) +
    color("#686868") +
    "─".repeat(Math.floor(padding / 2)) +
    text +
    "─".repeat(Math.ceil(padding / 2)) +
    " ".repeat(Math.max(0, width - available)) +
    RESET
  );
}

export function diffAnnotation(text: string, width: number): string {
  return wrapTextWithAnsi(text, Math.max(1, width))
    .map(
      (line) =>
        color(BASE, true) +
        color("#686868") +
        line +
        " ".repeat(Math.max(0, width - visibleWidth(line))) +
        RESET,
    )
    .join("\n");
}
export function emptyDiffCell(width: number, numberWidth: number, missing = true): string {
  const background = color(BASE, true);
  if (!missing) return background + " ".repeat(width) + RESET;
  // Hatching means no source line exists, never an actual empty source line or a wrap continuation.
  const gutter = numberWidth + 2;
  return (
    background +
    " " +
    color(STRIPE) +
    "╱".repeat(gutter) +
    color(RULE) +
    "│ " +
    color(STRIPE) +
    "╱".repeat(Math.max(0, width - gutter - 3)) +
    RESET
  );
}

export function diffCell(
  body: string,
  kind: DiffLineKind,
  number: number | undefined,
  width: number,
  numberWidth: number,
): string[] {
  const background = color(lineBackground(kind), true);
  const changed = kind === "+" || kind === "-";
  const border = changed ? color(FOREGROUND[kind]) + "▌" : " ";
  const divider = color(RULE) + "│" + RESET_TEXT + " ";
  const gutter =
    border +
    background +
    color(FOREGROUND[kind]) +
    String(number ?? "").padStart(numberWidth) +
    (changed ? `${ESCAPE}[1m` : "") +
    (kind === "\\" ? " " : kind) +
    RESET_TEXT +
    " " +
    divider;
  const continuation = border + background + " ".repeat(numberWidth + 2) + divider;
  const codeWidth = Math.max(1, width - numberWidth - 5);
  const styled = body.replaceAll(RESET, RESET + background);
  const text = background + styled;
  const bodyWidth = visibleWidth(text);
  // A fitting single line needs no ANSI-state tracking or continuation reconstruction.
  const fits = bodyWidth <= codeWidth && !/[\r\n]/u.test(body);
  const chunks = fits ? [text] : wrapTextWithAnsi(text, codeWidth);
  return (chunks.length ? chunks : [""]).map((chunk, index) => {
    const padding = Math.max(0, codeWidth - (fits ? bodyWidth : visibleWidth(chunk)));
    return (
      background +
      (index === 0 ? gutter : continuation) +
      chunk +
      background +
      " ".repeat(padding) +
      RESET
    );
  });
}
