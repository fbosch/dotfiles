import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import {
  MAX_LABEL_LENGTH,
  MAX_SLICES,
  MAX_TITLE_LENGTH,
  type PieChartInput,
  pieChartVariant,
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
  ESTIMATED_CHARACTER_WIDTH,
  finalizeChartLayout,
  fitTextToWidth,
  getChartHeightLimitPx,
  isRecord,
  isValidChartHeight,
  normalizeUniqueLabel,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { PieChartInput };
export { pieChartVariant };

const NARROW_LAYOUT_CELLS = 36;
const LEGEND_TEXT_GAP_PX = 6;
const LEGEND_COLUMN_GAP_PX = 8;

export type PieChartRow = { label: string; value: number };
export type PieChartData = {
  rows: PieChartRow[];
  title?: string;
  maxHeightCells?: number;
};
export type PieChartLayout = ChartLayout & {
  pieDiameterPx: number;
  pieX: number;
  pieY: number;
  legendX: number;
  legendY: number;
  legendColumns: number;
  legendColumnWidthPx: number;
  /** Horizontal breathing room reserved when fitting legend text in a column. */
  legendColumnGapPx: number;
  legendRowHeightPx: number;
  labelFontSizePx: number;
  titleFontSizePx: number;
  titleX: number;
  titleY: number;
  markerSizePx: number;
  stacked: boolean;
};
export type PieChartDetails = ChartDetails & {
  /** Missing on results persisted before chart types were introduced. */
  type?: "pie";
  rows: PieChartRow[];
  title?: string;
};

type PieLayoutGeometry = Omit<PieChartLayout, "heightCells">;
type PieLayoutCandidate = PieLayoutGeometry & { fitsCap: boolean };

type PieLayoutTypography = {
  labelFontSizePx: number;
  titleFontSizePx: number;
  markerSizePx: number;
  legendRowHeightPx: number;
  legendColumnGapPx: number;
};

const MIN_CAP_PIE_DIAMETER_PX = 48;

function getPieLayoutTypography(
  dimensions: CellDimensions,
  fontSize: number | undefined,
  compact: boolean,
): PieLayoutTypography {
  const labelFontSizePx = compact
    ? MIN_FONT_SIZE_PX
    : fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.72), 11, scaleChartFontSize(16, dimensions))
      : scaleChartFontSize(fontSize, dimensions);
  const titleFontSizePx = compact
    ? MIN_FONT_SIZE_PX
    : fontSize === undefined
      ? clamp(Math.round(dimensions.heightPx * 0.75), 11, scaleChartFontSize(16, dimensions))
      : scaleChartFontSize(fontSize, dimensions);
  const markerSizePx = compact
    ? MIN_FONT_SIZE_PX
    : fontSize === undefined
      ? Math.max(8, Math.round(dimensions.heightPx * 0.5))
      : Math.max(8, Math.round(labelFontSizePx * 0.7));
  const legendRowHeightPx = Math.round(
    Math.max(labelFontSizePx, markerSizePx) + dimensions.heightPx * 0.32,
  );
  return {
    labelFontSizePx,
    titleFontSizePx,
    markerSizePx,
    legendRowHeightPx,
    // Tight capped legends can still retain their suffix when this gap is removed.
    legendColumnGapPx: compact ? 0 : LEGEND_COLUMN_GAP_PX,
  };
}

