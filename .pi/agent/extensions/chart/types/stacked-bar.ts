import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  rect,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type StackedBarChartInput, stackedBarChartVariant } from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  escapeXml,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

export type { StackedBarChartInput };
export { stackedBarChartVariant };
export type StackedBarChartData = Omit<StackedBarChartInput, "type" | "normalize"> & {
  normalize: boolean;
};
export type StackedBarChartDetails = ChartDetails & StackedBarChartData & { type: "stacked_bar" };
export type StackedBarChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  fontSizePx: number;
};

// Fixed series-index colors keep identity stable across rows, including all-zero series.
const COLORS = ["#579aca", "#e69f57", "#70ad89", "#b48ac6", "#d76d85", "#c3b45b"];

export function validateStackedBarChartInput(input: StackedBarChartInput): StackedBarChartData {
  if (!Value.Check(stackedBarChartVariant, input))
    throw new Error("invalid stacked bar chart parameters");
  const labels = (values: string[], name: string) => {
    const normalized = values.map((value) => value.trim());
    if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length)
      throw new Error(`${name} must contain unique nonblank labels after trimming`);
    return normalized;
  };
  const categories = labels(input.categories, "categories");
  labels(
    input.series.map((series) => series.name),
    "series names",
  );
  const series = input.series.map((series) => {
    if (series.values.length !== categories.length)
      throw new Error("each series values array must match categories");
    if (series.values.some((value) => !Number.isFinite(value) || value < 0))
      throw new Error("stacked bar values must be finite nonnegative composition values");
    return { name: series.name.trim(), values: [...series.values] };
  });
  const text = (value: string | undefined, name: string) => {
    if (value?.trim() === "") throw new Error(`${name} must not be blank`);
    return value?.trim();
  };
  const title = text(input.title, "title");
  const xLabel = text(input.xLabel, "xLabel");
  const yLabel = text(input.yLabel, "yLabel");
  const data = {
    categories,
    series,
    normalize: input.normalize ?? false,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
  if (getStackedBarTotals(data).some((total) => !Number.isFinite(total)))
    throw new Error("stacked bar category totals must be finite");
  return data;
}

