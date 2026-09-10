import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  lineY,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import {
  type LineChartInput,
  lineChartVariant,
  MAX_AXIS_LABEL_LENGTH,
  MAX_ROWS,
  MAX_TITLE_LENGTH,
  numericLineChartVariant,
  temporalLineChartVariant,
} from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartSettings,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  DEFAULT_IMAGE_WIDTH_CELLS,
  escapeXml,
  getChartColors,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

import {
  clamp,
  clampChartPlotHeightPx,
  finalizeChartLayout,
  formatNumeric,
  getChartHeightLimitPx,
  isRecord,
  isValidChartHeight,
  normalizeBoundedText,
  paddedDomain,
  renderCartesianAxes,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { LineChartInput };
export { lineChartVariant, numericLineChartVariant, temporalLineChartVariant };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_UTC_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type LineChartRow = { x: number; y: number | null; xLabel: string };
export type LineChartData = {
  xType: "numeric" | "temporal";
  rows: LineChartRow[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  markers: boolean;
  maxHeightCells?: number;
  xFormat?: "number" | "percent";
  yFormat?: "number" | "percent";
};
export type LineChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  tickFontSizePx: number;
  axisLabelFontSizePx: number;
  titleFontSizePx: number;
};
export type LineChartDetails = ChartDetails &
  LineChartData & {
    type: "line";
  };

function parseTemporalX(value: string, index: number): number {
  const date = ISO_DATE.exec(value);
  if (date !== null) {
    const year = Number(date[1]);
    const month = Number(date[2]);
    const day = Number(date[3]);
    const epoch = Date.UTC(year, month - 1, day);
    const parsed = new Date(epoch);
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throw new Error(`x ${index + 1} must be a valid ISO date or UTC datetime`);
    }
    return epoch;
  }
  if (ISO_UTC_DATETIME.test(value) === false) {
    throw new Error(`x ${index + 1} must be a valid ISO date or UTC datetime`);
  }
  const epoch = Date.parse(value);
  if (Number.isFinite(epoch) === false) {
    throw new Error(`x ${index + 1} must be a valid ISO date or UTC datetime`);
  }
  return epoch;
}

export function validateLineChartInput(input: LineChartInput): LineChartData {
  if (input.data.length < 2 || input.data.length > MAX_ROWS) {
    throw new Error(`provide between 2 and ${MAX_ROWS} rows`);
  }
  let previousX = Number.NEGATIVE_INFINITY;
  const rows = input.data.map((row, index) => {
    const x =
      input.xType === "numeric"
        ? typeof row.x === "number"
          ? row.x
          : Number.NaN
        : typeof row.x === "string"
          ? parseTemporalX(row.x, index)
          : Number.NaN;
    if (Number.isFinite(x) === false) throw new Error(`x ${index + 1} must be a finite number`);
    if (x <= previousX) throw new Error(`x ${index + 1} must be strictly increasing`);
    previousX = x;
    if (row.y !== null && Number.isFinite(row.y) === false) {
      throw new Error(`y ${index + 1} must be a finite number or null`);
    }
    return { x, y: row.y, xLabel: String(row.x) };
  });
  if (rows.every((row) => row.y === null)) throw new Error("provide at least one numeric y value");

  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  const xLabel = normalizeBoundedText(input.xLabel, "xLabel", MAX_AXIS_LABEL_LENGTH);
  const yLabel = normalizeBoundedText(input.yLabel, "yLabel", MAX_AXIS_LABEL_LENGTH);
  return {
    xType: input.xType,
    rows,
    markers: input.markers ?? false,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
    ...(input.xType === "numeric" && input.xFormat !== undefined ? { xFormat: input.xFormat } : {}),
    ...(input.yFormat === undefined ? {} : { yFormat: input.yFormat }),
  };
}

function isLineChartRow(value: unknown): value is LineChartRow {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    (value.y === null || (typeof value.y === "number" && Number.isFinite(value.y))) &&
    typeof value.xLabel === "string"
  );
}

