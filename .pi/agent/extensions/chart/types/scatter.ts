import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import {
  MAX_AXIS_LABEL_LENGTH,
  MAX_POINT_LABEL_LENGTH,
  MAX_ROWS,
  MAX_TITLE_LENGTH,
  type ScatterChartInput,
  scatterChartVariant,
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
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";
import {
  clamp,
  clampChartPlotHeightPx,
  estimateTextWidthPx,
  finalizeChartLayout,
  formatNumeric,
  isRecord,
  isValidChartHeight,
  normalizeBoundedText,
  paddedDomain,
  renderCartesianAxes,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { ScatterChartInput };
export { scatterChartVariant };

const DOT_RADIUS_PX = 4;
const LABEL_GAP_PX = 3;

type ScatterLabelAnchor = "start" | "end";
type ScatterLabelBounds = { left: number; right: number; top: number; bottom: number };
type ScatterPoint = { x: number; y: number };
type ScatterLabelPlacement = {
  index: number;
  point: ScatterPoint;
  x: number;
  y: number;
  anchor: ScatterLabelAnchor;
  lines: string[];
  bounds: ScatterLabelBounds;
  baseX: number;
  baseY: number;
  baseAnchor: ScatterLabelAnchor;
};
type ScatterMultiplicityAnnotation = {
  placement: ScatterLabelPlacement;
  count: number;
  indices: number[];
};
type ScatterLabelPlacementOptions = {
  allowFallback?: boolean;
  avoidPoints?: boolean;
  preferGrid?: boolean;
};

export type ScatterChartRow = { x: number; y: number; label?: string };
export type ScatterChartData = {
  rows: ScatterChartRow[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  maxHeightCells?: number;
  xFormat?: "number" | "percent";
  yFormat?: "number" | "percent";
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

export function validateScatterChartInput(input: ScatterChartInput): ScatterChartData {
  if (input.data.length < 2 || input.data.length > MAX_ROWS) {
    throw new Error(`provide between 2 and ${MAX_ROWS} rows`);
  }
  const rows = input.data.map((row, index) => {
    if (Number.isFinite(row.x) === false) throw new Error(`x ${index + 1} must be a finite number`);
    if (Number.isFinite(row.y) === false) throw new Error(`y ${index + 1} must be a finite number`);
    const label = normalizeBoundedText(row.label, `label ${index + 1}`, MAX_POINT_LABEL_LENGTH);
    return { x: row.x, y: row.y, ...(label === undefined ? {} : { label }) };
  });
  const title = normalizeBoundedText(input.title, "title", MAX_TITLE_LENGTH);
  const xLabel = normalizeBoundedText(input.xLabel, "xLabel", MAX_AXIS_LABEL_LENGTH);
  const yLabel = normalizeBoundedText(input.yLabel, "yLabel", MAX_AXIS_LABEL_LENGTH);
  return {
    rows,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
    ...(input.xFormat === undefined ? {} : { xFormat: input.xFormat }),
    ...(input.yFormat === undefined ? {} : { yFormat: input.yFormat }),
  };
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
    (value.maxHeightCells !== undefined && !isValidChartHeight(value.maxHeightCells)) ||
    (value.xFormat !== undefined && value.xFormat !== "number" && value.xFormat !== "percent") ||
    (value.yFormat !== undefined && value.yFormat !== "number" && value.yFormat !== "percent") ||
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
  maxHeightCells?: number,
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
  const fixedHeightPx = plotY + tickLabelHeightPx + xLabelHeightPx + paddingPx;
  const plotHeightPx = clampChartPlotHeightPx(
    Math.round(dimensions.heightPx * 8),
    maxHeightCells,
    dimensions.heightPx,
    fixedHeightPx,
  );
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
      pointLabelFontSizePx:
        maxHeightCells !== undefined &&
        plotY +
          Math.round(dimensions.heightPx * 8) +
          tickLabelHeightPx +
          xLabelHeightPx +
          paddingPx >
          Math.floor(maxHeightCells * dimensions.heightPx)
          ? Math.max(8, Math.round(tickFontSizePx * 0.6))
          : Math.max(8, Math.round(tickFontSizePx * 0.9)),
    },
    dimensions.heightPx,
    maxHeightCells,
  );
}

function wrapLabel(label: string, maximum = 16): string[] {
  const lines: string[] = [];
  for (const paragraph of label.split("\n")) {
    const words = paragraph
      .split(/\s+/u)
      .filter((word) => word.length > 0)
      .flatMap((word) =>
        Array.from({ length: Math.ceil(word.length / maximum) }, (_, index) =>
          word.slice(index * maximum, (index + 1) * maximum),
        ),
      );
    let line = "";
    for (const word of words) {
      if (line.length > 0 && line.length + word.length + 1 > maximum) {
        lines.push(line);
        line = word;
      } else line = line.length === 0 ? word : `${line} ${word}`;
    }
    if (line.length > 0) lines.push(line);
  }
  return lines;
}

function scatterLabelBounds(
  x: number,
  y: number,
  anchor: ScatterLabelAnchor,
  lines: readonly string[],
  fontSize: number,
): ScatterLabelBounds {
  // Reserve a small bearing allowance so labels that look separate in SVG do not touch after rasterization.
  const width = Math.max(1, ...lines.map((line) => estimateTextWidthPx(line, fontSize) + 2));
  const left = anchor === "start" ? x : x - width;
  return {
    left,
    right: left + width,
    top: y - fontSize * 0.8,
    bottom: y + (lines.length - 1) * fontSize + fontSize * 0.2,
  };
}

function clampLabelCoordinate(value: number, minimum: number, maximum: number): number {
  return minimum <= maximum ? clamp(value, minimum, maximum) : (minimum + maximum) / 2;
}

function scatterLabelCandidate(
  x: number,
  y: number,
  anchor: ScatterLabelAnchor,
  lines: readonly string[],
  fontSize: number,
  plot: ScatterLabelBounds,
): ScatterLabelPlacement {
  const width = Math.max(1, ...lines.map((line) => estimateTextWidthPx(line, fontSize) + 2));
  const textX =
    anchor === "start"
      ? clampLabelCoordinate(x, plot.left, plot.right - width)
      : clampLabelCoordinate(x, plot.left + width, plot.right);
  const topOffset = fontSize * 0.8;
  const bottomOffset = (lines.length - 1) * fontSize + fontSize * 0.2;
  const textY = clampLabelCoordinate(y, plot.top + topOffset, plot.bottom - bottomOffset);
  return {
    index: -1,
    point: { x: 0, y: 0 },
    x: textX,
    y: textY,
    anchor,
    lines: [...lines],
    bounds: scatterLabelBounds(textX, textY, anchor, lines, fontSize),
    baseX: textX,
    baseY: textY,
    baseAnchor: anchor,
  };
}

function scatterRectsOverlap(
  first: ScatterLabelBounds,
  second: ScatterLabelBounds,
  gap = LABEL_GAP_PX,
): boolean {
  return (
    first.left - gap < second.right &&
    first.right + gap > second.left &&
    first.top - gap < second.bottom &&
    first.bottom + gap > second.top
  );
}

function scatterRectIntersectsPoint(
  bounds: ScatterLabelBounds,
  point: ScatterPoint,
  radius = DOT_RADIUS_PX + LABEL_GAP_PX,
): boolean {
  const nearestX = clamp(point.x, bounds.left, bounds.right);
  const nearestY = clamp(point.y, bounds.top, bounds.bottom);
  const dx = point.x - nearestX;
  const dy = point.y - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

function isScatterLabelInPlot(bounds: ScatterLabelBounds, plot: ScatterLabelBounds): boolean {
  return (
    bounds.left >= plot.left &&
    bounds.right <= plot.right &&
    bounds.top >= plot.top &&
    bounds.bottom <= plot.bottom
  );
}

function placeScatterLabel(
  index: number,
  label: string,
  point: ScatterPoint,
  plot: ScatterLabelBounds,
  fontSize: number,
  points: readonly ScatterPoint[],
  occupied: ScatterLabelBounds[],
  options: ScatterLabelPlacementOptions = {},
): ScatterLabelPlacement | undefined {
  const lines = wrapLabel(label);
  const baseAnchor: ScatterLabelAnchor =
    point.x > plot.left + (plot.right - plot.left) * 0.8 ? "end" : "start";
  const baseX = point.x + (baseAnchor === "end" ? -DOT_RADIUS_PX - 3 : DOT_RADIUS_PX + 3);
  const above = point.y > plot.top + fontSize * 2;
  const baseY = above
    ? point.y - DOT_RADIUS_PX - 3 - (lines.length - 1) * fontSize
    : point.y + DOT_RADIUS_PX + fontSize;
  const oppositeAnchor: ScatterLabelAnchor = baseAnchor === "start" ? "end" : "start";
  const oppositeX = point.x + (oppositeAnchor === "end" ? -DOT_RADIUS_PX - 3 : DOT_RADIUS_PX + 3);
  const candidates: ScatterLabelPlacement[] = [];
  const gridCandidates: ScatterLabelPlacement[] = [];
  const seen = new Set<string>();
  const addCandidate = (x: number, y: number, anchor: ScatterLabelAnchor) => {
    const candidate = scatterLabelCandidate(x, y, anchor, lines, fontSize, plot);
    const key = `${candidate.x}:${candidate.y}:${candidate.anchor}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  // The first candidate is the historical placement, retaining ordinary fixtures byte-for-byte when clear.
  addCandidate(baseX, baseY, baseAnchor);
  const verticalStep = Math.max(fontSize + LABEL_GAP_PX, lines.length * fontSize + LABEL_GAP_PX);
  for (let distance = 1; distance <= 12; distance += 1) {
    const offset = distance * verticalStep;
    addCandidate(baseX, baseY + offset, baseAnchor);
    addCandidate(baseX, baseY - offset, baseAnchor);
    addCandidate(oppositeX, baseY + offset, oppositeAnchor);
    addCandidate(oppositeX, baseY - offset, oppositeAnchor);
  }

  // A bounded grid is the deterministic escape hatch for labels around an edge or a dense point cluster.
  const width = Math.max(1, ...lines.map((line) => estimateTextWidthPx(line, fontSize) + 2));
  const rowPitch = lines.length * fontSize + LABEL_GAP_PX;
  const gridRows = Math.ceil((plot.bottom - plot.top) / rowPitch) + 1;
  const gridX = [plot.left, plot.left + (plot.right - plot.left - width) / 2, plot.right - width];
  for (let row = 0; row < gridRows; row += 1) {
    const y = plot.top + fontSize * 0.8 + row * rowPitch;
    for (const x of gridX) {
      const before = candidates.length;
      addCandidate(x, y, "start");
      addCandidate(x + width, y, "end");
      gridCandidates.push(...candidates.slice(before));
    }
  }

  const orderedCandidates = options.preferGrid ? [...gridCandidates, ...candidates] : candidates;
  const selected = orderedCandidates.find(
    (candidate) =>
      isScatterLabelInPlot(candidate.bounds, plot) &&
      occupied.every((other) => !scatterRectsOverlap(candidate.bounds, other)) &&
      (options.avoidPoints === false ||
        points.every((other) => !scatterRectIntersectsPoint(candidate.bounds, other))),
  );
  const fallback = options.allowFallback === false ? undefined : orderedCandidates[0];
  if (selected === undefined && fallback === undefined) return undefined;
  const chosen = selected ?? fallback;
  if (chosen === undefined) return undefined;
  const placement = {
    ...chosen,
    index,
    point,
    baseX: scatterLabelCandidate(baseX, baseY, baseAnchor, lines, fontSize, plot).x,
    baseY: scatterLabelCandidate(baseX, baseY, baseAnchor, lines, fontSize, plot).y,
    baseAnchor,
  };
  occupied.push(placement.bounds);
  return placement;
}

function scatterLabelNeedsCallout(placement: ScatterLabelPlacement): boolean {
  return (
    placement.x !== placement.baseX ||
    placement.y !== placement.baseY ||
    placement.anchor !== placement.baseAnchor
  );
}

function renderScatterCallout(placement: ScatterLabelPlacement, foreground: string): string {
  const targetX = clamp(placement.point.x, placement.bounds.left, placement.bounds.right);
  const targetY = clamp(placement.point.y, placement.bounds.top, placement.bounds.bottom);
  const dx = targetX - placement.point.x;
  const dy = targetY - placement.point.y;
  const distance = Math.hypot(dx, dy);
  const offset = Math.min(DOT_RADIUS_PX, Math.max(0, distance / 2));
  const startX = placement.point.x + (distance === 0 ? 0 : (dx / distance) * offset);
  const startY = placement.point.y + (distance === 0 ? 0 : (dy / distance) * offset);
  return `<line data-point-callout="${placement.index}" x1="${startX}" y1="${startY}" x2="${targetX}" y2="${targetY}" stroke="${foreground}" stroke-width="1" opacity="0.75"/>`;
}

function scatterPointKey(point: ScatterPoint): string {
  return `${point.x}\u0000${point.y}`;
}

function scatterMultiplicityLabel(labels: readonly string[]): string {
  return labels.join("\n");
}

function placeScatterOverflowLabels(
  entries: readonly { index: number; label: string }[],
  point: ScatterPoint,
  plot: ScatterLabelBounds,
  fontSize: number,
  occupied: ScatterLabelBounds[],
): ScatterLabelPlacement[] {
  const labels = entries.map(({ index, label }) => ({ index, lines: wrapLabel(label) }));
  if (labels.length === 0) return [];

  const maximumWidth = Math.max(
    1,
    ...labels.map(({ lines }) =>
      Math.max(1, ...lines.map((line) => estimateTextWidthPx(line, fontSize) + 2)),
    ),
  );
  const maximumLines = Math.max(1, ...labels.map(({ lines }) => lines.length));
  const rowPitch = maximumLines * fontSize + LABEL_GAP_PX;
  const availableHeight = plot.bottom - plot.top;
  const availableWidth = plot.right - plot.left;
  const maximumRows = Math.max(1, Math.floor((availableHeight + LABEL_GAP_PX) / rowPitch + 1e-6));
  const maximumColumns = Math.max(
    1,
    Math.floor((availableWidth + LABEL_GAP_PX) / (maximumWidth + LABEL_GAP_PX)),
  );
  const columns = Math.max(1, Math.ceil(labels.length / maximumRows));
  if (columns > maximumColumns) return [];

  const xStep = columns === 1 ? 0 : (availableWidth - maximumWidth) / (columns - 1);
  const top = plot.top + fontSize * 0.8;
  const placements: ScatterLabelPlacement[] = [];
  for (const [index, label] of labels.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const candidate = scatterLabelCandidate(
      plot.left + column * xStep,
      top + row * rowPitch,
      "start",
      label.lines,
      fontSize,
      plot,
    );
    if (
      !isScatterLabelInPlot(candidate.bounds, plot) ||
      occupied.some((other) => scatterRectsOverlap(candidate.bounds, other))
    ) {
      return [];
    }
    const placement: ScatterLabelPlacement = {
      ...candidate,
      index: label.index,
      point,
      baseX: point.x,
      baseY: point.y,
      baseAnchor: "start",
    };
    placements.push(placement);
  }
  occupied.push(...placements.map((placement) => placement.bounds));
  return placements;
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
    details.maxHeightCells,
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
  const chartBody = stripTanStackSvg(chart);
  const xSpan = xDomain[1] - xDomain[0];
  const ySpan = yDomain[1] - yDomain[0];
  const xAxisY = layout.plotY + layout.plotHeightPx;
  const xTicks = xScale.ticks(layout.plotWidthPx < 250 ? 3 : 5);
  const yTicks = yScale.ticks(5);
  const { xAxis, yAxis } = renderCartesianAxes({
    layout,
    xDomain,
    yDomain,
    xTicks,
    yTicks,
    foreground,
    fontFamily,
    formatXTick: (value) => formatNumeric(value, details.xFormat),
    formatYTick: (value) => formatNumeric(value, details.yFormat),
  });
  const points = details.rows.map((row) => ({
    x: layout.plotX + ((row.x - xDomain[0]) / xSpan) * layout.plotWidthPx,
    y: layout.plotY + (1 - (row.y - yDomain[0]) / ySpan) * layout.plotHeightPx,
  }));
  const plot = {
    left: layout.plotX,
    right: layout.plotX + layout.plotWidthPx,
    top: layout.plotY,
    bottom: layout.plotY + layout.plotHeightPx,
  };
  const occupied: ScatterLabelBounds[] = [];
  const placements: Array<ScatterLabelPlacement | undefined> = Array.from({
    length: details.rows.length,
  });
  const multiplicities: ScatterMultiplicityAnnotation[] = [];
  const groups = new Map<string, number[]>();
  for (const [index, point] of points.entries()) {
    const key = scatterPointKey(point);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [index]);
    else group.push(index);
  }
  const inputGroups = [...groups.values()];
  const labelGroups =
    details.maxHeightCells !== undefined && layout.heightCells < 14
      ? [
          ...inputGroups.filter((indices) => indices.length > 1),
          ...inputGroups
            .filter((indices) => indices.length === 1)
            .sort((first, second) => {
              const firstPoint = points[first[0] ?? 0];
              const secondPoint = points[second[0] ?? 0];
              return (firstPoint?.y ?? 0) - (secondPoint?.y ?? 0);
            }),
        ]
      : inputGroups;
  for (const indices of labelGroups) {
    const labeledIndices = indices.filter((index) => details.rows[index]?.label !== undefined);
    if (labeledIndices.length === 0) continue;
    if (indices.length === 1) {
      const index = labeledIndices[0];
      const label = index === undefined ? undefined : details.rows[index]?.label;
      const point = index === undefined ? undefined : points[index];
      if (index !== undefined && label !== undefined && point !== undefined) {
        placements[index] = placeScatterLabel(
          index,
          label,
          point,
          plot,
          layout.pointLabelFontSizePx,
          points,
          occupied,
          {
            allowFallback: false,
            preferGrid: details.maxHeightCells !== undefined && layout.heightCells < 14,
          },
        );
      }
      continue;
    }

    const firstIndex = indices[0];
    if (firstIndex === undefined) continue;
    const point = points[firstIndex];
    if (point === undefined) continue;
    const labels = labeledIndices.flatMap((index) => {
      const label = details.rows[index]?.label;
      return label === undefined ? [] : [label];
    });
    if (labels.length === 0) continue;

    // One annotation keeps coincident dots exact while retaining every supplied name in row order.
    const annotationLabel = scatterMultiplicityLabel(labels);
    const annotation = placeScatterLabel(
      firstIndex,
      annotationLabel,
      point,
      plot,
      layout.pointLabelFontSizePx,
      points,
      occupied,
      { allowFallback: false, avoidPoints: false },
    );
    if (annotation !== undefined) {
      multiplicities.push({ placement: annotation, count: indices.length, indices: [...indices] });
    } else {
      // Keep each name visible when the grouped multiline callout is taller than a capped plot.
      const overflow = placeScatterOverflowLabels(
        labeledIndices.flatMap((index) => {
          const label = details.rows[index]?.label;
          return label === undefined ? [] : [{ index, label }];
        }),
        point,
        plot,
        layout.pointLabelFontSizePx,
        occupied,
      );
      for (const placement of overflow) placements[placement.index] = placement;
    }
  }
  const regularPlacements = placements.filter(
    (placement): placement is ScatterLabelPlacement => placement !== undefined,
  );
  const callouts = [
    ...regularPlacements
      .filter((placement) => scatterLabelNeedsCallout(placement))
      .map((placement) => renderScatterCallout(placement, foreground)),
    ...multiplicities.map(({ placement }) => renderScatterCallout(placement, foreground)),
  ].join("");
  const renderPlacementLines = (placement: ScatterLabelPlacement) =>
    placement.lines
      .map(
        (line, lineIndex) =>
          `<tspan x="${placement.x}" dy="${lineIndex === 0 ? 0 : layout.pointLabelFontSizePx}">${escapeXml(line)}</tspan>`,
      )
      .join("");
  const labels = placements
    .map((placement) => {
      if (placement === undefined) return "";
      return `<text data-point-label="${placement.index}" x="${placement.x}" y="${placement.y}" text-anchor="${placement.anchor}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.pointLabelFontSizePx}">${renderPlacementLines(placement)}</text>`;
    })
    .join("");
  const multiplicityLabels = multiplicities
    .map(({ placement, count, indices }) => {
      return `<text data-point-multiplicity="${count}" data-point-indices="${indices.join(",")}" data-point-coordinate="${escapeXml(`${placement.point.x}, ${placement.point.y}`)}" x="${placement.x}" y="${placement.y}" text-anchor="${placement.anchor}" fill="${foreground}" font-family="${escapeXml(fontFamily)}" font-size="${layout.pointLabelFontSizePx}">${renderPlacementLines(placement)}</text>`;
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
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: fontFamily,
    ariaLabel: accessibleName,
    ariaDescription: description,
    content: `${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}<g transform="translate(${layout.plotX} ${layout.plotY})">${chartBody}</g>${callouts.length === 0 ? "" : `<g data-scatter-callouts="true">${callouts}</g>`}<g data-scatter-labels="true">${labels}${multiplicityLabels}</g><line x1="${layout.plotX}" x2="${layout.plotX + layout.plotWidthPx}" y1="${xAxisY}" y2="${xAxisY}" stroke="${foreground}"/><line x1="${layout.plotX}" x2="${layout.plotX}" y1="${layout.plotY}" y2="${xAxisY}" stroke="${foreground}"/>${xAxis}${yAxis}${title}${xLabel}${yLabel}`,
  });
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
    const title = normalizeBoundedText(parameters.title, "title", MAX_TITLE_LENGTH);
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
      details.maxHeightCells,
    );
  },
  renderSvg(details, theme, layout) {
    return renderScatterChartSvg(details, theme, layout, details.fontFamily);
  },
  deserializeDetails: deserializeScatterChartDetails,
};
