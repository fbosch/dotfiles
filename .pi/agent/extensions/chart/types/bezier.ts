import type { CellDimensions } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type BezierChartInput, bezierChartVariant } from "../schemas";
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

export type { BezierChartInput };
export { bezierChartVariant };

export type BezierChartData = Omit<BezierChartInput, "type" | "showControls"> & {
  showControls: boolean;
};
export type BezierChartDetails = ChartDetails &
  BezierChartData & { type: "bezier"; fontFamily: string };
export type BezierChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  tickFontSizePx: number;
  axisLabelFontSizePx: number;
  titleFontSizePx: number;
};
type Point = BezierChartInput["start"];
const pointNames = ["start", "control1", "control2", "end"] as const;

function normalizeText(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (text.length === 0) throw new Error(`${name} must not be blank`);
  return text;
}

export function validateBezierChartInput(input: BezierChartInput): BezierChartData {
  if (!Value.Check(bezierChartVariant, input)) throw new Error("invalid bezier chart parameters");
  for (const name of pointNames) {
    if (!Number.isFinite(input[name].x) || !Number.isFinite(input[name].y))
      throw new Error(`${name} coordinates must be finite numbers`);
  }
  const title = normalizeText(input.title, "title");
  const xLabel = normalizeText(input.xLabel, "xLabel");
  const yLabel = normalizeText(input.yLabel, "yLabel");
  const data = {
    start: { ...input.start },
    control1: { ...input.control1 },
    control2: { ...input.control2 },
    end: { ...input.end },
    showControls: input.showControls ?? false,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
  getBezierChartGeometry(data, getBezierChartLayout());
  return data;
}

const detailsSchema = Type.Object(
  {
    ...bezierChartVariant.properties,
    showControls: Type.Boolean(),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ minLength: 1, maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeBezierChartDetails(value: unknown): BezierChartDetails | undefined {
  if (!Value.Check(detailsSchema, value)) return undefined;
  const { imageWidthCells: _width, fontFamily, fontSize: _size, ...input } = value;
  if (!Number.isFinite(_width) || fontFamily.trim().length === 0) return undefined;
  try {
    validateBezierChartInput(input);
    return value;
  } catch {
    return undefined;
  }
}

export function getBezierChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  hasTitle = false,
  hasXLabel = false,
  hasYLabel = false,
  fontSize?: number,
): BezierChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const widthPx = Math.round(imageWidthCells * cells.widthPx);
  const padding = Math.max(8, Math.round(cells.widthPx * 1.2));
  const axisLabelFontSizePx = scaleChartFontSize(fontSize ?? 13, cells);
  const tickFontSizePx = Math.round(axisLabelFontSizePx * 0.85);
  const titleFontSizePx = Math.round(axisLabelFontSizePx * 1.1);
  const plotX = padding + tickFontSizePx * 5 + (hasYLabel ? axisLabelFontSizePx + padding : 0);
  const plotY = padding + (hasTitle ? titleFontSizePx + padding : 0);
  const plotWidthPx = Math.max(1, widthPx - plotX - padding);
  const bottom = tickFontSizePx + padding * 2 + (hasXLabel ? axisLabelFontSizePx + padding : 0);
  const plotHeightPx = Math.max(
    1,
    Math.min(8 * cells.heightPx, MAX_CHART_HEIGHT_CELLS * cells.heightPx - plotY - bottom),
  );
  const heightPx = Math.ceil(plotY + plotHeightPx + bottom);
  return {
    widthPx,
    heightPx,
    heightCells: Math.ceil(heightPx / cells.heightPx),
    plotX,
    plotY,
    plotWidthPx,
    plotHeightPx,
    tickFontSizePx,
    axisLabelFontSizePx,
    titleFontSizePx,
  };
}

function axisExtent(values: number[]): { center: number; span: number } {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  const center = minimum + span / 2;
  // Keep near-coincident domains distinct and subnormal spans safe to invert.
  const minimumSpan = Math.max(Math.abs(center) * Number.EPSILON * 16, 1e-300);
  return {
    center,
    span: span === 0 ? Math.max(Math.abs(minimum) * 0.12, 2) : Math.max(span * 1.12, minimumSpan),
  };
}

export function getBezierChartGeometry(data: BezierChartData, layout: BezierChartLayout) {
  // The control polygon bounds the entire cubic, even when the guides are hidden.
  const points = pointNames.map((name) => data[name]);
  const x = axisExtent(points.map((point) => point.x));
  const y = axisExtent(points.map((point) => point.y));
  const unitsPerPixel = Math.max(x.span / layout.plotWidthPx, y.span / layout.plotHeightPx);
  const xSpan = unitsPerPixel * layout.plotWidthPx;
  const ySpan = unitsPerPixel * layout.plotHeightPx;
  const xDomain: [number, number] = [x.center - xSpan / 2, x.center + xSpan / 2];
  const yDomain: [number, number] = [y.center - ySpan / 2, y.center + ySpan / 2];
  if (
    !Number.isFinite(unitsPerPixel) ||
    unitsPerPixel <= 0 ||
    !Number.isFinite(1 / unitsPerPixel) ||
    [...xDomain, ...yDomain].some((value) => !Number.isFinite(value)) ||
    xDomain[1] <= xDomain[0] ||
    yDomain[1] <= yDomain[0]
  )
    throw new Error("bezier range cannot be represented; rescale or recenter the points");
  // Project around the center with one scale, rather than independently rounding axis domains.
  const project = (point: Point): Point => ({
    x: layout.plotX + layout.plotWidthPx / 2 + (point.x - x.center) / unitsPerPixel,
    y: layout.plotY + layout.plotHeightPx / 2 - (point.y - y.center) / unitsPerPixel,
  });
  return { xDomain, yDomain, unitsPerPixel, project };
}

function formatTick(value: number): string {
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(1)
    : Number(value.toFixed(2)).toString();
}

export function getBezierChartSummary(details: BezierChartDetails): string {
  return `${details.title === undefined ? "Bezier chart" : `${details.title} bezier chart`}: ${pointNames.map((name) => `${name} (${details[name].x}, ${details[name].y})`).join("; ")}`;
}

export function renderBezierChartSvg(
  details: BezierChartDetails,
  theme: ChartTheme,
  layout = getBezierChartLayout(
    undefined,
    details.imageWidthCells,
    details.title !== undefined,
    details.xLabel !== undefined,
    details.yLabel !== undefined,
    details.fontSize,
  ),
): string {
  const geometry = getBezierChartGeometry(details, layout);
  const { project, xDomain, yDomain } = geometry;
  const start = project(details.start);
  const control1 = project(details.control1);
  const control2 = project(details.control2);
  const end = project(details.end);
  const color = getChartColors(theme)[0] ?? "#6aa5ad";
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const font = escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY);
  const bottom = layout.plotY + layout.plotHeightPx;
  const text = (x: number, y: number, content: string, size: number, attributes = "") =>
    `<text x="${x}" y="${y}" fill="${foreground}" font-size="${size}" ${attributes}>${escapeXml(content)}</text>`;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const fraction = index / 4;
    const x = layout.plotX + fraction * layout.plotWidthPx;
    const y = bottom - fraction * layout.plotHeightPx;
    return `<line x1="${x}" x2="${x}" y1="${bottom}" y2="${bottom + 4}" stroke="${foreground}"/>${text(x, bottom + layout.tickFontSizePx + 6, formatTick(xDomain[0] + (xDomain[1] - xDomain[0]) * fraction), layout.tickFontSizePx, 'text-anchor="middle"')}<line x1="${layout.plotX - 4}" x2="${layout.plotX}" y1="${y}" y2="${y}" stroke="${foreground}"/>${text(layout.plotX - 7, y + layout.tickFontSizePx * 0.35, formatTick(yDomain[0] + (yDomain[1] - yDomain[0]) * fraction), layout.tickFontSizePx, 'text-anchor="end"')}`;
  }).join("");
  const guides = details.showControls
    ? `<polyline data-control-guides="true" points="${[start, control1, control2, end].map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="${foreground}" stroke-dasharray="4 4"/>${[control1, control2].map((point, index) => `<rect data-control="${index + 1}" x="${point.x - 3}" y="${point.y - 3}" width="6" height="6" fill="none" stroke="${foreground}"/>`).join("")}`
    : "";
  const endpoints = [start, end]
    .map(
      (point, index) =>
        `<circle data-endpoint="${index}" cx="${point.x}" cy="${point.y}" r="3" fill="${color}"/>`,
    )
    .join("");
  const title =
    details.title === undefined
      ? ""
      : text(layout.plotX, layout.plotY - 8, details.title, layout.titleFontSizePx);
  const xLabel =
    details.xLabel === undefined
      ? ""
      : text(
          layout.plotX + layout.plotWidthPx / 2,
          layout.heightPx - 8,
          details.xLabel,
          layout.axisLabelFontSizePx,
          'text-anchor="middle"',
        );
  const labelY = layout.plotY + layout.plotHeightPx / 2;
  const yLabel =
    details.yLabel === undefined
      ? ""
      : text(
          layout.axisLabelFontSizePx,
          labelY,
          details.yLabel,
          layout.axisLabelFontSizePx,
          `text-anchor="middle" transform="rotate(-90 ${layout.axisLabelFontSizePx} ${labelY})"`,
        );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx * RASTER_DENSITY}" height="${layout.heightPx * RASTER_DENSITY}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${font}" aria-label="${escapeXml(details.title === undefined ? "Bezier chart" : `Bezier chart: ${details.title}`)}"><desc>${escapeXml(getBezierChartSummary(details))}</desc>${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}<line x1="${layout.plotX}" x2="${layout.plotX + layout.plotWidthPx}" y1="${bottom}" y2="${bottom}" stroke="${foreground}"/><line x1="${layout.plotX}" x2="${layout.plotX}" y1="${layout.plotY}" y2="${bottom}" stroke="${foreground}"/>${ticks}${guides}<path data-bezier="true" d="M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}" fill="none" stroke="${color}" stroke-width="2"/>${endpoints}${title}${xLabel}${yLabel}</svg>`;
}

export const bezierChartRenderer: ChartType<
  typeof bezierChartVariant,
  BezierChartData,
  BezierChartDetails,
  BezierChartLayout
> = {
  renderingText: "Rendering bezier chart…",
  unavailableText: "Bezier chart unavailable",
  parameters: bezierChartVariant,
  parseParameters: validateBezierChartInput,
  createDetails(data, settings) {
    return { type: "bezier", ...data, ...settings };
  },
  getCallHeader(parameters) {
    const title = normalizeText(parameters.title, "title");
    return title === undefined ? "chart" : `chart: ${title}`;
  },
  getSummary: getBezierChartSummary,
  getLayout(details, cellDimensions, widthCells) {
    return getBezierChartLayout(
      cellDimensions,
      widthCells,
      details.title !== undefined,
      details.xLabel !== undefined,
      details.yLabel !== undefined,
      details.fontSize,
    );
  },
  renderSvg: renderBezierChartSvg,
  deserializeDetails: deserializeBezierChartDetails,
};
