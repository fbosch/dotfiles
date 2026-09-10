import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import type { PieChartInput } from "../schemas";
import { pieChartVariant } from "../schemas";
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
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

export type { PieChartInput };
export { pieChartVariant };

const NARROW_LAYOUT_CELLS = 36;
const MAX_SLICES = 12;
const MAX_LABEL_LENGTH = 22;
const MAX_TITLE_LENGTH = 80;
const ESTIMATED_CHARACTER_WIDTH = 0.58;
const LEGEND_TEXT_GAP_PX = 6;
const LEGEND_COLUMN_GAP_PX = 8;

export type PieChartRow = { label: string; value: number };
export type PieChartData = {
  rows: PieChartRow[];
  title?: string;
};
export type PieChartLayout = ChartLayout & {
  pieDiameterPx: number;
  pieX: number;
  pieY: number;
  legendX: number;
  legendY: number;
  legendColumns: number;
  legendColumnWidthPx: number;
  legendRowHeightPx: number;
  labelFontSizePx: number;
  markerSizePx: number;
  stacked: boolean;
};
export type PieChartDetails = ChartDetails & {
  /** Missing on results persisted before chart types were introduced. */
  type?: "pie";
  rows: PieChartRow[];
  title?: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getPieChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  sliceCount = 2,
  fontSize?: number,
): PieChartLayout {
  const dimensions = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const paddingPx = Math.max(8, Math.round(dimensions.widthPx * 1.25));
  const labelFontSizePx =
    fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.72), 11, scaleChartFontSize(16, dimensions))
      : scaleChartFontSize(fontSize, dimensions);
  const markerSizePx =
    fontSize === undefined
      ? Math.max(8, Math.round(dimensions.heightPx * 0.5))
      : Math.max(8, Math.round(labelFontSizePx * 0.7));
  const legendRowHeightPx = Math.round(
    Math.max(labelFontSizePx, markerSizePx) + dimensions.heightPx * 0.32,
  );
  const stacked = imageWidthCells <= NARROW_LAYOUT_CELLS;
  const legendColumns = stacked ? (sliceCount > 4 ? 2 : 1) : sliceCount > 6 ? 2 : 1;
  const legendRows = Math.ceil(sliceCount / legendColumns);
  const maxHeightPx = Math.round(MAX_CHART_HEIGHT_CELLS * dimensions.heightPx);

  if (stacked) {
    const legendHeightPx = legendRows * legendRowHeightPx;
    // Reserve legend space before choosing the pie diameter so configured text is never clipped.
    const availablePieHeightPx = Math.max(1, maxHeightPx - paddingPx * 3 - legendHeightPx);
    const pieDiameterPx = Math.min(
      widthPx - paddingPx * 2,
      Math.round(dimensions.heightPx * 10),
      availablePieHeightPx,
    );
    const heightPx = Math.round(paddingPx + pieDiameterPx + paddingPx + legendHeightPx + paddingPx);
    return {
      widthPx,
      heightPx,
      heightCells: Math.ceil(heightPx / dimensions.heightPx),
      pieDiameterPx,
      pieX: Math.round((widthPx - pieDiameterPx) / 2),
      pieY: paddingPx,
      legendX: paddingPx,
      legendY: Math.round(paddingPx + pieDiameterPx + paddingPx + labelFontSizePx),
      legendColumns,
      legendColumnWidthPx: Math.floor((widthPx - paddingPx * 2) / legendColumns),
      legendRowHeightPx,
      labelFontSizePx,
      markerSizePx,
      stacked,
    };
  }

  const pieDiameterPx = Math.max(
    Math.round(dimensions.heightPx * 7),
    Math.min(
      Math.round(widthPx * 0.42),
      Math.round(dimensions.heightPx * 11),
      maxHeightPx - paddingPx * 2,
    ),
  );
  // Use the gap between the pie and the legend so the text columns have room to breathe.
  const legendX = paddingPx + pieDiameterPx + paddingPx;
  const legendWidthPx = Math.max(1, widthPx - legendX - paddingPx);
  const heightPx = Math.min(
    maxHeightPx,
    Math.max(pieDiameterPx + paddingPx * 2, legendRows * legendRowHeightPx + paddingPx * 2),
  );
  return {
    widthPx,
    heightPx,
    heightCells: Math.ceil(heightPx / dimensions.heightPx),
    pieDiameterPx,
    pieX: paddingPx,
    pieY: Math.round((heightPx - pieDiameterPx) / 2),
    legendX,
    legendY: Math.round((heightPx - legendRows * legendRowHeightPx) / 2 + labelFontSizePx),
    legendColumns,
    legendColumnWidthPx: Math.floor(legendWidthPx / legendColumns),
    legendRowHeightPx,
    labelFontSizePx,
    markerSizePx,
    stacked,
  };
}

