import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  barX,
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { type Static, Type } from "typebox";
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
  MAX_CHART_HEIGHT_CELLS,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  validCellDimensions,
} from "../types";

const MAX_BARS = 12;
const MAX_LABEL_LENGTH = 22;
const MAX_TITLE_LENGTH = 80;

export const barChartVariant = Type.Object(
  {
    type: Type.Literal("bar"),
    data: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
          value: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: MAX_BARS },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH })),
  },
  { additionalProperties: false },
);

export type BarChartInput = Static<typeof barChartVariant>;
export type BarChartRow = { label: string; value: number };
export type BarChartData = { rows: BarChartRow[]; title?: string };
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const normalized = title.trim();
  if (normalized.length === 0 || normalized.length > MAX_TITLE_LENGTH) {
    throw new Error(`title must be 1-${MAX_TITLE_LENGTH} characters`);
  }
  return normalized;
}

export function validateBarChartInput(input: BarChartInput): BarChartRow[] {
  if (input.data.length < 2 || input.data.length > MAX_BARS) {
    throw new Error(`provide between 2 and ${MAX_BARS} bars`);
  }

  const labels = new Set<string>();
  return input.data.map(({ label, value }, index) => {
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0 || normalizedLabel.length > MAX_LABEL_LENGTH) {
      throw new Error(`label ${index + 1} must be 1-${MAX_LABEL_LENGTH} characters`);
    }
    if (labels.has(normalizedLabel)) {
      throw new Error(`label ${index + 1} duplicates an earlier label`);
    }
    labels.add(normalizedLabel);
    if (Number.isFinite(value) === false) {
      throw new Error(`value ${index + 1} must be a finite number`);
    }
    return { label: normalizedLabel, value };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
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
    value.imageWidthCells <= 0
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
  };
}

export function getBarChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  rowCount = 2,
  hasTitle = false,
  fontSize?: number,
): BarChartLayout {
  const dimensions = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const paddingPx = Math.max(8, Math.round(dimensions.widthPx * 1.25));
  const labelFontSizePx = fontSize ?? clamp(Math.round(dimensions.heightPx * 0.66), 10, 15);
  const titleHeightPx = hasTitle
    ? fontSize === undefined
      ? Math.round(dimensions.heightPx * 1.25)
      : labelFontSizePx + paddingPx
    : 0;
  const rowHeightPx =
    fontSize === undefined
      ? Math.max(Math.round(dimensions.heightPx * 1.25), labelFontSizePx + 7)
      : labelFontSizePx + Math.max(7, Math.round(labelFontSizePx * 0.35));
  const maxPlotHeightPx =
    Math.round(MAX_CHART_HEIGHT_CELLS * dimensions.heightPx) - paddingPx * 2 - titleHeightPx;
  const plotHeightPx = Math.min(maxPlotHeightPx, rowCount * rowHeightPx);
  const labelWidthPx = clamp(
    Math.round(widthPx * 0.42),
    fontSize === undefined ? Math.round(dimensions.widthPx * 8) : Math.round(labelFontSizePx * 7),
    Math.round(widthPx * 0.48),
  );
  const plotWidthPx = Math.max(
    Math.round(dimensions.widthPx * 8),
    widthPx - paddingPx * 2 - labelWidthPx,
  );
  const heightPx = paddingPx + titleHeightPx + plotHeightPx + paddingPx;
  return {
    widthPx,
    heightPx,
    heightCells: Math.ceil(heightPx / dimensions.heightPx),
    labelWidthPx,
    plotHeightPx,
    plotWidthPx,
    plotX: paddingPx + labelWidthPx,
    plotY: paddingPx + titleHeightPx,
    rowHeightPx,
    labelFontSizePx,
  };
}

function formatValue(value: number): string {
  return String(value);
}

function truncateLabel(value: string, widthPx: number, fontSizePx: number): string {
  const maximumCharacters = Math.max(3, Math.floor(widthPx / (fontSizePx * 0.58)));
  return value.length > maximumCharacters ? `${value.slice(0, maximumCharacters - 1)}…` : value;
}

export function renderBarChartSvg(
  rows: BarChartRow[],
  theme: ChartTheme,
  layout = getBarChartLayout(undefined, DEFAULT_IMAGE_WIDTH_CELLS, rows.length),
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
  const chartBody = chart.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  const baselineX = ((0 - domain[0]) / (domain[1] - domain[0])) * layout.plotWidthPx;
  const labels = rows
    .map((row, index) => {
      const y = layout.plotY + layout.rowHeightPx * (index + 0.5) + layout.labelFontSizePx * 0.35;
      return `<text x="${layout.plotX - 6}" y="${y}" text-anchor="end" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.labelFontSizePx}">${escapeXml(truncateLabel(`${row.label}: ${formatValue(row.value)}`, layout.labelWidthPx - 6, layout.labelFontSizePx))}</text>`;
    })
    .join("");
  const rasterWidthPx = layout.widthPx * RASTER_DENSITY;
  const rasterHeightPx = layout.heightPx * RASTER_DENSITY;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidthPx}" height="${rasterHeightPx}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(fontFamily)}" aria-label="${escapeXml(accessibleName)}" aria-description="${escapeXml(rows.map((row) => `${row.label}: ${row.value}`).join(", "))}">${title === undefined ? "" : `<title>${escapeXml(title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}<line x1="${baselineX}" x2="${baselineX}" y1="0" y2="${layout.plotHeightPx}" stroke="${foreground}" stroke-opacity="0.72"/></g>${title === undefined ? "" : `<text x="${layout.plotX}" y="${layout.plotY - Math.round(layout.labelFontSizePx * 0.55)}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.labelFontSizePx}">${escapeXml(title)}</text>`}${labels}</svg>`;
}

export function getBarChartSummary(details: BarChartDetails): string {
  return `${details.title === undefined ? "Bar chart" : `${details.title} bar chart`}: ${details.rows
    .map((row) => `${row.label} ${row.value}`)
    .join("; ")}`;
}

function parseBarChartInput(input: BarChartInput): BarChartData {
  const rows = validateBarChartInput(input);
  const title = normalizeTitle(input.title);
  return title === undefined ? { rows } : { rows, title };
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
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters: BarChartInput): string {
    const title = normalizeTitle(parameters.title);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getBarChartSummary,
  getLayout(details, cellDimensions, widthCells): BarChartLayout {
    return getBarChartLayout(
      cellDimensions,
      widthCells,
      details.rows.length,
      details.title !== undefined,
      details.fontSize,
    );
  },
  renderSvg(details, theme, layout): string {
    return renderBarChartSvg(details.rows, theme, layout, details.title, details.fontFamily);
  },
  deserializeDetails: deserializeBarChartDetails,
};
