import {
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { type DonutChartInput, donutChartVariant, MAX_TITLE_LENGTH } from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartSettings,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  DEFAULT_IMAGE_WIDTH_CELLS,
  escapeXml,
  getChartColors,
  RASTER_DENSITY,
} from "../types";
import {
  deserializePieChartDetails,
  getPieChartLayout,
  type PieChartLayout,
  type PieChartRow,
  validatePieChartInput,
} from "./pie";
import { ESTIMATED_CHARACTER_WIDTH, isRecord, renderSvgDocument, stripTanStackSvg } from "./shared";

export type { DonutChartInput };
export { donutChartVariant };

const LEGEND_TEXT_GAP_PX = 6;
const LEGEND_COLUMN_GAP_PX = 8;

export type DonutChartData = {
  rows: PieChartRow[];
  title?: string;
  maxHeightCells?: number;
};
export type DonutChartDetails = ChartDetails & {
  type?: "donut";
  rows: PieChartRow[];
  title?: string;
};
export type DonutChartLayout = PieChartLayout;

export const getDonutChartLayout = getPieChartLayout;

function normalizeDonutChartTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0 || normalizedTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`title must be 1-${MAX_TITLE_LENGTH} characters`);
  }
  return normalizedTitle;
}

function parseDonutChartInput(input: DonutChartInput): DonutChartData {
  const rows = validatePieChartInput({ type: "pie", data: input.data });
  const title = normalizeDonutChartTitle(input.title);
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
}

function isDonutChartDetails(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (value.type === undefined || value.type === "donut");
}

function deserializeDonutChartDetails(value: unknown): DonutChartDetails | undefined {
  if (!isDonutChartDetails(value)) return undefined;
  const parsed = deserializePieChartDetails(value);
  if (parsed === undefined) return undefined;
  const { type: _type, ...details } = parsed;
  return { ...details, type: "donut" };
}

export function renderDonutChartSvg(
  rows: PieChartRow[],
  theme: ChartTheme,
  layout = getDonutChartLayout(undefined, DEFAULT_IMAGE_WIDTH_CELLS, rows.length),
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
            innerRadius: ({ radius }) => radius * 0.55,
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
  const accessibleName = title === undefined ? "Donut chart" : `Donut chart: ${title}`;
  const chart = renderTanStackChartSvg(scene, { ariaLabel: accessibleName, idPrefix: "pi-donut" });
  const foreground = ansiColor(theme.getFgAnsi("text"), "currentColor");
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
  const chartBody = stripTanStackSvg(chart);
  const rasterWidthPx = layout.widthPx * RASTER_DENSITY;
  const rasterHeightPx = layout.heightPx * RASTER_DENSITY;
  return renderSvgDocument({
    widthPx: rasterWidthPx,
    heightPx: rasterHeightPx,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily,
    ariaLabel: accessibleName,
    ariaDescription: rows.map((row) => `${row.label}: ${row.value}`).join(", "),
    content: `${title === undefined ? "" : `<title>${escapeXml(title)}</title>`}<g transform="translate(${layout.pieX} ${layout.pieY})">${chartBody}</g><g>${legend}</g>`,
  });
}

export function getDonutChartSummary(details: DonutChartDetails): string {
  const total = details.rows.reduce((sum, row) => sum + row.value, 0);
  return `${details.title === undefined ? "Donut chart" : `${details.title} donut chart`}: ${details.rows
    .map((row) => `${row.label} ${row.value} (${((row.value / total) * 100).toFixed(1)}%)`)
    .join("; ")}`;
}

export const donutChartRenderer: ChartType<
  typeof donutChartVariant,
  DonutChartData,
  DonutChartDetails,
  DonutChartLayout
> = {
  renderingText: "Rendering donut chart…",
  unavailableText: "Donut chart unavailable",
  parameters: donutChartVariant,
  parseParameters: parseDonutChartInput,
  createDetails(data: DonutChartData, settings: ChartSettings): DonutChartDetails {
    return {
      type: "donut",
      rows: data.rows,
      ...(data.title === undefined ? {} : { title: data.title }),
      ...(data.maxHeightCells === undefined ? {} : { maxHeightCells: data.maxHeightCells }),
      imageWidthCells: settings.imageWidthCells,
      fontFamily: settings.fontFamily,
      ...(settings.fontSize === undefined ? {} : { fontSize: settings.fontSize }),
    };
  },
  getCallHeader(parameters: DonutChartInput): string {
    const title = normalizeDonutChartTitle(parameters.title);
    return title === undefined ? "chart" : `chart — ${title}`;
  },
  getSummary: getDonutChartSummary,
  getLayout(details, cellDimensions, widthCells): DonutChartLayout {
    return getDonutChartLayout(
      cellDimensions,
      widthCells,
      details.rows.length,
      details.fontSize,
      details.maxHeightCells,
    );
  },
  renderSvg(details, theme, layout): string {
    return renderDonutChartSvg(details.rows, theme, layout, details.title, details.fontFamily);
  },
  deserializeDetails: deserializeDonutChartDetails,
};
