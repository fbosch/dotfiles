import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { SceneNode } from "@tanstack/charts/types";
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

import {
  clampChartPlotHeightPx,
  deserializeChartDetails,
  finalizeChartLayout,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

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
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
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
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => validateBezierChartInput(input as BezierChartInput),
    (_data, _settings, rawDetails) => rawDetails as unknown as BezierChartDetails,
    {
      validateSettings: (settings) =>
        settings.fontFamily !== undefined && settings.fontFamily.trim().length > 0,
    },
  );
}

export function getBezierChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
  hasTitle = false,
  hasXLabel = false,
  hasYLabel = false,
  fontSize?: number,
  maxHeightCells?: number,
): BezierChartLayout {
  const cells = validCellDimensions(
    cellDimensions ?? { widthPx: Number.NaN, heightPx: Number.NaN },
  );
  const padding = Math.max(4, Math.round(cells.widthPx * 0.5));
  const axisLabelFontSizePx = scaleChartFontSize(fontSize ?? 13, cells);
  const titleFontSizePx = Math.round(axisLabelFontSizePx * 1.1);
  const plotX = padding + (hasYLabel ? axisLabelFontSizePx + padding : 0);
  const plotY = padding + (hasTitle ? titleFontSizePx + padding : 0);
  const bottom = padding + (hasXLabel ? axisLabelFontSizePx + padding : 0);
  // A compact square in physical pixels, not terminal cells; labels reserve only their own space.
  const naturalPlotWidthPx = Math.max(
    1,
    Math.floor(
      Math.min(
        imageWidthCells * cells.widthPx - plotX - padding,
        10 * cells.heightPx,
        MAX_CHART_HEIGHT_CELLS * cells.heightPx - plotY - bottom,
      ),
    ),
  );
  const plotWidthPx = clampChartPlotHeightPx(
    naturalPlotWidthPx,
    maxHeightCells,
    cells.heightPx,
    plotY + bottom,
    MAX_CHART_HEIGHT_CELLS,
  );
  const plotHeightPx = plotWidthPx;
  const widthPx = plotX + plotWidthPx + padding;
  const heightPx = plotY + plotHeightPx + bottom;
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX,
      plotY,
      plotWidthPx,
      plotHeightPx,
      axisLabelFontSizePx,
      titleFontSizePx,
    },
    cells.heightPx,
    maxHeightCells,
  );
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
    details.maxHeightCells,
  ),
): string {
  const geometry = getBezierChartGeometry(details, layout);
  const { project } = geometry;
  const start = project(details.start);
  const control1 = project(details.control1);
  const control2 = project(details.control2);
  const end = project(details.end);
  const color = getChartColors(theme)[0] ?? "#6aa5ad";
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const font = escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY);
  const text = (x: number, y: number, content: string, size: number, attributes = "") =>
    `<text x="${x}" y="${y}" fill="${foreground}" font-size="${size}" ${attributes}>${escapeXml(content)}</text>`;
  const scene = createChartScene(
    defineChart({
      marks: [
        dot([start, end], {
          x: "x",
          y: "y",
          key: (_point, context) => context.index,
          r: 3,
          fill: color,
        }),
      ],
      // Projection already uses one centered scale to keep subnormal and near-coincident inputs safe.
      scales: {
        x: { scale: scaleLinear().domain([0, layout.widthPx]), axis: false },
        y: { scale: scaleLinear().domain([layout.heightPx, 0]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.widthPx, height: layout.heightPx },
  );
  const guides: SceneNode[] = details.showControls
    ? [
        ...[
          { anchor: start, control: control1 },
          { anchor: end, control: control2 },
        ].map(
          ({ anchor, control }, index): SceneNode => ({
            kind: "rule",
            key: `control-guide-${index}`,
            x1: anchor.x,
            y1: anchor.y,
            x2: control.x,
            y2: control.y,
            style: { stroke: foreground, strokeOpacity: 0.35, strokeWidth: 1 },
          }),
        ),
        ...[control1, control2].map(
          (point, index): SceneNode => ({
            kind: "dot",
            key: `control-${index}`,
            x: point.x,
            y: point.y,
            radius: 3,
            style: { fill: foreground, fillOpacity: 0.5 },
          }),
        ),
      ]
    : [];
  // TanStack scene paths accept an exact cubic; a sampled line mark would change its geometry.
  const curve: SceneNode = {
    kind: "polyline",
    key: "bezier",
    points: [],
    path: `M ${start.x} ${start.y} C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${end.x} ${end.y}`,
    style: { fill: "none", stroke: color, strokeWidth: 2, lineCap: "round" },
  };
  const chart = renderTanStackChartSvg(
    { ...scene, nodes: [...guides, curve, ...scene.nodes] },
    {
      ariaLabel: "Bezier chart",
      idPrefix: "pi-bezier",
    },
  );
  const chartBody = stripTanStackSvg(chart);
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
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: font,
    ariaLabel: details.title === undefined ? "Bezier chart" : `Bezier chart: ${details.title}`,
    content: `<desc>${escapeXml(getBezierChartSummary(details))}</desc>${details.title === undefined ? "" : `<title>${escapeXml(details.title)}</title>`}${chartBody}${title}${xLabel}${yLabel}`,
  });
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
      details.maxHeightCells,
    );
  },
  renderSvg: renderBezierChartSvg,
  deserializeDetails: deserializeBezierChartDetails,
};