export function validatePieChartInput(input: PieChartInput): PieChartRow[] {
  if (input.data.length < 2 || input.data.length > MAX_SLICES) {
    throw new Error(`provide between 2 and ${MAX_SLICES} slices`);
  }

  const labels = new Set<string>();
  const rows = input.data.map(({ label, value }, index) => {
    const normalizedLabel = label.trim();
    if (
      typeof label !== "string" ||
      normalizedLabel.length === 0 ||
      normalizedLabel.length > MAX_LABEL_LENGTH
    ) {
      throw new Error(`label ${index + 1} must be 1-${MAX_LABEL_LENGTH} characters`);
    }
    if (labels.has(normalizedLabel)) {
      throw new Error(`label ${index + 1} duplicates an earlier label`);
    }
    labels.add(normalizedLabel);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`value ${index + 1} must be a finite nonnegative number`);
    }
    return { label: normalizedLabel, value };
  });

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("values must have a finite positive total");
  }
  return rows;
}

function normalizePieChartTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0 || normalizedTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`title must be 1-${MAX_TITLE_LENGTH} characters`);
  }
  return normalizedTitle;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isPieChartRow(value: unknown): value is PieChartRow {
  return (
    isRecord(value) &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    value.value >= 0
  );
}

export function deserializePieChartDetails(value: unknown): PieChartDetails | undefined {
  if (isRecord(value) === false || !Array.isArray(value.rows) || !value.rows.every(isPieChartRow)) {
    return undefined;
  }
  const imageWidthCells = value.imageWidthCells;
  if (
    typeof imageWidthCells !== "number" ||
    !Number.isFinite(imageWidthCells) ||
    imageWidthCells <= 0
  ) {
    return undefined;
  }

  const title = value.title;
  if (title !== undefined && typeof title !== "string") return undefined;
  const fontFamily = value.fontFamily;
  if (fontFamily !== undefined && typeof fontFamily !== "string") return undefined;
  const fontSize = value.fontSize;
  if (
    fontSize !== undefined &&
    (typeof fontSize !== "number" ||
      !Number.isFinite(fontSize) ||
      fontSize < MIN_FONT_SIZE_PX ||
      fontSize > MAX_FONT_SIZE_PX)
  )
    return undefined;

  const details: PieChartDetails = { rows: value.rows, imageWidthCells };
  if (title !== undefined) details.title = title;
  if (fontFamily !== undefined) details.fontFamily = fontFamily;
  if (fontSize !== undefined) details.fontSize = fontSize;
  return details;
}

