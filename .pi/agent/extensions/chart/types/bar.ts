import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  barX,
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import {
  type BarChartInput,
  barChartVariant,
  MAX_BARS,
  MAX_LABEL_LENGTH,
  MAX_TITLE_LENGTH,
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
  ESTIMATED_CHARACTER_WIDTH,
  estimateTextWidthPx,
  finalizeChartLayout,
  isRecord,
  isValidChartHeight,
  normalizeBoundedText,
  normalizeUniqueLabel,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { BarChartInput };
export { barChartVariant };

export type BarChartRow = { label: string; value: number };
export type BarChartData = { rows: BarChartRow[]; title?: string; maxHeightCells?: number };
export type BarChartLayout = ChartLayout & {
  labelWidthPx: number;
  plotHeightPx: number;
  plotWidthPx: number;
  plotX: number;
  plotY: number;
  rowHeightPx: number;
  labelFontSizePx: number;
};
export type BarChartDetails = ChartDetails & {
  type: "bar";
  rows: BarChartRow[];
  title?: string;
};

export function validateBarChartInput(input: BarChartInput): BarChartRow[] {
  if (input.data.length < 2 || input.data.length > MAX_BARS) {
    throw new Error(`provide between 2 and ${MAX_BARS} bars`);
  }

  const labels = new Set<string>();
  return input.data.map(({ label, value }, index) => {
    const normalizedLabel = normalizeUniqueLabel(label, index, MAX_LABEL_LENGTH, labels);
    if (Number.isFinite(value) === false) {
      throw new Error(`value ${index + 1} must be a finite number`);
    }
    return { label: normalizedLabel, value };
  });
}

function isBarChartRow(value: unknown): value is BarChartRow {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    typeof value.value === "number" &&
    Number.isFinite(value.value)
  );
}

export function deserializeBarChartDetails(value: unknown): BarChartDetails | undefined {
  if (
    isRecord(value) === false ||
    value.type !== "bar" ||
    Array.isArray(value.rows) === false ||
    value.rows.every(isBarChartRow) === false ||
    typeof value.imageWidthCells !== "number" ||
    Number.isFinite(value.imageWidthCells) === false ||
    value.imageWidthCells <= 0 ||
    (value.maxHeightCells !== undefined && !isValidChartHeight(value.maxHeightCells))
  ) {
    return undefined;
  }
  if (value.title !== undefined && typeof value.title !== "string") return undefined;
  if (value.fontFamily !== undefined && typeof value.fontFamily !== "string") return undefined;
  if (
    value.fontSize !== undefined &&
    (typeof value.fontSize !== "number" ||
      !Number.isFinite(value.fontSize) ||
      value.fontSize < MIN_FONT_SIZE_PX ||
      value.fontSize > MAX_FONT_SIZE_PX)
  )
    return undefined;

  return {
    type: "bar",
    rows: value.rows,
    imageWidthCells: value.imageWidthCells,
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.fontFamily === undefined ? {} : { fontFamily: value.fontFamily }),
    ...(value.fontSize === undefined ? {} : { fontSize: value.fontSize }),
    ...(value.maxHeightCells === undefined ? {} : { maxHeightCells: value.maxHeightCells }),
  };
}

export function getBarChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  rows: readonly BarChartRow[] = [],
  hasTitle = false,
  fontSize?: number,
  maxHeightCells?: number,
): BarChartLayout {
  const dimensions = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const paddingPx = Math.max(8, Math.round(dimensions.widthPx * 1.25));
  const labelFontSizePx =
    fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.66), 10, scaleChartFontSize(15, dimensions))
      : scaleChartFontSize(fontSize, dimensions);
  const titleHeightPx = hasTitle
    ? fontSize === undefined
      ? Math.round(dimensions.heightPx * 1.25)
      : labelFontSizePx + paddingPx
    : 0;
  const rowHeightPx =
    fontSize === undefined
      ? Math.max(Math.round(dimensions.heightPx * 1.25), labelFontSizePx + 7)
      : labelFontSizePx + Math.max(7, Math.round(labelFontSizePx * 0.35));
  const fixedHeightPx = paddingPx * 2 + titleHeightPx;
  const plotHeightPx = clampChartPlotHeightPx(
    rows.length * rowHeightPx,
    maxHeightCells,
    dimensions.heightPx,
    fixedHeightPx,
  );
  const minimumLabelWidthPx =
    fontSize === undefined ? Math.round(dimensions.widthPx * 8) : Math.round(labelFontSizePx * 7);
  const contentLabelWidthPx = Math.max(
    minimumLabelWidthPx,
    ...rows.map((row) => Math.ceil(estimateTextWidthPx(formatBarLabel(row), labelFontSizePx)) + 6),
  );
  const labelWidthPx = clamp(contentLabelWidthPx, minimumLabelWidthPx, Math.round(widthPx * 0.48));
  const plotWidthPx = Math.max(
    Math.round(dimensions.widthPx * 8),
    widthPx - paddingPx * 2 - labelWidthPx,
  );
  const heightPx = paddingPx + titleHeightPx + plotHeightPx + paddingPx;
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      labelWidthPx,
      plotHeightPx,
      plotWidthPx,
      plotX: paddingPx + labelWidthPx,
      plotY: paddingPx + titleHeightPx,
      rowHeightPx,
      labelFontSizePx,
    },
    dimensions.heightPx,
    maxHeightCells,
  );
}