const detailsSchema = Type.Object(
  {
    ...stackedBarChartVariant.properties,
    normalize: Type.Boolean(),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeStackedBarChartDetails(
  value: unknown,
): StackedBarChartDetails | undefined {
  if (!Value.Check(detailsSchema, value) || !Number.isFinite(value.imageWidthCells))
    return undefined;
  const { imageWidthCells, fontFamily, fontSize, ...input } = value;
  try {
    return {
      type: "stacked_bar",
      ...validateStackedBarChartInput(input),
      imageWidthCells,
      fontFamily,
      ...(fontSize === undefined ? {} : { fontSize }),
    };
  } catch {
    return undefined;
  }
}

export function getStackedBarTotals(details: StackedBarChartData): number[] {
  return details.categories.map((_, index) =>
    details.series.reduce((total, series) => total + (series.values[index] ?? 0), 0),
  );
}

export function getStackedBarDomain(details: StackedBarChartData): [number, number] {
  // Only the all-zero raw chart needs a fallback extent; nonzero subnormal totals remain representable.
  return [0, details.normalize ? 100 : Math.max(...getStackedBarTotals(details)) || 1];
}

export function getStackedBarChartLayout(
  details: StackedBarChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): StackedBarChartLayout {
  const cells = validCellDimensions(cellDimensions ?? { widthPx: NaN, heightPx: NaN });
  const widthPx = Math.max(1, Math.round(width * cells.widthPx));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const plotX = Math.min(
    widthPx * 0.4,
    Math.max(...details.categories.map((label) => label.length)) * fontSizePx * 0.65 +
      fontSizePx * (details.yLabel ? 2.5 : 1),
  );
  const plotY = fontSizePx * (details.title ? 2.5 : 1);
  const plotWidthPx = Math.max(1, widthPx - plotX - Math.min(fontSizePx, widthPx * 0.1));
  const plotHeightPx = details.categories.length * Math.max(cells.heightPx * 1.5, fontSizePx * 1.8);
  // One legend entry per line avoids collisions without hiding zero-valued series.
  const heightPx = Math.ceil(
    plotY + plotHeightPx + fontSizePx * ((details.xLabel ? 4 : 2.5) + details.series.length * 1.4),
  );
  return {
    widthPx,
    heightPx,
    heightCells: Math.ceil(heightPx / cells.heightPx),
    plotX,
    plotY,
    plotWidthPx,
    plotHeightPx,
    fontSizePx,
  };
}

export function getStackedBarChartSummary(details: StackedBarChartDetails): string {
  const totals = getStackedBarTotals(details);
  return `${details.title ?? "Stacked bar"}; ${details.normalize ? "100% normalized; raw values and totals" : "Raw values and totals"}${details.xLabel ? `; X: ${details.xLabel}` : ""}${details.yLabel ? `; Y: ${details.yLabel}` : ""}: ${details.categories.map((label, index) => `${label}: ${details.series.map((series) => `${series.name}=${series.values[index]}`).join(", ")}, total=${totals[index]}`).join("; ")}`;
}

export function renderStackedBarChartSvg(
  details: StackedBarChartDetails,
  theme: ChartTheme,
  layout = getStackedBarChartLayout(details),
): string {
  const totals = getStackedBarTotals(details);
  const [, max] = getStackedBarDomain(details);
  const font = layout.fontSizePx;
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const segments = details.categories.flatMap((_, row) => {
    let cumulative = 0;
    const total = totals[row] ?? 0;
    // Divide before multiplying by 100, protecting subnormal totals and exact zero rows.
    const position = (value: number) =>
      details.normalize ? (total === 0 ? 0 : (value / total) * 100) : value;
    return details.series.map((series, index) => {
      const start = position(cumulative);
      cumulative += series.values[row] ?? 0;
      return { row, series: index, start, end: position(cumulative) };
    });
  });
  const scene = createChartScene(
    defineChart({
      marks: COLORS.slice(0, details.series.length).map((color, index) =>
        rect(
          segments.filter((segment) => segment.series === index),
          {
            // Unit coordinates avoid a reciprocal overflow in linear scales for subnormal raw domains.
            x1: (segment) => segment.start / max,
            x2: (segment) => segment.end / max,
            y1: (segment) => details.categories.length - segment.row - 0.8,
            y2: (segment) => details.categories.length - segment.row - 0.2,
            key: (segment) => `series-${index}-row-${segment.row}`,
            fill: color,
            inset: 0,
          },
        ),
      ),
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, details.categories.length]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  const plot = renderTanStackChartSvg(scene, {
    ariaLabel: "Stacked bars",
    idPrefix: "pi-stacked-bar",
  })
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const text = (value: string, x: number, y: number, anchor = "middle", extra = "") =>
    `<text x="${x}" y="${y}" font-size="${font}" text-anchor="${anchor}" fill="${foreground}" ${extra}>${escapeXml(value)}</text>`;
  const shorten = (value: string, space: number) => {
    const length = Math.max(0, Math.floor(space / font));
    return length === 0 ? "" : value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  };
  const labels = details.categories
    .map((label, i) =>
      text(
        shorten(label, layout.plotX - font * (details.yLabel ? 2 : 0.5)),
        layout.plotX - font * 0.35,
        layout.plotY + ((i + 0.5) * layout.plotHeightPx) / details.categories.length + font * 0.35,
        "end",
      ),
    )
    .join("");
  const tickCount = layout.plotWidthPx >= font * 26 ? 3 : layout.plotWidthPx >= font * 12 ? 2 : 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const ratio = tickCount === 1 ? 0.5 : i / (tickCount - 1);
    const value = `${Number((max * ratio).toPrecision(3))}${details.normalize ? "%" : ""}`;
    return text(
      shorten(value, layout.plotWidthPx / tickCount),
      layout.plotX + ratio * layout.plotWidthPx,
      layout.plotY + layout.plotHeightPx + font * 1.3,
      tickCount === 1 ? "middle" : i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle",
    );
  }).join("");
  const middleY = layout.plotY + layout.plotHeightPx / 2;
  const annotations =
    (details.title ? text(shorten(details.title, layout.widthPx - 16), 8, font, "start") : "") +
    (details.xLabel
      ? text(
          shorten(details.xLabel, layout.plotWidthPx),
          layout.plotX + layout.plotWidthPx / 2,
          layout.plotY + layout.plotHeightPx + font * 2.8,
        )
      : "") +
    (details.yLabel
      ? text(
          shorten(details.yLabel, layout.plotHeightPx),
          font,
          middleY,
          "middle",
          `transform="rotate(-90 ${font} ${middleY})"`,
        )
      : "");
  const legend = details.series
    .map((series, index) => {
      const y = layout.heightPx - font * (0.5 + (details.series.length - 1 - index) * 1.4);
      const size = Math.min(font * 0.7, layout.widthPx * 0.1);
      return (
        `<rect x="0" y="${y - size}" width="${size}" height="${size}" fill="${COLORS[index]}"/>` +
        text(
          shorten(series.name, layout.widthPx - size - font * 0.5),
          size + font * 0.3,
          y,
          "start",
        )
      );
    })
    .join("");
  const name = details.title ?? "Stacked bar";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx * RASTER_DENSITY}" height="${layout.heightPx * RASTER_DENSITY}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY)}" aria-label="${escapeXml(name)}"><title>${escapeXml(name)}</title><desc>${escapeXml(getStackedBarChartSummary(details))}</desc><g data-stacked-bars="true" transform="translate(${layout.plotX} ${layout.plotY})">${plot}</g>${labels}${ticks}${annotations}${legend}</svg>`;
}

export const stackedBarChartRenderer: ChartType<
  typeof stackedBarChartVariant,
  StackedBarChartData,
  StackedBarChartDetails,
  StackedBarChartLayout
> = {
  renderingText: "Rendering stacked bar chart…",
  unavailableText: "Stacked bar chart unavailable",
  parameters: stackedBarChartVariant,
  parseParameters: validateStackedBarChartInput,
  createDetails: (data, settings) => ({ type: "stacked_bar", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getStackedBarChartSummary,
  getLayout: getStackedBarChartLayout,
  renderSvg: renderStackedBarChartSvg,
  deserializeDetails: deserializeStackedBarChartDetails,
};
