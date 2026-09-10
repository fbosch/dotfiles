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
import {
  type HistogramChartInput,
  histogramChartVariant,
  MAX_AXIS_LABEL_LENGTH,
  MAX_HISTOGRAM_BINS,
  MAX_HISTOGRAM_SAMPLES,
  MAX_REQUESTED_CHART_HEIGHT_CELLS,
  MAX_TITLE_LENGTH,
  MIN_CHART_HEIGHT_CELLS,
} from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  DEFAULT_IMAGE_WIDTH_CELLS,
  escapeXml,
  getChartColors,
  MAX_CHART_HEIGHT_CELLS,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

import {
  clampChartPlotHeightPx,
  finalizeChartLayout,
  isValidChartHeight,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { HistogramChartInput };
export { histogramChartVariant };

export type HistogramBin = { lower: number; upper: number; count: number };
export type HistogramChartData = {
  rows: HistogramBin[];
  title?: string;
  xLabel?: string;
  yLabel: string;
  maxHeightCells?: number;
};
export type HistogramChartDetails = ChartDetails & HistogramChartData & { type: "histogram" };
export type HistogramChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  tickFontSizePx: number;
  axisLabelFontSizePx: number;
  titleFontSizePx: number;
};

function normalizeText(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (text.length === 0) throw new Error(`${name} must not be blank`);
  return text;
}

export function validateHistogramChartInput(input: HistogramChartInput): HistogramChartData {
  if (!Value.Check(histogramChartVariant, input))
    throw new Error("invalid histogram chart parameters");
  for (const sample of input.data) {
    if (!Number.isFinite(sample)) throw new Error("histogram samples must be finite numbers");
  }
  let lower = Math.min(...input.data);
  let upper = Math.max(...input.data);
  let count = input.bins ?? Math.min(MAX_HISTOGRAM_BINS, Math.ceil(Math.sqrt(input.data.length)));
  if (lower === upper) {
    // A constant sample has no measurable spread; show one centered bin even if bins was supplied.
    const padding = Math.max(0.5, Math.abs(lower) * 0.01);
    lower -= padding;
    upper += padding;
    count = 1;
  }
  const span = upper - lower;
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(span) || span <= 0) {
    throw new Error("histogram range cannot be represented; rescale the samples");
  }
  const edges = Array.from({ length: count + 1 }, (_, index) =>
    index === count ? upper : lower + span * (index / count),
  );
  const rows = Array.from({ length: count }, (_, index) => {
    const start = edges[index];
    const end = edges[index + 1];
    if (start === undefined || end === undefined || !Number.isFinite(end) || end <= start) {
      throw new Error(
        "histogram bin boundaries cannot be represented; use fewer bins or rescale the samples",
      );
    }
    return { lower: start, upper: end, count: 0 };
  });
  for (const sample of input.data) {
    // Compare with the stored boundaries, not a rounded quotient, so exact edges go to the right bin.
    const row = rows.find((bin, index) => sample < bin.upper || index === rows.length - 1);
    if (row !== undefined) row.count++;
  }
  const title = normalizeText(input.title, "title");
  const xLabel = normalizeText(input.xLabel, "xLabel");
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    yLabel: normalizeText(input.yLabel, "yLabel") ?? "Count",
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

