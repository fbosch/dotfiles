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
import { type HeatmapChartInput, heatmapChartVariant, MAX_HEATMAP_VALUE_CELLS } from "../schemas";
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

export type { HeatmapChartInput };
export { heatmapChartVariant };
export type HeatmapChartData = Omit<HeatmapChartInput, "type" | "colorScale" | "showValues"> & {
  colorScale: "sequential" | "diverging";
  showValues: boolean;
};
export type HeatmapChartDetails = ChartDetails & HeatmapChartData & { type: "heatmap" };
export type HeatmapChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  fontSizePx: number;
};

export function validateHeatmapChartInput(input: HeatmapChartInput): HeatmapChartData {
  if (!Value.Check(heatmapChartVariant, input)) throw new Error("invalid heatmap chart parameters");
  const labels = (values: string[], name: string) => {
    const normalized = values.map((value) => value.trim());
    if (
      normalized.some((value) => value.length === 0) ||
      new Set(normalized).size !== normalized.length
    )
      throw new Error(`${name} must contain unique nonblank labels after trimming`);
    return normalized;
  };
  const rows = labels(input.rows, "rows");
  const columns = labels(input.columns, "columns");
  if (input.data.length !== rows.length || input.data.some((row) => row.length !== columns.length))
    throw new Error("heatmap data must match the rows and columns as a rectangular matrix");
  if (input.data.some((row) => row.some((value) => value !== null && !Number.isFinite(value))))
    throw new Error("heatmap values must be finite numbers or null");
  if (input.showValues && rows.length * columns.length > MAX_HEATMAP_VALUE_CELLS)
    throw new Error(`showValues requires at most ${MAX_HEATMAP_VALUE_CELLS} cells`);
  const title = input.title?.trim();
  if (title === "") throw new Error("title must not be blank");
  return {
    rows,
    columns,
    data: input.data.map((row) => [...row]),
    colorScale: input.colorScale ?? "sequential",
    showValues: input.showValues ?? false,
    ...(title === undefined ? {} : { title }),
  };
}

