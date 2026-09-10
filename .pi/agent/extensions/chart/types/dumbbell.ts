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
import { type DumbbellChartInput, dumbbellChartVariant } from "../schemas";
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

import {
  clampChartPlotHeightPx,
  deserializeChartDetails,
  finalizeChartLayout,
  formatNumeric,
  renderSvgDocument,
  stripTanStackSvg,
} from "./shared";

export type { DumbbellChartInput };
export { dumbbellChartVariant };
export type DumbbellChartData = Omit<
  DumbbellChartInput,
  "type" | "beforeLabel" | "afterLabel" | "showDifferences"
> & {
  beforeLabel: string;
  afterLabel: string;
  showDifferences: boolean;
};
export type DumbbellChartDetails = ChartDetails & DumbbellChartData & { type: "dumbbell" };
export type DumbbellChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  fontSizePx: number;
};

function normalizeDumbbellChartInput(input: DumbbellChartInput): DumbbellChartData {
  const labels = new Set<string>();
  const data = input.data.map(({ label, before, after }) => {
    const normalized = label.trim();
    if (!normalized || labels.has(normalized))
      throw new Error("data must have unique nonblank labels after trimming");
    labels.add(normalized);
    if (!Number.isFinite(before) || !Number.isFinite(after))
      throw new Error("dumbbell values must be finite numbers");
    return { label: normalized, before, after };
  });
  const text = (value: string | undefined, name: string) => {
    if (value?.trim() === "") throw new Error(`${name} must not be blank`);
    return value?.trim();
  };
  const title = text(input.title, "title");
  const xLabel = text(input.xLabel, "xLabel");
  const yLabel = text(input.yLabel, "yLabel");
  return {
    data,
    ...(input.valueFormat === undefined ? {} : { valueFormat: input.valueFormat }),
    beforeLabel: text(input.beforeLabel, "beforeLabel") ?? "Before",
    afterLabel: text(input.afterLabel, "afterLabel") ?? "After",
    showDifferences: input.showDifferences ?? false,
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
}

export function validateDumbbellChartInput(input: DumbbellChartInput): DumbbellChartData {
  if (!Value.Check(dumbbellChartVariant, input))
    throw new Error("invalid dumbbell chart parameters");
  return normalizeDumbbellChartInput(input);
}

const detailsSchema = Type.Object(
  {
    ...dumbbellChartVariant.properties,
    beforeLabel: Type.String({ minLength: 1, maxLength: 22 }),
    afterLabel: Type.String({ minLength: 1, maxLength: 22 }),
    showDifferences: Type.Boolean(),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeDumbbellChartDetails(value: unknown): DumbbellChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => normalizeDumbbellChartInput(input as DumbbellChartInput),
    (data, settings) => ({ type: "dumbbell", ...data, ...settings }),
  );
}

export function getDumbbellDomain(details: DumbbellChartData): [number, number] {
  const values = details.data.flatMap((row) => [row.before, row.after]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Minimum padding protects constant, near-constant, and subnormal domains without changing values.
  const padding = Math.max((max - min) * 0.05, Math.abs(min) * 1e-12, Math.abs(max) * 1e-12, 1e-12);
  return [min - padding, max + padding];
}

export function getDumbbellChartLayout(
  details: DumbbellChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): DumbbellChartLayout {
  const cells = validCellDimensions(cellDimensions ?? { widthPx: NaN, heightPx: NaN });
  const widthPx = Math.max(1, Math.round(width * cells.widthPx));
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const plotX = Math.min(
    widthPx * 0.4,
    Math.max(...details.data.map((row) => row.label.length)) * fontSizePx * 0.65 +
      fontSizePx * (details.yLabel ? 2.5 : 1),
  );
  const plotY = fontSizePx * (details.title ? 2.5 : 1);
  const plotWidthPx = Math.max(1, widthPx - plotX - Math.min(fontSizePx, widthPx * 0.1));
  // Differences get a separate line in each row, never competing with endpoints or adjacent rows.
  const rowHeight = Math.max(
    cells.heightPx * 1.5,
    fontSizePx * (details.showDifferences ? 3.4 : 1.8),
  );
  const naturalPlotHeightPx = details.data.length * rowHeight;
  const fixedHeightPx = plotY + fontSizePx * (details.xLabel ? 6.5 : 5);
  const plotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    details.maxHeightCells,
    cells.heightPx,
    fixedHeightPx,
    undefined,
  );
  const heightPx = Math.ceil(plotY + plotHeightPx + fontSizePx * (details.xLabel ? 6.5 : 5));
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX,
      plotY,
      plotWidthPx,
      plotHeightPx,
      fontSizePx,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

export function getDumbbellChartSummary(details: DumbbellChartDetails): string {
  return `${details.title ?? "Dumbbell"}${details.xLabel ? `; X: ${details.xLabel}` : ""}${details.yLabel ? `; Y: ${details.yLabel}` : ""}: ${details.data.map((row) => `${row.label}: ${details.beforeLabel}=${row.before}, ${details.afterLabel}=${row.after}, difference=${signed(row.after - row.before)}`).join("; ")}`;
}

export function renderDumbbellChartSvg(
  details: DumbbellChartDetails,
  theme: ChartTheme,
  layout = getDumbbellChartLayout(details),
): string {
  const [min, max] = getDumbbellDomain(details);
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  // Series identity, not success/failure. A larger open ring preserves both series when values coincide.
  const beforeColor = "#579aca";
  const afterColor = "#e69f57";
  const font = layout.fontSizePx;
  const radius = Math.min(font * 0.32, layout.plotWidthPx / 8);
  const gutter = radius + Math.min(2, layout.plotWidthPx / 20);
  const innerWidth = Math.max(0.1, layout.plotWidthPx - gutter * 2);
  const x = (value: number) => (value - min) / (max - min);
  const rowHeight = layout.plotHeightPx / details.data.length;
  const rowPosition = details.showDifferences ? 0.3 : 0.5;
  const rows = details.data.map((row, index) => ({
    ...row,
    index,
    y: details.data.length - index - rowPosition,
  }));
  const scene = createChartScene(
    defineChart({
      marks: [
        dot(rows, {
          x: (row) => x(row.before),
          y: "y",
          key: (row) => `before-${row.index}`,
          r: radius,
          fill: "none",
          stroke: beforeColor,
          strokeWidth: Math.min(2, radius / 2),
        }),
        dot(rows, {
          x: (row) => x(row.after),
          y: "y",
          key: (row) => `after-${row.index}`,
          r: radius * 0.5,
          fill: afterColor,
        }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, rows.length]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: innerWidth, height: layout.plotHeightPx },
  );
  const rules: SceneNode[] = rows.map((row) => ({
    kind: "rule",
    key: `connector-${row.index}`,
    x1: x(row.before) * innerWidth,
    x2: x(row.after) * innerWidth,
    y1: (row.index + rowPosition) * rowHeight,
    y2: (row.index + rowPosition) * rowHeight,
    style: { stroke: foreground, strokeWidth: 1, strokeOpacity: 0.5 },
  }));
  const plot = stripTanStackSvg(
    renderTanStackChartSvg(
      { ...scene, nodes: [...rules, ...scene.nodes] },
      { ariaLabel: "Dumbbell", idPrefix: "pi-dumbbell" },
    ),
  );
  const text = (value: string, px: number, py: number, anchor = "middle", extra = "") =>
    `<text x="${px}" y="${py}" font-size="${font}" text-anchor="${anchor}" fill="${foreground}" ${extra}>${escapeXml(value)}</text>`;
  const shorten = (value: string, space: number) => {
    const length = Math.max(0, Math.floor(space / font));
    return length === 0 ? "" : value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  };
  const labels = rows
    .map((row) =>
      text(
        shorten(row.label, layout.plotX - font * (details.yLabel ? 2 : 0.5)),
        layout.plotX - font * 0.35,
        layout.plotY + (row.index + rowPosition) * rowHeight + font * 0.35,
        "end",
      ),
    )
    .join("");
  const differences = details.showDifferences
    ? rows
        .map((row) =>
          text(
            shorten(
              `Δ ${formatNumeric(row.after - row.before, details.valueFormat, signed)}`,
              layout.plotWidthPx,
            ),
            layout.plotX + layout.plotWidthPx / 2,
            layout.plotY + (row.index + 0.8) * rowHeight,
          ),
        )
        .join("")
    : "";
  // Reduce tick count at narrow widths rather than allowing neighboring numeric labels to overlap.
  const tickCount = innerWidth >= font * 26 ? 3 : innerWidth >= font * 18 ? 2 : 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const ratio = tickCount === 1 ? 0.5 : i / (tickCount - 1);
    return text(
      shorten(
        formatNumeric(
          Number((min + (max - min) * ratio).toPrecision(3)),
          details.valueFormat,
          String,
        ),
        innerWidth / tickCount,
      ),
      layout.plotX + gutter + innerWidth * ratio,
      layout.plotY + layout.plotHeightPx + font * 1.3,
      tickCount === 1 ? "middle" : i === 0 ? "start" : i === tickCount - 1 ? "end" : "middle",
    );
  }).join("");
  const middleY = layout.plotY + layout.plotHeightPx / 2;
  const annotations =
    (details.title ? text(shorten(details.title, layout.widthPx - 16), 8, font, "start") : "") +
    (details.xLabel
      ? text(
          shorten(details.xLabel, layout.plotWidthPx),
          layout.plotX + layout.plotWidthPx / 2,
          layout.plotY + layout.plotHeightPx + font * 2.8,
        )
      : "") +
    (details.yLabel
      ? text(
          shorten(details.yLabel, layout.plotHeightPx),
          font,
          middleY,
          "middle",
          `transform="rotate(-90 ${font} ${middleY})"`,
        )
      : "");
  const legend = [
    [details.beforeLabel, beforeColor],
    [details.afterLabel, afterColor],
  ]
    .map(([label, color], index) => {
      const py = layout.heightPx - font * (2 - index);
      return (
        `<circle cx="${font * 0.8}" cy="${py - font * 0.3}" r="${font * (index === 0 ? 0.32 : 0.16)}" fill="${index === 0 ? "none" : color}" stroke="${color}" stroke-width="${index === 0 ? 2 : 0}"/>` +
        text(shorten(label ?? "", layout.widthPx - font * 2), font * 1.8, py, "start")
      );
    })
    .join("");
  const name = details.title ?? "Dumbbell";
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: details.fontFamily ?? DEFAULT_FONT_FAMILY,
    ariaLabel: name,
    content: `<title>${escapeXml(name)}</title><desc>${escapeXml(getDumbbellChartSummary(details))}</desc><g transform="translate(${layout.plotX + gutter} ${layout.plotY})">${plot}</g>${labels}${differences}${ticks}${annotations}${legend}`,
  });
}

export const dumbbellChartRenderer: ChartType<
  typeof dumbbellChartVariant,
  DumbbellChartData,
  DumbbellChartDetails,
  DumbbellChartLayout
> = {
  renderingText: "Rendering dumbbell chart…",
  unavailableText: "Dumbbell chart unavailable",
  parameters: dumbbellChartVariant,
  parseParameters: validateDumbbellChartInput,
  createDetails: (data, settings) => ({ type: "dumbbell", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getDumbbellChartSummary,
  getLayout: getDumbbellChartLayout,
  renderSvg: renderDumbbellChartSvg,
  deserializeDetails: deserializeDumbbellChartDetails,
};