export function renderPieChartSvg(
  rows: PieChartRow[],
  theme: ChartTheme,
  layout = getPieChartLayout(undefined, DEFAULT_IMAGE_WIDTH_CELLS, rows.length),
  title?: string,
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const slices = pie(rows, { value: "value", gapAngle: 0.025 });
  const sliceColors = getChartColors(theme);
  const definition = defineChart({
    marks: [
      polar({
        inset: Math.max(8, Math.round(layout.pieDiameterPx * 0.08)),
        radiusRatio: 0.9,
        marks: [
          radialArc(slices, {
            color: "label",
            key: "label",
          }),
        ],
        scales: { angle: null, radius: null },
      }),
    ],
    scales: { x: null, y: null },
    color: { domain: rows.map((row) => row.label), range: sliceColors },
  });
  const scene = createChartScene(definition, {
    width: layout.pieDiameterPx,
    height: layout.pieDiameterPx,
  });
  const accessibleName = title === undefined ? "Pie chart" : `Pie chart: ${title}`;
  const chart = renderTanStackChartSvg(scene, { ariaLabel: accessibleName, idPrefix: "pi-pie" });
  const foreground = ansiColor(theme.getFgAnsi("text"), "currentColor");
  // Budget the complete entry; otherwise the percentage can cross into the next column.
  const maxLegendTextWidth = Math.max(
    1,
    layout.legendColumnWidthPx - layout.markerSizePx - LEGEND_TEXT_GAP_PX - LEGEND_COLUMN_GAP_PX,
  );
  const truncateLabel = (label: string, suffix: string) => {
    const characterWidth = layout.labelFontSizePx * ESTIMATED_CHARACTER_WIDTH;
    const availableLabelWidth = Math.max(0, maxLegendTextWidth - suffix.length * characterWidth);
    const maximumCharacters = Math.floor(availableLabelWidth / characterWidth);
    if (label.length <= maximumCharacters) return `${label}${suffix}`;
    if (maximumCharacters < 2) return suffix.trim();
    const visibleLabel = label.slice(0, maximumCharacters - 1).trimEnd();
    return `${visibleLabel}…${suffix}`;
  };
  const legend = rows
    .map((row, index) => {
      const column = index % layout.legendColumns;
      const legendRow = Math.floor(index / layout.legendColumns);
      const x = layout.legendX + column * layout.legendColumnWidthPx;
      const y = layout.legendY + legendRow * layout.legendRowHeightPx;
      const percentage = ((row.value / total) * 100).toFixed(1);
      const color = sliceColors[index % sliceColors.length] ?? "currentColor";
      const legendLabel = truncateLabel(row.label, ` ${percentage}%`);
      return `<rect x="${x}" y="${y - layout.markerSizePx + 2}" width="${layout.markerSizePx}" height="${layout.markerSizePx}" rx="2" fill="${color}"/><text x="${x + layout.markerSizePx + LEGEND_TEXT_GAP_PX}" y="${y}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.labelFontSizePx}">${escapeXml(legendLabel)}</text>`;
    })
    .join("");
  const chartBody = chart.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  const rasterWidthPx = layout.widthPx * RASTER_DENSITY;
  const rasterHeightPx = layout.heightPx * RASTER_DENSITY;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${rasterWidthPx}" height="${rasterHeightPx}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(fontFamily)}" aria-label="${escapeXml(accessibleName)}" aria-description="${escapeXml(rows.map((row) => `${row.label}: ${row.value}`).join(", "))}">${title === undefined ? "" : `<title>${escapeXml(title)}</title>`}<g transform="translate(${layout.pieX} ${layout.pieY})">${chartBody}</g><g>${legend}</g></svg>`;
}

export function getPieChartSummary(details: PieChartDetails): string {
  const total = details.rows.reduce((sum, row) => sum + row.value, 0);
  return `${details.title === undefined ? "Pie chart" : `${details.title} pie chart`}: ${details.rows
    .map((row) => `${row.label} ${row.value} (${((row.value / total) * 100).toFixed(1)}%)`)
    .join("; ")}`;
}

function parsePieChartInput(input: PieChartInput): PieChartData {
  const rows = validatePieChartInput(input);
  const title = normalizePieChartTitle(input.title);
  return title === undefined ? { rows } : { rows, title };
}

export const pieChartRenderer: ChartType<
  typeof pieChartVariant,
  PieChartData,
  PieChartDetails,
  PieChartLayout
> = {
  renderingText: "Rendering pie chart…",
  unavailableText: "Pie chart unavailable",
  parameters: pieChartVariant,
  parseParameters: parsePieChartInput,
  createDetails(data: PieChartData, settings: ChartSettings): PieChartDetails {
    return {
      rows: data.rows,
      ...(data.title === undefined ? {} : { title: data.title }),
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters: PieChartInput): string {
    const title = normalizePieChartTitle(parameters.title);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getPieChartSummary,
  getLayout(details, cellDimensions, widthCells): PieChartLayout {
    return getPieChartLayout(cellDimensions, widthCells, details.rows.length, details.fontSize);
  },
  renderSvg(details, theme, layout): string {
    return renderPieChartSvg(details.rows, theme, layout, details.title, details.fontFamily);
  },
  deserializeDetails: deserializePieChartDetails,
};
