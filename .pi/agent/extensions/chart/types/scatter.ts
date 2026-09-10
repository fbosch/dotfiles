import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { ScatterChartInput } from "../schemas";
import { scatterChartVariant } from "../schemas";
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
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

export type { ScatterChartInput };
export { scatterChartVariant };

const MAX_ROWS = 200;
const MAX_TITLE_LENGTH = 80;
const MAX_AXIS_LABEL_LENGTH = 40;
const MAX_POINT_LABEL_LENGTH = 40;
const DOT_RADIUS_PX = 4;

export type ScatterChartRow = { x: number; y: number; label?: string };
export type ScatterChartData = {
  rows: ScatterChartRow[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
};
export type ScatterChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  tickFontSizePx: number;
  axisLabelFontSizePx: number;
  titleFontSizePx: number;
  pointLabelFontSizePx: number;
};
export type ScatterChartDetails = ChartDetails & ScatterChartData & { type: "scatter" };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeText(
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

export function validateScatterChartInput(input: ScatterChartInput): ScatterChartData {
  if (input.data.length < 2 || input.data.length > MAX_ROWS) {
    throw new Error(`provide between 2 and ${MAX_ROWS} rows`);
  }
  const rows = input.data.map((row, index) => {
    if (Number.isFinite(row.x) === false) throw new Error(`x ${index + 1} must be a finite number`);
    if (Number.isFinite(row.y) === false) throw new Error(`y ${index + 1} must be a finite number`);
    const label = normalizeText(row.label, `label ${index + 1}`, MAX_POINT_LABEL_LENGTH);
    return { x: row.x, y: row.y, ...(label === undefined ? {} : { label }) };
  });
  const title = normalizeText(input.title, "title", MAX_TITLE_LENGTH);
  const xLabel = normalizeText(input.xLabel, "xLabel", MAX_AXIS_LABEL_LENGTH);
  const yLabel = normalizeText(input.yLabel, "yLabel", MAX_AXIS_LABEL_LENGTH);
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isScatterChartRow(value: unknown): value is ScatterChartRow {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    (value.label === undefined || typeof value.label === "string")
  );
}

export function deserializeScatterChartDetails(value: unknown): ScatterChartDetails | undefined {
  if (
    isRecord(value) === false ||
    value.type !== "scatter" ||
    Array.isArray(value.rows) === false ||
    value.rows.length < 2 ||
    value.rows.length > MAX_ROWS ||
    value.rows.every(isScatterChartRow) === false ||
    typeof value.imageWidthCells !== "number" ||
    Number.isFinite(value.imageWidthCells) === false ||
    value.imageWidthCells <= 0 ||
    (value.title !== undefined && typeof value.title !== "string") ||
    (value.xLabel !== undefined && typeof value.xLabel !== "string") ||
    (value.yLabel !== undefined && typeof value.yLabel !== "string") ||
    (value.fontFamily !== undefined && typeof value.fontFamily !== "string") ||
    (value.fontSize !== undefined &&
      (typeof value.fontSize !== "number" ||
        Number.isFinite(value.fontSize) === false ||
        value.fontSize < MIN_FONT_SIZE_PX ||
        value.fontSize > MAX_FONT_SIZE_PX))
  ) {
    return undefined;
  }
  return value as ScatterChartDetails;
}

export function getScatterChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  hasTitle = false,
  hasXLabel = false,
  hasYLabel = false,
  fontSize?: number,
): ScatterChartLayout {
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
  const tickLabelWidthPx = Math.max(
    Math.round(dimensions.widthPx * 6),
    Math.round(tickFontSizePx * 4),
  );
  const plotX = paddingPx + yLabelWidthPx + tickLabelWidthPx;
  const plotY = paddingPx + titleHeightPx;
  const plotWidthPx = Math.max(Math.round(dimensions.widthPx * 10), widthPx - plotX - paddingPx);
  const availablePlotHeightPx =
    Math.round(18 * dimensions.heightPx) - plotY - tickLabelHeightPx - xLabelHeightPx - paddingPx;
  const plotHeightPx = Math.max(
    1,
    Math.min(Math.round(dimensions.heightPx * 8), availablePlotHeightPx),
  );
  const heightPx = plotY + plotHeightPx + tickLabelHeightPx + xLabelHeightPx + paddingPx;
  return {
    widthPx,
    heightPx,
    heightCells: Math.ceil(heightPx / dimensions.heightPx),
    plotX,
    plotY,
    plotWidthPx,
    plotHeightPx,
    tickFontSizePx,
    axisLabelFontSizePx,
    titleFontSizePx,
    pointLabelFontSizePx: Math.max(8, Math.round(tickFontSizePx * 0.9)),
  };
}