function buildPieLayoutCandidate(
  dimensions: CellDimensions,
  widthPx: number,
  sliceCount: number,
  hasTitle: boolean,
  maxHeightPx: number,
  paddingPx: number,
  typography: PieLayoutTypography,
  stacked: boolean,
): PieLayoutCandidate {
  const titleHeightPx = hasTitle ? typography.titleFontSizePx + paddingPx : 0;
  const titleX = paddingPx;
  const titleY = titleHeightPx === 0 ? 0 : paddingPx + typography.titleFontSizePx;
  const legendColumns = stacked ? (sliceCount > 4 ? 2 : 1) : sliceCount > 6 ? 2 : 1;
  const legendRows = Math.ceil(sliceCount / legendColumns);
  const legendHeightPx = legendRows * typography.legendRowHeightPx;
  const maxPieWidthPx = Math.max(1, widthPx - paddingPx * 2);
  let pieDiameterPx: number;
  let heightPx: number;
  let pieX: number;
  let pieY: number;
  let legendX: number;
  let legendY: number;
  let legendColumnWidthPx: number;

  if (stacked) {
    const naturalPieDiameterPx = Math.min(maxPieWidthPx, Math.round(dimensions.heightPx * 10));
    const availablePieHeightPx = maxHeightPx - paddingPx * 3 - legendHeightPx - titleHeightPx;
    pieDiameterPx = Math.max(1, Math.min(naturalPieDiameterPx, availablePieHeightPx));
    heightPx = Math.round(
      paddingPx + titleHeightPx + pieDiameterPx + paddingPx + legendHeightPx + paddingPx,
    );
    pieX = Math.round((widthPx - pieDiameterPx) / 2);
    pieY = titleHeightPx + paddingPx;
    legendX = paddingPx;
    legendY = Math.round(
      titleHeightPx + paddingPx + pieDiameterPx + paddingPx + typography.labelFontSizePx,
    );
    legendColumnWidthPx = Math.floor(maxPieWidthPx / legendColumns);
  } else {
    const naturalPieDiameterPx = Math.max(
      Math.round(dimensions.heightPx * 7),
      Math.min(Math.round(widthPx * 0.42), Math.round(dimensions.heightPx * 11)),
    );
    const availablePieHeightPx = maxHeightPx - titleHeightPx - paddingPx * 2;
    pieDiameterPx = Math.max(
      1,
      Math.min(naturalPieDiameterPx, maxPieWidthPx, availablePieHeightPx),
    );
    legendX = paddingPx + pieDiameterPx + paddingPx;
    const legendWidthPx = Math.max(1, widthPx - legendX - paddingPx);
    heightPx = Math.round(
      titleHeightPx + Math.max(pieDiameterPx + paddingPx * 2, legendHeightPx + paddingPx * 2),
    );
    pieX = paddingPx;
    pieY = Math.round(titleHeightPx + (heightPx - titleHeightPx - pieDiameterPx) / 2);
    legendY = Math.round(
      titleHeightPx + (heightPx - titleHeightPx - legendHeightPx) / 2 + typography.labelFontSizePx,
    );
    legendColumnWidthPx = Math.floor(legendWidthPx / legendColumns);
  }

  const availableLegendTextWidthPx =
    legendColumnWidthPx -
    typography.markerSizePx -
    LEGEND_TEXT_GAP_PX -
    typography.legendColumnGapPx;
  // Reserve the widest percentage suffix so a cap never hides its only exact cue.
  const suffixFits =
    availableLegendTextWidthPx >= 7 * typography.labelFontSizePx * ESTIMATED_CHARACTER_WIDTH;
  return {
    widthPx,
    heightPx,
    pieDiameterPx,
    pieX,
    pieY,
    legendX,
    legendY,
    legendColumns,
    legendColumnWidthPx,
    legendColumnGapPx: typography.legendColumnGapPx,
    legendRowHeightPx: typography.legendRowHeightPx,
    labelFontSizePx: typography.labelFontSizePx,
    titleFontSizePx: typography.titleFontSizePx,
    titleX,
    titleY,
    markerSizePx: typography.markerSizePx,
    stacked,
    fitsCap: heightPx <= maxHeightPx && suffixFits,
  };
}

function finalizePieLayout(
  candidate: PieLayoutCandidate,
  cellHeightPx: number,
  maxHeightCells: number | undefined,
): PieChartLayout {
  const { fitsCap: _fitsCap, ...geometry } = candidate;
  return finalizeChartLayout(geometry, cellHeightPx, maxHeightCells);
}

