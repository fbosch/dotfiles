import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ChartDetails, ChartLayout } from "../types";
import { escapeXml } from "../types";

export const MAX_SVG_ACCESSIBLE_DESCRIPTION_BYTES = 16 * 1024;
export const ESTIMATED_CHARACTER_WIDTH = 0.58;
export const FIXED_CHART_PALETTE = [
  "#579aca",
  "#e69f57",
  "#70ad89",
  "#b48ac6",
  "#d76d85",
  "#c3b45b",
] as const;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function stripTanStackSvg(svg: string): string {
  return svg.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
}

export function finalizeChartLayout<TLayout extends Omit<ChartLayout, "heightCells">>(
  layout: TLayout,
  cellHeightPx: number,
): TLayout & ChartLayout {
  return { ...layout, heightCells: Math.ceil(layout.heightPx / cellHeightPx) };
}

export function normalizeBoundedText(
  value: string | undefined,
  name: string,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`${name} must be 1-${maximum} characters`);
  }
  return normalized;
}

export function normalizeUniqueLabel(
  label: string,
  index: number,
  maximum: number,
  seen: Set<string>,
): string {
  const normalized = label.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new Error(`label ${index + 1} must be 1-${maximum} characters`);
  }
  if (seen.has(normalized)) throw new Error(`label ${index + 1} duplicates an earlier label`);
  seen.add(normalized);
  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function estimateTextWidthPx(value: string, fontSizePx: number): number {
  return value.length * fontSizePx * ESTIMATED_CHARACTER_WIDTH;
}

export function fitTextToWidth(value: string, maximumWidthPx: number, fontSizePx: number): string {
  const maximumCharacters = Math.max(
    1,
    Math.floor((maximumWidthPx - 8) / (fontSizePx * ESTIMATED_CHARACTER_WIDTH)),
  );
  const characters = Array.from(value);
  if (characters.length <= maximumCharacters) return value;
  if (maximumCharacters === 1) return "…";
  return `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

export function paddedDomain(values: readonly number[]): [number, number] {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.06 || 1;
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.06;
  return [minimum - padding, maximum + padding];
}

export function formatNumber(value: number): string {
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(1)
    : Number(value.toFixed(2)).toString();
}

export function getAccessibleDescription(summary: string, fallback: string): string {
  return Buffer.byteLength(summary, "utf8") <= MAX_SVG_ACCESSIBLE_DESCRIPTION_BYTES
    ? summary
    : fallback;
}

type SvgDocumentOptions = {
  widthPx: number;
  heightPx: number;
  viewBoxWidthPx: number;
  viewBoxHeightPx: number;
  fontFamily: string;
  ariaLabel: string;
  ariaDescription?: string;
  content: string;
};

export function renderSvgDocument(options: SvgDocumentOptions): string {
  const description =
    options.ariaDescription === undefined
      ? ""
      : ` aria-description="${escapeXml(options.ariaDescription)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.widthPx}" height="${options.heightPx}" viewBox="0 0 ${options.viewBoxWidthPx} ${options.viewBoxHeightPx}" role="img" font-family="${escapeXml(options.fontFamily)}" aria-label="${escapeXml(options.ariaLabel)}"${description}>${options.content}</svg>`;
}

type DeserializedChartSettings = {
  imageWidthCells: number;
  fontFamily: string | undefined;
  fontSize?: number;
};

type ChartDetailsFactory<TData, TDetails extends ChartDetails> = (
  data: TData,
  settings: DeserializedChartSettings,
) => TDetails;

export function deserializeChartDetails<TData, TDetails extends ChartDetails>(
  value: unknown,
  schema: TSchema,
  validate: (input: Record<string, unknown>) => TData,
  createDetails: ChartDetailsFactory<TData, TDetails>,
): TDetails | undefined {
  if (!Value.Check(schema, value) || !isRecord(value)) return undefined;
  const { imageWidthCells, fontFamily, fontSize, ...input } = value;
  if (typeof imageWidthCells !== "number" || !Number.isFinite(imageWidthCells)) return undefined;
  if (fontFamily !== undefined && typeof fontFamily !== "string") return undefined;
  if (fontSize !== undefined && typeof fontSize !== "number") return undefined;
  try {
    const data = validate(input);
    return createDetails(data, {
      imageWidthCells,
      fontFamily,
      ...(fontSize === undefined ? {} : { fontSize }),
    });
  } catch {
    return undefined;
  }
}

export type CartesianAxisLayout = {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  tickFontSizePx: number;
};

type CartesianAxesOptions = {
  layout: CartesianAxisLayout;
  xDomain: readonly [number, number];
  yDomain: readonly [number, number];
  xTicks: readonly number[];
  yTicks: readonly number[];
  foreground: string;
  fontFamily: string;
  formatXTick: (value: number) => string;
  formatYTick: (value: number) => string;
};

export function renderCartesianAxes(options: CartesianAxesOptions): {
  xAxis: string;
  yAxis: string;
} {
  const { layout, xDomain, yDomain } = options;
  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const xAxisY = layout.plotY + layout.plotHeightPx;
  const xAxis = options.xTicks
    .map((value) => {
      const x = layout.plotX + ((value - xDomain[0]) / xSpan) * layout.plotWidthPx;
      return `<line x1="${x}" x2="${x}" y1="${xAxisY}" y2="${xAxisY + 4}" stroke="${options.foreground}"/><text x="${x}" y="${xAxisY + layout.tickFontSizePx + 6}" text-anchor="middle" fill="${options.foreground}" font-family="${escapeXml(options.fontFamily)}" font-size="${layout.tickFontSizePx}">${escapeXml(options.formatXTick(value))}</text>`;
    })
    .join("");
  const yAxis = options.yTicks
    .map((value) => {
      const y = layout.plotY + (1 - (value - yDomain[0]) / ySpan) * layout.plotHeightPx;
      return `<line x1="${layout.plotX - 4}" x2="${layout.plotX}" y1="${y}" y2="${y}" stroke="${options.foreground}"/><text x="${layout.plotX - 7}" y="${y + layout.tickFontSizePx * 0.35}" text-anchor="end" fill="${options.foreground}" font-family="${escapeXml(options.fontFamily)}" font-size="${layout.tickFontSizePx}">${escapeXml(options.formatYTick(value))}</text>`;
    })
    .join("");
  return { xAxis, yAxis };
}