function paddedDomain(values: number[]): [number, number] {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.06 || 1;
    return [minimum - padding, maximum + padding];
  }
  const padding = (maximum - minimum) * 0.06;
  return [minimum - padding, maximum + padding];
}

function formatNumber(value: number): string {
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(1)
    : Number(value.toFixed(2)).toString();
}

function wrapLabel(label: string, maximum = 16): string[] {
  const words = label
    .split(/\s+/u)
    .flatMap((word) =>
      Array.from({ length: Math.ceil(word.length / maximum) }, (_, index) =>
        word.slice(index * maximum, (index + 1) * maximum),
      ),
    );
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length > 0 && line.length + word.length + 1 > maximum) {
      lines.push(line);
      line = word;
    } else line = line.length === 0 ? word : `${line} ${word}`;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

export function renderScatterChartSvg(
  details: ScatterChartDetails,
  theme: ChartTheme,
  layout = getScatterChartLayout(
    undefined,
    DEFAULT_IMAGE_WIDTH_CELLS,
    details.title !== undefined,
    details.xLabel !== undefined,
    details.yLabel !== undefined,
    details.fontSize,
  ),
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  const xDomain = paddedDomain(details.rows.map((row) => row.x));
  const yDomain = paddedDomain(details.rows.map((row) => row.y));
  const xScale = scaleLinear().domain(xDomain);
  const yScale = scaleLinear().domain(yDomain);
  const color = getChartColors(theme)[0] ?? "#6aa5ad";
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const scene = createChartScene(
    defineChart({
      marks: [
        dot(details.rows, {
          x: "x",
          y: "y",
          key: (_row, context) => context.index,
          r: DOT_RADIUS_PX,
          fill: color,
        }),
      ],
      scales: { x: { scale: xScale, axis: false }, y: { scale: yScale, axis: false } },
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  const accessibleName =
    details.title === undefined ? "Scatter chart" : `Scatter chart: ${details.title}`;
  const chart = renderTanStackChartSvg(scene, {
    ariaLabel: accessibleName,
    idPrefix: "pi-scatter",
  });
  const chartBody = chart.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const xAxisY = layout.plotY + layout.plotHeightPx;
  const xTicks = xScale.ticks(layout.plotWidthPx < 250 ? 3 : 5);
  const yTicks = yScale.ticks(5);
  const xAxis = xTicks
    .map((value) => {
      const x = layout.plotX + ((value - xDomain[0]) / xSpan) * layout.plotWidthPx;
      return `<line x1="${x}" x2="${x}" y1="${xAxisY}" y2="${xAxisY + 4}" stroke="${foreground}"/><text x="${x}" y="${xAxisY + layout.tickFontSizePx + 6}" text-anchor="middle" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.tickFontSizePx}">${escapeXml(formatNumber(value))}</text>`;
    })
    .join("");
  const yAxis = yTicks
    .map((value) => {
      const y = layout.plotY + (1 - (value - yDomain[0]) / ySpan) * layout.plotHeightPx;
      return `<line x1="${layout.plotX - 4}" x2="${layout.plotX}" y1="${y}" y2="${y}" stroke="${foreground}"/><text x="${layout.plotX - 7}" y="${y + layout.tickFontSizePx * 0.35}" text-anchor="end" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.tickFontSizePx}">${escapeXml(formatNumber(value))}</text>`;
    })
    .join("");
  const labels = details.rows
    .map((row, index) => {
      if (row.label === undefined) return "";
      const x = layout.plotX + ((row.x - xDomain[0]) / xSpan) * layout.plotWidthPx;
      const y = layout.plotY + (1 - (row.y - yDomain[0]) / ySpan) * layout.plotHeightPx;
      const anchor = x > layout.plotX + layout.plotWidthPx * 0.8 ? "end" : "start";
      const labelX = x + (anchor === "end" ? -DOT_RADIUS_PX - 3 : DOT_RADIUS_PX + 3);
      const above = y > layout.plotY + layout.pointLabelFontSizePx * 2;
      const wrappedLines = wrapLabel(row.label);
      const labelY = above
        ? y - DOT_RADIUS_PX - 3 - (wrappedLines.length - 1) * layout.pointLabelFontSizePx
        : y + DOT_RADIUS_PX + layout.pointLabelFontSizePx;
      const lines = wrappedLines
        .map(
          (line, lineIndex) =>
            `<tspan x="${labelX}" dy="${lineIndex === 0 ? 0 : layout.pointLabelFontSizePx}">${escapeXml(line)}</tspan>`,
        )
        .join("");
      return `<text data-point-label="${index}" x="${labelX}" y="${labelY}" text-anchor="${anchor}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.pointLabelFontSizePx}">${lines}</text>`;
    })
    .join("");
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
  const description = details.rows
    .map((row) => `${row.label === undefined ? "point" : row.label}: ${row.x}, ${row.y}`)
    .join(", ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx * RASTER_DENSITY}" height="${layout.heightPx * RASTER_DENSITY}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(fontFamily)}" aria-label="${escapeXml(accessibleName)}" aria-description="${escapeXml(description)}">${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}</g><g data-scatter-labels="true">${labels}</g><line x1="${layout.plotX}" x2="${layout.plotX + layout.plotWidthPx}" y1="${xAxisY}" y2="${xAxisY}" stroke="${foreground}"/><line x1="${layout.plotX}" x2="${layout.plotX}" y1="${layout.plotY}" y2="${xAxisY}" stroke="${foreground}"/>${xAxis}${yAxis}${title}${xLabel}${yLabel}</svg>`;
}

export function getScatterChartSummary(details: ScatterChartDetails): string {
  return `${details.title === undefined ? "Scatter chart" : `${details.title} scatter chart`}: ${details.rows.map((row) => `(${row.x}, ${row.y})${row.label === undefined ? "" : ` ${row.label}`}`).join("; ")}`;
}

export const scatterChartRenderer: ChartType<
  typeof scatterChartVariant,
  ScatterChartData,
  ScatterChartDetails,
  ScatterChartLayout
> = {
  renderingText: "Rendering scatter chart…",
  unavailableText: "Scatter chart unavailable",
  parameters: scatterChartVariant,
  parseParameters: validateScatterChartInput,
  createDetails(data, settings) {
    return {
      type: "scatter",
      ...data,
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters) {
    const title = normalizeText(parameters.title, "title", MAX_TITLE_LENGTH);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getScatterChartSummary,
  getLayout(details, cellDimensions, widthCells) {
    return getScatterChartLayout(
      cellDimensions,
      widthCells,
      details.title !== undefined,
      details.xLabel !== undefined,
      details.yLabel !== undefined,
      details.fontSize,
    );
  },
  renderSvg(details, theme, layout) {
    return renderScatterChartSvg(details, theme, layout, details.fontFamily);
  },
  deserializeDetails: deserializeScatterChartDetails,
};