export function deserializeLineChartDetails(value: unknown): LineChartDetails | undefined {
  if (
    isRecord(value) === false ||
    value.type !== "line" ||
    (value.xType !== "numeric" && value.xType !== "temporal") ||
    Array.isArray(value.rows) === false ||
    value.rows.length < 2 ||
    value.rows.length > MAX_ROWS ||
    value.rows.every(isLineChartRow) === false ||
    typeof value.markers !== "boolean" ||
    typeof value.imageWidthCells !== "number" ||
    Number.isFinite(value.imageWidthCells) === false ||
    value.imageWidthCells <= 0
  ) {
    return undefined;
  }
  for (let index = 1; index < value.rows.length; index++) {
    if (
      (value.rows[index - 1]?.x ?? Number.POSITIVE_INFINITY) >=
      (value.rows[index]?.x ?? Number.NEGATIVE_INFINITY)
    ) {
      return undefined;
    }
  }
  if (value.rows.every((row) => row.y === null)) return undefined;
  if (
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.xLabel !== undefined && typeof value.xLabel !== "string") ||
    (value.yLabel !== undefined && typeof value.yLabel !== "string") ||
    (value.fontFamily !== undefined && typeof value.fontFamily !== "string") ||
    (value.maxHeightCells !== undefined && !isValidChartHeight(value.maxHeightCells)) ||
    (value.xFormat !== undefined &&
      (value.xType === "temporal" ||
        (value.xFormat !== "number" && value.xFormat !== "percent"))) ||
    (value.yFormat !== undefined && value.yFormat !== "number" && value.yFormat !== "percent") ||
    (value.fontSize !== undefined &&
      (typeof value.fontSize !== "number" ||
        !Number.isFinite(value.fontSize) ||
        value.fontSize < MIN_FONT_SIZE_PX ||
        value.fontSize > MAX_FONT_SIZE_PX))
  ) {
    return undefined;
  }
  return value as LineChartDetails;
}

export function getLineChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  hasTitle = false,
  hasXLabel = false,
  hasYLabel = false,
  fontSize?: number,
  maxHeightCells?: number,
): LineChartLayout {
  const dimensions = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const paddingPx = Math.max(8, Math.round(dimensions.widthPx * 1.2));
  const tickFontSizePx =
    fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.61), 10, scaleChartFontSize(14, dimensions))
      : Math.round(scaleChartFontSize(fontSize, dimensions) * 0.85);
  const axisLabelFontSizePx =
    fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.66), 10, scaleChartFontSize(15, dimensions))
      : scaleChartFontSize(fontSize, dimensions);
  const titleFontSizePx =
    fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.75), 11, scaleChartFontSize(16, dimensions))
      : Math.round(scaleChartFontSize(fontSize, dimensions) * 1.1);
  const titleHeightPx = hasTitle ? titleFontSizePx + paddingPx : 0;
  const xLabelHeightPx = hasXLabel ? axisLabelFontSizePx + paddingPx : 0;
  const yLabelWidthPx = hasYLabel ? axisLabelFontSizePx + paddingPx : 0;
  const tickLabelHeightPx = tickFontSizePx + paddingPx;
  const tickLabelWidthPx =
    fontSize === undefined
      ? Math.max(Math.round(dimensions.widthPx * 6), tickFontSizePx * 4)
      : Math.max(Math.round(dimensions.widthPx * 6), Math.round(tickFontSizePx * 4));
  const plotX = paddingPx + yLabelWidthPx + tickLabelWidthPx;
  const plotY = paddingPx + titleHeightPx;
  const plotWidthPx = Math.max(Math.round(dimensions.widthPx * 10), widthPx - plotX - paddingPx);
  const fixedHeightPx = plotY + tickLabelHeightPx + xLabelHeightPx + paddingPx;
  const naturalPlotHeightPx = Math.round(dimensions.heightPx * 8);
  const clampedPlotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    maxHeightCells,
    dimensions.heightPx,
    fixedHeightPx,
  );
  const plotHeightPx =
    maxHeightCells === undefined
      ? clamp(
          clampedPlotHeightPx,
          Math.round(dimensions.heightPx * 5),
          getChartHeightLimitPx(undefined, dimensions.heightPx) - fixedHeightPx,
        )
      : clampedPlotHeightPx;
  const heightPx = plotY + plotHeightPx + tickLabelHeightPx + xLabelHeightPx + paddingPx;
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
    dimensions.heightPx,
    maxHeightCells,
  );
}

function formatTemporalTick(epoch: number, span: number): string {
  const date = new Date(epoch);
  if (span < 86_400_000 * 2) return date.toISOString().slice(11, 16);
  if (span < 86_400_000 * 370) return date.toISOString().slice(5, 10);
  return date.toISOString().slice(0, 10);
}