export function getPieChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  sliceCount = 2,
  fontSize?: number,
  maxHeightCells?: number,
  hasTitle = false,
): PieChartLayout {
  const dimensions = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const maxHeightPx = getChartHeightLimitPx(maxHeightCells, dimensions.heightPx);
  const defaultPaddingPx = Math.max(8, Math.round(dimensions.widthPx * 1.25));
  const preferredStacked = imageWidthCells <= NARROW_LAYOUT_CELLS;
  const baseTypography = getPieLayoutTypography(dimensions, fontSize, false);
  const compactTypography = getPieLayoutTypography(dimensions, fontSize, true);
  const baseCandidate = buildPieLayoutCandidate(
    dimensions,
    widthPx,
    sliceCount,
    hasTitle,
    maxHeightPx,
    defaultPaddingPx,
    baseTypography,
    preferredStacked,
  );

  // Natural layouts retain their established stacked/side preference. Explicit caps may switch
  // orientation and compact typography instead of clipping the pie or the last legend rows.
  if (maxHeightCells === undefined) {
    return finalizePieLayout(baseCandidate, dimensions.heightPx, maxHeightCells);
  }

  if (baseCandidate.fitsCap && baseCandidate.pieDiameterPx >= MIN_CAP_PIE_DIAMETER_PX) {
    return finalizePieLayout(baseCandidate, dimensions.heightPx, maxHeightCells);
  }

  const alternateCandidate = buildPieLayoutCandidate(
    dimensions,
    widthPx,
    sliceCount,
    hasTitle,
    maxHeightPx,
    defaultPaddingPx,
    baseTypography,
    !preferredStacked,
  );
  if (alternateCandidate.fitsCap) {
    return finalizePieLayout(alternateCandidate, dimensions.heightPx, maxHeightCells);
  }

  const compactPaddingPx = Math.min(defaultPaddingPx, 8);
  const compactPreferred = buildPieLayoutCandidate(
    dimensions,
    widthPx,
    sliceCount,
    hasTitle,
    maxHeightPx,
    compactPaddingPx,
    compactTypography,
    preferredStacked,
  );
  const compactAlternate = buildPieLayoutCandidate(
    dimensions,
    widthPx,
    sliceCount,
    hasTitle,
    maxHeightPx,
    compactPaddingPx,
    compactTypography,
    !preferredStacked,
  );
  const compactCandidate =
    compactPreferred.fitsCap && compactAlternate.fitsCap
      ? compactPreferred.pieDiameterPx >= compactAlternate.pieDiameterPx
        ? compactPreferred
        : compactAlternate
      : compactPreferred.fitsCap
        ? compactPreferred
        : compactAlternate;
  return finalizePieLayout(compactCandidate, dimensions.heightPx, maxHeightCells);
}

export function validatePieChartInput(input: PieChartInput): PieChartRow[] {
  if (input.data.length < 2 || input.data.length > MAX_SLICES) {
    throw new Error(`provide between 2 and ${MAX_SLICES} slices`);
  }

  const labels = new Set<string>();
  const rows = input.data.map(({ label, value }, index) => {
    const normalizedLabel = normalizeUniqueLabel(label, index, MAX_LABEL_LENGTH, labels);
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
  if (
    isRecord(value) === false ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isPieChartRow) ||
    (value.maxHeightCells !== undefined && !isValidChartHeight(value.maxHeightCells))
  ) {
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
  if (value.maxHeightCells !== undefined) details.maxHeightCells = value.maxHeightCells;
  return details;
}

export function renderPieChartSvg(
  rows: PieChartRow[],
  theme: ChartTheme,
  layout?: PieChartLayout,
  title?: string,
  fontFamily = DEFAULT_FONT_FAMILY,
): string {
  layout ??= getPieChartLayout(
    undefined,
    DEFAULT_IMAGE_WIDTH_CELLS,
    rows.length,
    undefined,
    undefined,
    title !== undefined,
  );
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
    layout.legendColumnWidthPx -
      layout.markerSizePx -
      LEGEND_TEXT_GAP_PX -
      layout.legendColumnGapPx,
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
  const visibleTitle =
    title === undefined
      ? ""
      : `<text data-chart-title="true" x="${layout.titleX}" y="${layout.titleY}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.titleFontSizePx}">${escapeXml(fitTextToWidth(title, Math.max(1, layout.widthPx - layout.titleX), layout.titleFontSizePx))}</text>`;
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
    content: `${title === undefined ? "" : `<title>${escapeXml(title)}</title>`}${visibleTitle}<g transform="translate(${layout.pieX} ${layout.pieY})">${chartBody}</g><g>${legend}</g>`,
  });
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
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
  };
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
      ...(data.maxHeightCells === undefined ? {} : { maxHeightCells: data.maxHeightCells }),
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
    return getPieChartLayout(
      cellDimensions,
      widthCells,
      details.rows.length,
      details.fontSize,
      details.maxHeightCells,
      details.title !== undefined,
    );
  },
  renderSvg(details, theme, layout): string {
    return renderPieChartSvg(details.rows, theme, layout, details.title, details.fontFamily);
  },
  deserializeDetails: deserializePieChartDetails,
};