function formatValue(value: number): string {
  return String(value);
}

function formatBarLabel(row: BarChartRow): string {
  return `${row.label}: ${formatValue(row.value)}`;
}

function truncateLabel(value: string, widthPx: number, fontSizePx: number): string {
  const maximumCharacters = Math.max(
    3,
    Math.floor(widthPx / (fontSizePx * ESTIMATED_CHARACTER_WIDTH)),
  );
  return value.length > maximumCharacters ? `${value.slice(0, maximumCharacters - 1)}…` : value;
}

export function renderBarChartSvg(
  rows: BarChartRow[],
  theme: ChartTheme,
  layout = getBarChartLayout(undefined, DEFAULT_IMAGE_WIDTH_CELLS, rows),
  title?: string,
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  const minimum = Math.min(0, ...rows.map((row) => row.value));
  const maximum = Math.max(0, ...rows.map((row) => row.value));
  const span = maximum - minimum || 1;
  const domainPadding = span * 0.06;
  const domain: [number, number] = [minimum - domainPadding, maximum + domainPadding];
  const colors = getChartColors(theme);
  const foreground = ansiColor(theme.getFgAnsi("text"), "currentColor");
  const fillByLabel = new Map(
    rows.map((row, index) => [row.label, colors[index % colors.length] ?? "currentColor"]),
  );
  const definition = defineChart({
    marks: [
      barX(rows, {
        x: "value",
        y: "label",
        fill: (row) => fillByLabel.get(row.label) ?? "currentColor",
        inset: Math.max(1, Math.round(layout.rowHeightPx * 0.12)),
        radius: 2,
      }),
    ],
    scales: {
      x: { scale: scaleLinear().domain(domain), axis: false },
      y: { scale: () => scaleBand<string>().paddingInner(0.16).paddingOuter(0.08), axis: false },
    },
  });
  const scene = createChartScene(definition, {
    width: layout.plotWidthPx,
    height: layout.plotHeightPx,
  });
  const accessibleName = title === undefined ? "Bar chart" : `Bar chart: ${title}`;
  const chart = renderTanStackChartSvg(scene, { ariaLabel: accessibleName, idPrefix: "pi-bar" });
  const chartBody = stripTanStackSvg(chart);
  const baselineX = ((0 - domain[0]) / (domain[1] - domain[0])) * layout.plotWidthPx;
  const labels = rows
    .map((row, index) => {
      const y = layout.plotY + layout.rowHeightPx * (index + 0.5) + layout.labelFontSizePx * 0.35;
      return `<text x="${layout.plotX - 6}" y="${y}" text-anchor="end" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.labelFontSizePx}">${escapeXml(truncateLabel(formatBarLabel(row), layout.labelWidthPx - 6, layout.labelFontSizePx))}</text>`;
    })
    .join("");
  const rasterWidthPx = layout.widthPx * RASTER_DENSITY;
  const rasterHeightPx = layout.heightPx * RASTER_DENSITY;
  return renderSvgDocument({
    widthPx: rasterWidthPx,
    heightPx: rasterHeightPx,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: fontFamily,
    ariaLabel: accessibleName,
    ariaDescription: rows.map((row) => `${row.label}: ${row.value}`).join(", "),
    content: `${title === undefined ? "" : `<title>${escapeXml(title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}<line x1="${baselineX}" x2="${baselineX}" y1="0" y2="${layout.plotHeightPx}" stroke="${foreground}" stroke-opacity="0.72"/></g>${title === undefined ? "" : `<text x="${layout.plotX}" y="${layout.plotY - Math.round(layout.labelFontSizePx * 0.55)}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.labelFontSizePx}">${escapeXml(title)}</text>`}${labels}`,
  });
}

export function getBarChartSummary(details: BarChartDetails): string {
  return `${details.title === undefined ? "Bar chart" : `${details.title} bar chart`}: ${details.rows
    .map((row) => `${row.label} ${row.value}`)
    .join("; ")}`;
}

function parseBarChartInput(input: BarChartInput): BarChartData {
  const rows = validateBarChartInput(input);
  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

export const barChartRenderer: ChartType<
  typeof barChartVariant,
  BarChartData,
  BarChartDetails,
  BarChartLayout
> = {
  renderingText: "Rendering bar chart…",
  unavailableText: "Bar chart unavailable",
  parameters: barChartVariant,
  parseParameters: parseBarChartInput,
  createDetails(data: BarChartData, settings: ChartSettings): BarChartDetails {
    return {
      type: "bar",
      rows: data.rows,
      ...(data.title === undefined ? {} : { title: data.title }),
      ...(data.maxHeightCells === undefined ? {} : { maxHeightCells: data.maxHeightCells }),
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters: BarChartInput): string {
    const title = normalizeBoundedText(parameters.title, "title", MAX_TITLE_LENGTH);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getBarChartSummary,
  getLayout(details, cellDimensions, widthCells): BarChartLayout {
    return getBarChartLayout(
      cellDimensions,
      widthCells,
      details.rows,
      details.title !== undefined,
      details.fontSize,
      details.maxHeightCells,
    );
  },
  renderSvg(details, theme, layout): string {
    return renderBarChartSvg(details.rows, theme, layout, details.title, details.fontFamily);
  },
  deserializeDetails: deserializeBarChartDetails,
};