export function renderLineChartSvg(
  details: LineChartDetails,
  theme: ChartTheme,
  layout = getLineChartLayout(
    undefined,
    DEFAULT_IMAGE_WIDTH_CELLS,
    details.title !== undefined,
    details.xLabel !== undefined,
    details.yLabel !== undefined,
    details.fontSize,
  ),
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  const xValues = details.rows.map((row) => row.x);
  const yValues = details.rows.flatMap((row) => (row.y === null ? [] : [row.y]));
  const xDomain: [number, number] = [xValues[0] ?? 0, xValues.at(-1) ?? 1];
  const yDomain = paddedDomain(yValues);
  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);
  const color = getChartColors(theme)[0] ?? "currentColor";
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const definition = defineChart({
    marks: [lineY(details.rows, { x: "x", y: "y", stroke: color, points: details.markers })],
    scales: {
      x: { scale: xScale, axis: false },
      y: { scale: yScale, axis: false },
    },
  });
  const scene = createChartScene(definition, {
    width: layout.plotWidthPx,
    height: layout.plotHeightPx,
  });
  const accessibleName =
    details.title === undefined ? "Line chart" : `Line chart: ${details.title}`;
  const chart = renderTanStackChartSvg(scene, { ariaLabel: accessibleName, idPrefix: "pi-line" });
  const chartBody = stripTanStackSvg(chart);
  const xAxisY = layout.plotY + layout.plotHeightPx;
  const xTicks = xScale.ticks(layout.plotWidthPx < 250 ? 3 : 5);
  const yTicks = yScale.ticks(5);
  const xSpan = xDomain[1] - xDomain[0];
  const tickText = (value: number) =>
    details.xType === "temporal"
      ? formatTemporalTick(value, xSpan)
      : formatNumeric(value, details.xFormat);
  const { xAxis, yAxis } = renderCartesianAxes({
    layout,
    xDomain,
    yDomain,
    xTicks,
    yTicks,
    foreground,
    fontFamily,
    formatXTick: tickText,
    formatYTick: (value) => formatNumeric(value, details.yFormat),
  });
  const title =
    details.title === undefined
      ? ""
      : `<text x="${layout.plotX}" y="${layout.plotY - 8}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.titleFontSizePx}">${escapeXml(details.title)}</text>`;
  const xLabel =
    details.xLabel === undefined
      ? ""
      : `<text x="${layout.plotX + layout.plotWidthPx / 2}" y="${layout.heightPx - 8}" text-anchor="middle" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.axisLabelFontSizePx}">${escapeXml(details.xLabel)}</text>`;
  const yLabel =
    details.yLabel === undefined
      ? ""
      : `<text x="${layout.axisLabelFontSizePx}" y="${layout.plotY + layout.plotHeightPx / 2}" text-anchor="middle" transform="rotate(-90 ${layout.axisLabelFontSizePx} ${layout.plotY + layout.plotHeightPx / 2})" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.axisLabelFontSizePx}">${escapeXml(details.yLabel)}</text>`;
  const rasterWidthPx = layout.widthPx * RASTER_DENSITY;
  const rasterHeightPx = layout.heightPx * RASTER_DENSITY;
  const description = details.rows.map((row) => `${row.xLabel}: ${row.y ?? "no value"}`).join(", ");
  return renderSvgDocument({
    widthPx: rasterWidthPx,
    heightPx: rasterHeightPx,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: fontFamily,
    ariaLabel: accessibleName,
    ariaDescription: description,
    content: `${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}</g><line x1="${layout.plotX}" x2="${layout.plotX + layout.plotWidthPx}" y1="${xAxisY}" y2="${xAxisY}" stroke="${foreground}"/><line x1="${layout.plotX}" x2="${layout.plotX}" y1="${layout.plotY}" y2="${xAxisY}" stroke="${foreground}"/>${xAxis}${yAxis}${title}${xLabel}${yLabel}`,
  });
}

export function getLineChartSummary(details: LineChartDetails): string {
  return `${details.title === undefined ? "Line chart" : `${details.title} line chart`}: ${details.rows.map((row) => `${row.xLabel} ${row.y ?? "gap"}`).join("; ")}`;
}

export const lineChartRenderer: ChartType<
  typeof lineChartVariant,
  LineChartData,
  LineChartDetails,
  LineChartLayout
> = {
  renderingText: "Rendering line chart…",
  unavailableText: "Line chart unavailable",
  parameters: lineChartVariant,
  parseParameters: validateLineChartInput,
  createDetails(data: LineChartData, settings: ChartSettings): LineChartDetails {
    return {
      type: "line",
      ...data,
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters: LineChartInput): string {
    const title = normalizeBoundedText(parameters.title, "title", MAX_TITLE_LENGTH);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getLineChartSummary,
  getLayout(details, cellDimensions, widthCells): LineChartLayout {
    return getLineChartLayout(
      cellDimensions,
      widthCells,
      details.title !== undefined,
      details.xLabel !== undefined,
      details.yLabel !== undefined,
      details.fontSize,
      details.maxHeightCells,
    );
  },
  renderSvg(details, theme, layout): string {
    return renderLineChartSvg(details, theme, layout, details.fontFamily);
  },
  deserializeDetails: deserializeLineChartDetails,
};