const detailsSchema = Type.Object(
  {
    ...heatmapChartVariant.properties,
    colorScale: Type.Union([Type.Literal("sequential"), Type.Literal("diverging")]),
    showValues: Type.Boolean(),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeHeatmapChartDetails(value: unknown): HeatmapChartDetails | undefined {
  if (!Value.Check(detailsSchema, value) || !Number.isFinite(value.imageWidthCells))
    return undefined;
  const { imageWidthCells, fontFamily, fontSize, ...input } = value;
  try {
    return {
      type: "heatmap",
      ...validateHeatmapChartInput(input),
      imageWidthCells,
      fontFamily,
      ...(fontSize === undefined ? {} : { fontSize }),
    };
  } catch {
    return undefined;
  }
}

export function getHeatmapDomain(details: HeatmapChartData): [number, number] | undefined {
  const values = details.data.flat().filter((value): value is number => value !== null);
  if (values.length === 0) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (details.colorScale === "sequential") return [min, max];
  const extent = Math.max(Math.abs(min), Math.abs(max));
  return extent === 0 ? [0, 0] : [-extent, extent];
}

// Fixed ordered palettes keep magnitude and sign readable even when theme accents have equal luminance.
function ramp(position: number, diverging: boolean): string {
  const low = diverging ? [33, 102, 172] : [239, 243, 255];
  const high = diverging ? [178, 24, 43] : [8, 48, 107];
  const middle = [247, 247, 247];
  const start = diverging && position >= 0.5 ? middle : low;
  const end = diverging && position < 0.5 ? middle : high;
  const t = diverging ? (position < 0.5 ? position * 2 : (position - 0.5) * 2) : position;
  return `#${start
    .map((channel, index) =>
      Math.round(channel + ((end[index] ?? channel) - channel) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function color(
  value: number | null,
  domain: [number, number] | undefined,
  diverging: boolean,
): string {
  if (value === null || domain === undefined) return "url(#pi-heatmap-missing)";
  const [min, max] = domain;
  // Divide before offsetting: a symmetric subnormal domain need not have a representable midpoint span.
  const t = min === max ? 0.5 : diverging ? (value / max + 1) / 2 : (value - min) / (max - min);
  return ramp(Math.max(0, Math.min(1, t)), diverging);
}

export function getHeatmapChartLayout(
  details: HeatmapChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): HeatmapChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(width * cells.widthPx);
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const padding = cells.widthPx;
  const plotX = Math.min(
    widthPx * 0.3,
    Math.max(...details.rows.map((label) => label.length)) * fontSizePx * 0.65 + padding * 2,
  );
  const plotY =
    Math.min(
      cells.heightPx * 5,
      Math.max(...details.columns.map((label) => label.length)) * fontSizePx * 0.65 + padding * 2,
    ) + (details.title ? fontSizePx * 1.5 : 0);
  const plotWidthPx = Math.max(1, widthPx - plotX - padding);
  // Reserve a readable row for every label rather than squeezing dense matrices below the configured font.
  const plotHeightPx = details.rows.length * Math.max(cells.heightPx * 1.5, fontSizePx * 1.25);
  const heightPx = Math.ceil(plotY + plotHeightPx + fontSizePx * 5);
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

export function getHeatmapChartSummary(details: HeatmapChartDetails): string {
  const domain = getHeatmapDomain(details);
  const range =
    domain === undefined
      ? "No numeric data"
      : domain[0] === domain[1]
        ? `Constant: ${domain[0]}`
        : `${details.colorScale} scale: ${domain[0]} to ${domain[1]}`;
  return `${details.title ?? "Heatmap"}: ${details.rows.length} rows × ${details.columns.length} columns; ${range}; missing cells are not zero. ${details.rows.map((row, i) => `${row}: ${details.columns.map((column, j) => `${column} = ${details.data[i]?.[j] === null ? "missing" : details.data[i]?.[j]}`).join(", ")}`).join("; ")}`;
}

function compact(value: number): string {
  const text = String(Number(value.toPrecision(3)));
  return text.length <= 7 ? text : value.toExponential(1);
}

export function renderHeatmapChartSvg(
  details: HeatmapChartDetails,
  theme: ChartTheme,
  layout = getHeatmapChartLayout(details),
): string {
  const domain = getHeatmapDomain(details);
  const diverging = details.colorScale === "diverging";
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const cells = details.data.flatMap((row, i) =>
    row.map((value, j) => ({ row: i, column: j, value })),
  );
  const scene = createChartScene(
    defineChart({
      marks: cells.map((cell, index) =>
        rect([cell], {
          x1: (datum) => datum.column,
          x2: (datum) => datum.column + 1,
          y1: (datum) => details.rows.length - datum.row - 1,
          y2: (datum) => details.rows.length - datum.row,
          key: () => index,
          fill: color(cell.value, domain, diverging),
          inset: 1,
        }),
      ),
      scales: {
        x: { scale: scaleLinear().domain([0, details.columns.length]), axis: false },
        y: { scale: scaleLinear().domain([0, details.rows.length]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  const plot = renderTanStackChartSvg(scene, { ariaLabel: "Heatmap cells", idPrefix: "pi-heatmap" })
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const font = layout.fontSizePx;
  const text = (
    value: string,
    x: number,
    y: number,
    anchor = "middle",
    extra = "",
    fill = foreground,
  ) =>
    `<text x="${x}" y="${y}" font-size="${font}" text-anchor="${anchor}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;
  const shorten = (label: string, space: number) => {
    const length = Math.max(1, Math.floor(space / (font * 0.65)));
    return label.length <= length ? label : `${label.slice(0, Math.max(0, length - 1))}…`;
  };
  const cellWidth = layout.plotWidthPx / details.columns.length;
  const cellHeight = layout.plotHeightPx / details.rows.length;
  const rowLabels = details.rows
    .map((label, i) =>
      text(
        shorten(label, layout.plotX - 12),
        layout.plotX - 8,
        layout.plotY + (i + 0.5) * cellHeight + font * 0.35,
        "end",
      ),
    )
    .join("");
  const columnLabels = details.columns
    .map((label, i) => {
      const x = layout.plotX + (i + 0.5) * cellWidth;
      const y = layout.plotY - 8;
      return text(
        shorten(label, layout.plotY - (details.title ? font * 1.5 : 0) - 10),
        x,
        y,
        "start",
        `transform="rotate(-90 ${x} ${y})"`,
      );
    })
    .join("");
  const values =
    details.showValues && cellWidth >= font * 5 && cellHeight >= font * 1.2
      ? cells
          .flatMap((cell) => {
            if (cell.value === null) return [];
            const fill = color(cell.value, domain, diverging);
            const channels = [1, 3, 5]
              .map((offset) => Number.parseInt(fill.slice(offset, offset + 2), 16) / 255)
              .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
            const luminance =
              (channels[0] ?? 0) * 0.2126 +
              (channels[1] ?? 0) * 0.7152 +
              (channels[2] ?? 0) * 0.0722;
            return text(
              compact(cell.value),
              layout.plotX + (cell.column + 0.5) * cellWidth,
              layout.plotY + (cell.row + 0.5) * cellHeight + font * 0.35,
              "middle",
              'data-cell-value="true"',
              luminance > 0.179 ? "#000000" : "#ffffff",
            );
          })
          .join("")
      : "";
  const legendY = layout.plotY + layout.plotHeightPx + font;
  const legendWidth = layout.plotWidthPx * 0.65;
  const stops = [0, 0.25, 0.5, 0.75, 1]
    .map((t) => `<stop offset="${t * 100}%" stop-color="${ramp(t, diverging)}"/>`)
    .join("");
  const legend =
    domain === undefined
      ? text("No numeric data", layout.plotX, legendY + font, "start")
      : domain[0] === domain[1]
        ? `<rect x="${layout.plotX}" y="${legendY}" width="${font}" height="${font}" fill="${color(domain[0], domain, diverging)}"/>${text(`Constant: ${compact(domain[0])}`, layout.plotX + font * 1.4, legendY + font, "start")}`
        : `<rect data-color-ramp="true" x="${layout.plotX}" y="${legendY}" width="${legendWidth}" height="${font}" fill="url(#pi-heatmap-ramp)"/>${text(compact(domain[0]), layout.plotX, legendY + font * 2.2, "start")}${diverging ? text("0", layout.plotX + legendWidth / 2, legendY + font * 2.2) : ""}${text(compact(domain[1]), layout.plotX + legendWidth, legendY + font * 2.2, "end")}`;
  const missing = `<rect x="${layout.plotX}" y="${legendY + font * 2.6}" width="${font}" height="${font}" fill="url(#pi-heatmap-missing)"/>${text("Missing (null)", layout.plotX + font * 1.4, legendY + font * 3.5, "start")}`;
  const name = details.title ?? "Heatmap";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx * RASTER_DENSITY}" height="${layout.heightPx * RASTER_DENSITY}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY)}" aria-label="${escapeXml(name)}"><title>${escapeXml(name)}</title><desc>${escapeXml(getHeatmapChartSummary(details))}</desc><defs><pattern id="pi-heatmap-missing" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#bdbdbd"/><path d="M 0 6 L 6 0" stroke="#666666"/></pattern><linearGradient id="pi-heatmap-ramp">${stops}</linearGradient></defs><g data-heatmap-cells="true" transform="translate(${layout.plotX} ${layout.plotY})">${plot}</g>${rowLabels}${columnLabels}${values}${legend}${missing}${details.title ? text(shorten(details.title, layout.widthPx - 16), 8, font, "start") : ""}</svg>`;
}

export const heatmapChartRenderer: ChartType<
  typeof heatmapChartVariant,
  HeatmapChartData,
  HeatmapChartDetails,
  HeatmapChartLayout
> = {
  renderingText: "Rendering heatmap…",
  unavailableText: "Heatmap unavailable",
  parameters: heatmapChartVariant,
  parseParameters: validateHeatmapChartInput,
  createDetails: (data, settings) => ({ type: "heatmap", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getHeatmapChartSummary,
  getLayout: getHeatmapChartLayout,
  renderSvg: renderHeatmapChartSvg,
  deserializeDetails: deserializeHeatmapChartDetails,
};