const detailsSchema = Type.Object(
  {
    type: Type.Literal("histogram"),
    rows: Type.Array(
      Type.Object(
        {
          lower: Type.Number(),
          upper: Type.Number(),
          count: Type.Integer({ minimum: 0, maximum: MAX_HISTOGRAM_SAMPLES }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: MAX_HISTOGRAM_BINS },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH })),
    xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
    yLabel: Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH }),
    maxHeightCells: Type.Optional(
      Type.Integer({ minimum: MIN_CHART_HEIGHT_CELLS, maximum: MAX_REQUESTED_CHART_HEIGHT_CELLS }),
    ),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.Optional(Type.String()),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeHistogramChartDetails(
  value: unknown,
): HistogramChartDetails | undefined {
  if (!Value.Check(detailsSchema, value)) return undefined;
  const total = value.rows.reduce((sum, row) => sum + row.count, 0);
  if (total < 1 || total > MAX_HISTOGRAM_SAMPLES || !Number.isFinite(value.imageWidthCells))
    return undefined;
  if (!isValidChartHeight(value.maxHeightCells) && value.maxHeightCells !== undefined)
    return undefined;
  if (
    value.rows.some(
      (row, index) =>
        !Number.isFinite(row.lower) ||
        !Number.isFinite(row.upper) ||
        row.upper <= row.lower ||
        (index > 0 && value.rows[index - 1]?.upper !== row.lower),
    )
  )
    return undefined;
  const first = value.rows[0];
  const last = value.rows[value.rows.length - 1];
  if (!first || !last || !Number.isFinite(last.upper - first.lower)) return undefined;
  return value;
}

export function getHistogramChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  hasTitle = false,
  hasXLabel = false,
  fontSize?: number,
  maxHeightCells?: number,
): HistogramChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * cells.widthPx);
  const axisLabelFontSizePx = scaleChartFontSize(fontSize ?? 14, cells);
  const tickFontSizePx = Math.round(axisLabelFontSizePx * 0.85);
  const titleFontSizePx = Math.round(axisLabelFontSizePx * 1.1);
  const padding = Math.max(8, Math.round(cells.widthPx));
  const plotX = padding + axisLabelFontSizePx + tickFontSizePx * 3;
  const plotY = padding + (hasTitle ? titleFontSizePx + padding : 0);
  const plotWidthPx = Math.max(1, widthPx - plotX - padding * 3);
  const bottomHeightPx =
    tickFontSizePx + padding * 2 + (hasXLabel ? axisLabelFontSizePx + padding : 0);
  const naturalPlotHeightPx = Math.max(
    1,
    Math.min(cells.heightPx * 8, MAX_CHART_HEIGHT_CELLS * cells.heightPx - plotY - bottomHeightPx),
  );
  const plotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    maxHeightCells,
    cells.heightPx,
    plotY + bottomHeightPx,
    MAX_CHART_HEIGHT_CELLS,
  );
  const heightPx = Math.ceil(plotY + plotHeightPx + bottomHeightPx);
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX,
      plotY,
      plotWidthPx,
      plotHeightPx,
      tickFontSizePx,
      axisLabelFontSizePx,
      titleFontSizePx,
    },
    cells.heightPx,
    maxHeightCells,
  );
}

function interval(row: HistogramBin, last: boolean): string {
  return `[${row.lower}, ${row.upper}${last ? "]" : ")"}`;
}

export function getHistogramChartSummary(details: HistogramChartDetails): string {
  return `${details.title ?? "Histogram"}: ${details.rows.map((row, index) => `${interval(row, index === details.rows.length - 1)}: ${row.count}`).join("; ")}`;
}

export function renderHistogramChartSvg(
  details: HistogramChartDetails,
  theme: ChartTheme,
  layout = getHistogramChartLayout(
    undefined,
    details.imageWidthCells,
    details.title !== undefined,
    details.xLabel !== undefined,
    details.fontSize,
    details.maxHeightCells,
  ),
  fontFamily = details.fontFamily ?? DEFAULT_FONT_FAMILY,
): string {
  const first = details.rows[0];
  const last = details.rows[details.rows.length - 1];
  if (!first || !last) throw new Error("histogram has no bins");
  const span = last.upper - first.lower;
  const peak = Math.max(...details.rows.map((row) => row.count));
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const color = getChartColors(theme)[0] ?? "#6aa5ad";
  const baseline = layout.plotY + layout.plotHeightPx;
  const x = (value: number) => layout.plotX + ((value - first.lower) / span) * layout.plotWidthPx;
  const text = (value: string, x: number, y: number, size: number, anchor = "middle", extra = "") =>
    `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${foreground}" ${extra}>${escapeXml(value)}</text>`;
  const scene = createChartScene(
    defineChart({
      marks: [
        rect(details.rows, {
          x1: (row) => (row.lower - first.lower) / span,
          x2: (row) => (row.upper - first.lower) / span,
          y1: () => 0,
          y2: "count",
          key: (_row, context) => context.index,
          fill: color,
          inset: 0,
        }),
      ],
      // Normalize only the display coordinates so subnormal and extreme stored ranges stay safe.
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, peak]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  let binIndex = 0;
  const bars = stripTanStackSvg(
    renderTanStackChartSvg(scene, { ariaLabel: "Histogram", idPrefix: "pi-histogram" }),
  )
    // TanStack owns rectangle geometry; retain the existing per-bin SVG titles and identities.
    .replace(/<rect\b([^>]*)\/>/g, (_rectangle, attributes: string) => {
      const index = binIndex++;
      const row = details.rows[index];
      if (!row) throw new Error("histogram rectangle has no bin");
      return `<rect data-bin="${index}"${attributes}><title>${escapeXml(interval(row, index === details.rows.length - 1))}: ${row.count}</title></rect>`;
    });
  const tickCount = layout.plotWidthPx < 300 ? 2 : 4;
  const xTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = index === tickCount ? last.upper : first.lower + span * (index / tickCount);
    return text(
      Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 0.001)
        ? value.toExponential(3)
        : Number(value.toPrecision(4)).toString(),
      x(value),
      baseline + layout.tickFontSizePx + 6,
      layout.tickFontSizePx,
      index === 0 ? "start" : index === tickCount ? "end" : "middle",
    );
  }).join("");
  const step = Math.max(1, Math.ceil(peak / 4));
  const yTicks = Array.from({ length: Math.floor(peak / step) + 1 }, (_, index) => {
    const value = index * step;
    return text(
      String(value),
      layout.plotX - 6,
      baseline - (value / peak) * layout.plotHeightPx + layout.tickFontSizePx * 0.35,
      layout.tickFontSizePx,
      "end",
    );
  }).join("");
  const middleY = layout.plotY + layout.plotHeightPx / 2;
  const labels =
    text(
      details.yLabel,
      layout.axisLabelFontSizePx,
      middleY,
      layout.axisLabelFontSizePx,
      "middle",
      `transform="rotate(-90 ${layout.axisLabelFontSizePx} ${middleY})"`,
    ) +
    (details.xLabel === undefined
      ? ""
      : text(
          details.xLabel,
          layout.plotX + layout.plotWidthPx / 2,
          layout.heightPx - 8,
          layout.axisLabelFontSizePx,
        )) +
    (details.title === undefined
      ? ""
      : text(details.title, layout.plotX, layout.plotY - 8, layout.titleFontSizePx, "start"));
  const name = details.title === undefined ? "Histogram" : `Histogram: ${details.title}`;
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: fontFamily,
    ariaLabel: name,
    content: `<title>${escapeXml(name)}</title><desc>${escapeXml(getHistogramChartSummary(details))}</desc><g transform="translate(${layout.plotX} ${layout.plotY})">${bars}</g><path d="M ${layout.plotX} ${layout.plotY} V ${baseline} H ${layout.plotX + layout.plotWidthPx}" fill="none" stroke="${foreground}"/>${xTicks}${yTicks}${labels}`,
  });
}

export const histogramChartRenderer: ChartType<
  typeof histogramChartVariant,
  HistogramChartData,
  HistogramChartDetails,
  HistogramChartLayout
> = {
  renderingText: "Rendering histogram…",
  unavailableText: "Histogram unavailable",
  parameters: histogramChartVariant,
  parseParameters: validateHistogramChartInput,
  createDetails(data, settings) {
    return { type: "histogram", ...data, ...settings };
  },
  getCallHeader(parameters) {
    return parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`;
  },
  getSummary: getHistogramChartSummary,
  getLayout(details, cells, width) {
    return getHistogramChartLayout(
      cells,
      width,
      details.title !== undefined,
      details.xLabel !== undefined,
      details.fontSize,
      details.maxHeightCells,
    );
  },
  renderSvg: renderHistogramChartSvg,
  deserializeDetails: deserializeHistogramChartDetails,
};
