import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  rect,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { SceneNode } from "@tanstack/charts/types";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { MAX_WATERFALL_VALUE, type WaterfallChartInput, waterfallChartVariant } from "../schemas";
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

export type { WaterfallChartInput };
export { waterfallChartVariant };
export type WaterfallChartData = Omit<WaterfallChartInput, "type">;
export type WaterfallChartDetails = ChartDetails & WaterfallChartData & { type: "waterfall" };
export type WaterfallChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  fontSizePx: number;
  compact: boolean;
};

function normalizeWaterfallChartInput(input: WaterfallChartInput): WaterfallChartData {
  const text = (value: string | undefined, name: string) => {
    if (value?.trim() === "") throw new Error(`${name} must not be blank`);
    return value?.trim();
  };
  const deltas = input.deltas.map(({ label, value }) => ({
    label: text(label, "delta label") ?? "",
    value,
  }));
  const title = text(input.title, "title");
  const xLabel = text(input.xLabel, "xLabel");
  const yLabel = text(input.yLabel, "yLabel");
  const data = {
    start: input.start,
    deltas,
    ...(input.valueFormat === undefined ? {} : { valueFormat: input.valueFormat }),
    ...(input.maxHeightCells === undefined ? {} : { maxHeightCells: input.maxHeightCells }),
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
  getWaterfallRows(data);
  return data;
}

export function validateWaterfallChartInput(input: WaterfallChartInput): WaterfallChartData {
  if (!Value.Check(waterfallChartVariant, input))
    throw new Error("invalid waterfall chart parameters");
  return normalizeWaterfallChartInput(input);
}

const detailsSchema = Type.Object(
  {
    ...waterfallChartVariant.properties,
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeWaterfallChartDetails(
  value: unknown,
): WaterfallChartDetails | undefined {
  return deserializeChartDetails(
    value,
    detailsSchema,
    (input) => normalizeWaterfallChartInput(input as WaterfallChartInput),
    (data, settings) => ({ type: "waterfall", ...data, ...settings }),
  );
}

export function getWaterfallRows(data: WaterfallChartData) {
  const bounded = (value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_WATERFALL_VALUE)
      throw new Error(
        "waterfall start, deltas, and running totals must be finite within ±1,000,000,000",
      );
    return value;
  };
  let total = bounded(data.start);
  const rows = [{ label: "Start", from: 0, to: total, value: total, isTotal: true }];
  for (const delta of data.deltas) {
    const from = total;
    // Never round between steps: replay, geometry and the text summary use the same arithmetic.
    total = bounded(total + bounded(delta.value));
    rows.push({ label: delta.label, from, to: total, value: delta.value, isTotal: false });
  }
  rows.push({ label: "Total", from: 0, to: total, value: total, isTotal: true });
  return rows;
}

export function getWaterfallDomain(data: WaterfallChartData): [number, number] {
  const totals = getWaterfallRows(data).map((row) => row.to);
  const min = Math.min(0, ...totals);
  const max = Math.max(0, ...totals);
  // Minimum display padding keeps zero-only and subnormal domains usable without altering totals.
  const padding = Math.max((max - min) * 0.05, 1e-12);
  return [min - padding, max + padding];
}

function getCompactedFontSize(
  baseFontSizePx: number,
  capHeightPx: number,
  rowCount: number,
  topBandFactor: number,
  bottomBandFactor: number,
): number {
  for (
    let fontSizePx = Math.floor(baseFontSizePx);
    fontSizePx >= MIN_FONT_SIZE_PX;
    fontSizePx -= 1
  ) {
    const availablePlotHeightPx = capHeightPx - fontSizePx * (topBandFactor + bottomBandFactor);
    if (availablePlotHeightPx / rowCount >= fontSizePx * 1.05) return fontSizePx;
  }
  return MIN_FONT_SIZE_PX;
}

export function getWaterfallChartLayout(
  details: WaterfallChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): WaterfallChartLayout {
  const cells = validCellDimensions(cellDimensions ?? { widthPx: NaN, heightPx: NaN });
  const widthPx = Math.round(width * cells.widthPx);
  const baseFontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const plotX = Math.min(
    widthPx * 0.4,
    Math.max(5, ...details.deltas.map((delta) => delta.label.length)) * baseFontSizePx * 0.65 +
      baseFontSizePx * (details.yLabel ? 2.5 : 1),
  );
  const basePlotY = baseFontSizePx * (details.title ? 2.5 : 1);
  const rowCount = details.deltas.length + 2;
  const baseNaturalPlotHeightPx = rowCount * Math.max(cells.heightPx * 1.5, baseFontSizePx * 1.6);
  const baseBottomBandPx = baseFontSizePx * (details.xLabel ? 7.5 : 6);
  const baseFixedHeightPx = basePlotY + baseBottomBandPx;
  const baseDisplayPlotHeightPx = clampChartPlotHeightPx(
    baseNaturalPlotHeightPx,
    undefined,
    cells.heightPx,
    baseFixedHeightPx,
    undefined,
  );
  const baseNaturalHeightPx = baseFixedHeightPx + baseDisplayPlotHeightPx;
  const capHeightPx =
    details.maxHeightCells === undefined
      ? Number.POSITIVE_INFINITY
      : Math.floor(details.maxHeightCells * cells.heightPx);
  const compact = capHeightPx < baseNaturalHeightPx;
  const topBandFactor = details.title ? 1.6 : 1;
  // Compact views use one horizontal legend row and tight tick/axis-label bands.
  const bottomBandFactor = 1.1 + (details.xLabel ? 1.5 : 0) + 1.6;
  const fontSizePx = compact
    ? getCompactedFontSize(baseFontSizePx, capHeightPx, rowCount, topBandFactor, bottomBandFactor)
    : baseFontSizePx;
  const plotY = compact ? fontSizePx * topBandFactor : basePlotY;
  const naturalPlotHeightPx = rowCount * Math.max(cells.heightPx * 1.5, fontSizePx * 1.6);
  const fixedHeightPx = compact ? plotY + fontSizePx * bottomBandFactor : plotY + baseBottomBandPx;
  const plotHeightPx = clampChartPlotHeightPx(
    naturalPlotHeightPx,
    details.maxHeightCells,
    cells.heightPx,
    fixedHeightPx,
    undefined,
  );
  const heightPx = Math.ceil(plotY + plotHeightPx + (fixedHeightPx - plotY));
  return finalizeChartLayout(
    {
      widthPx,
      heightPx,
      plotX,
      plotY,
      plotWidthPx: Math.max(1, widthPx - plotX - fontSizePx),
      plotHeightPx,
      fontSizePx,
      compact,
    },
    cells.heightPx,
    details.maxHeightCells,
  );
}

export function getWaterfallChartSummary(details: WaterfallChartDetails): string {
  const rows = getWaterfallRows(details);
  return `${details.title ?? "Waterfall"}${details.xLabel ? `; X: ${details.xLabel}` : ""}${details.yLabel ? `; Y: ${details.yLabel}` : ""}: ${rows.map((row) => (row.isTotal ? `${row.label}: ${row.to}` : `${row.label}: ${row.value > 0 ? "+" : ""}${row.value} (${row.from} → ${row.to})`)).join("; ")}`;
}

export function renderWaterfallChartSvg(
  details: WaterfallChartDetails,
  theme: ChartTheme,
  layout = getWaterfallChartLayout(details),
): string {
  const rows = getWaterfallRows(details).map((row, index) => ({ ...row, index }));
  const [min, max] = getWaterfallDomain(details);
  const x = (value: number) => (value - min) / (max - min);
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  // Direction is not success/failure. Fixed blue/orange keys stay distinct even in monochrome themes.
  const increase = "#579aca";
  const decrease = "#e69f57";
  const color = (row: (typeof rows)[number]) =>
    row.isTotal || row.value === 0 ? foreground : row.value > 0 ? increase : decrease;
  const rowHeight = layout.plotHeightPx / rows.length;
  const scene = createChartScene(
    defineChart({
      marks: [foreground, increase, decrease].map((fill) =>
        rect(
          rows.filter((row) => color(row) === fill),
          {
            x1: (row) => x(Math.min(row.from, row.to)),
            x2: (row) => x(Math.max(row.from, row.to)),
            y1: (row) => rows.length - row.index - 0.75,
            y2: (row) => rows.length - row.index - 0.25,
            key: (row) => `bar-${row.index}`,
            fill,
            stroke: fill,
            inset: 0,
          },
        ),
      ),
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, rows.length]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  const rule = (
    key: string,
    value: number,
    y1: number,
    y2: number,
    stroke = foreground,
    strokeDasharray?: string,
  ): SceneNode => ({
    kind: "rule",
    key,
    x1: x(value) * layout.plotWidthPx,
    x2: x(value) * layout.plotWidthPx,
    y1,
    y2,
    style: {
      stroke,
      // A thicker dashed overlay keeps a zero-width change identifiable even when it sits on zero.
      strokeWidth: strokeDasharray === undefined ? 1 : 2,
      ...(strokeDasharray === undefined ? {} : { strokeDasharray }),
    },
  });
  const rules: SceneNode[] = [rule("zero", 0, 0, layout.plotHeightPx)];
  for (const row of rows) {
    if (row.index < rows.length - 1)
      rules.push(
        rule(
          `connector-${row.index}`,
          row.to,
          (row.index + 0.75) * rowHeight,
          (row.index + 1.25) * rowHeight,
        ),
      );
    // A zero-width rectangle has no visible area; an exact-position rule shows unchanged steps.
    if (row.from === row.to)
      rules.push(
        rule(
          `zero-bar-${row.index}`,
          row.to,
          (row.index + 0.25) * rowHeight,
          (row.index + 0.75) * rowHeight,
          color(row),
          "2 2",
        ),
      );
  }
  const plot = stripTanStackSvg(
    renderTanStackChartSvg(
      { ...scene, nodes: [...rules, ...scene.nodes] },
      { ariaLabel: "Waterfall", idPrefix: "pi-waterfall" },
    ),
  );
  const font = layout.fontSizePx;
  const text = (value: string, px: number, py: number, anchor = "middle", extra = "") =>
    `<text x="${px}" y="${py}" font-size="${font}" text-anchor="${anchor}" fill="${foreground}" ${extra}>${escapeXml(value)}</text>`;
  const shorten = (value: string, space: number) => {
    const length = Math.max(1, Math.floor(space / (font * 0.65)));
    return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  };
  const labelRows: typeof rows = [];
  let lastLabelY = Number.NEGATIVE_INFINITY;
  const minimumLabelGap = font * 1.05;
  for (const row of rows) {
    const y = layout.plotY + (row.index + 0.5) * rowHeight + font * 0.35;
    if (row.index === rows.length - 1) {
      const previous = labelRows.at(-1);
      if (previous !== undefined) {
        const previousY = layout.plotY + (previous.index + 0.5) * rowHeight + font * 0.35;
        if (y - previousY < minimumLabelGap) labelRows.pop();
      }
    }
    if (y - lastLabelY >= minimumLabelGap) {
      labelRows.push(row);
      lastLabelY = y;
    }
  }
  const labels = labelRows
    .map((row) =>
      text(
        shorten(row.label, layout.plotX - font * (details.yLabel ? 2 : 0.5)),
        layout.plotX - 6,
        layout.plotY + (row.index + 0.5) * rowHeight + font * 0.35,
        "end",
      ),
    )
    .join("");
  const tickBaseline = layout.compact
    ? layout.plotY + layout.plotHeightPx + font * 1.1
    : layout.plotY + layout.plotHeightPx + font * 1.3;
  const ticks = Array.from({ length: 3 }, (_, i) =>
    text(
      formatNumeric(
        Number((min + ((max - min) * i) / 2).toPrecision(3)),
        details.valueFormat,
        String,
      ),
      layout.plotX + (layout.plotWidthPx * i) / 2,
      tickBaseline,
      i === 0 ? "start" : i === 2 ? "end" : "middle",
    ),
  ).join("");
  const middleY = layout.plotY + layout.plotHeightPx / 2;
  const title = details.title
    ? text(shorten(details.title, layout.widthPx - 16), 8, font, "start")
    : "";
  const xLabel = details.xLabel
    ? text(
        shorten(details.xLabel, layout.plotWidthPx),
        layout.plotX + layout.plotWidthPx / 2,
        layout.compact
          ? layout.heightPx - font * 1.9
          : layout.plotY + layout.plotHeightPx + font * 2.8,
      )
    : "";
  const yLabel = details.yLabel
    ? text(
        shorten(details.yLabel, layout.plotHeightPx),
        font,
        middleY,
        "middle",
        `transform="rotate(-90 ${font} ${middleY})"`,
      )
    : "";
  const annotations = title + xLabel + yLabel;
  const legend = layout.compact
    ? (() => {
        const entries = [
          ["Increase (+)", increase],
          ["Decrease (−)", decrease],
          ["Start / Total / Zero", foreground],
        ] as const;
        let px = 8;
        const py = layout.heightPx - font * 0.35;
        return entries
          .map(([label, fill], index) => {
            const markerWidth = font * 0.7;
            const textX = px + font * 1.1;
            const available = Math.max(1, layout.widthPx - textX);
            const maximumCharacters = Math.max(1, Math.floor(available / (font * 0.58)));
            const fitted =
              label.length <= maximumCharacters
                ? label
                : maximumCharacters === 1
                  ? "…"
                  : `${label.slice(0, maximumCharacters - 1)}…`;
            const textWidth = fitted.length * font * 0.58;
            const entry =
              `<rect x="${px}" y="${py - font * 0.7}" width="${markerWidth}" height="${font * 0.7}" fill="${fill}"/>` +
              text(fitted, textX, py, "start");
            px = textX + textWidth + (index === entries.length - 1 ? 0 : font * 0.3);
            return entry;
          })
          .join("");
      })()
    : [
        ["Increase (+)", increase],
        ["Decrease (−)", decrease],
        ["Start / Total / Zero", foreground],
      ]
        .map(([label, fill], index) => {
          const py = layout.heightPx - font * (3 - index);
          return (
            `<rect x="8" y="${py - font * 0.7}" width="${font * 0.7}" height="${font * 0.7}" fill="${fill}"/>` +
            text(shorten(label ?? "", layout.widthPx - font * 2), font * 1.8, py, "start")
          );
        })
        .join("");
  const name = details.title ?? "Waterfall";
  return renderSvgDocument({
    widthPx: layout.widthPx * RASTER_DENSITY,
    heightPx: layout.heightPx * RASTER_DENSITY,
    viewBoxWidthPx: layout.widthPx,
    viewBoxHeightPx: layout.heightPx,
    fontFamily: details.fontFamily ?? DEFAULT_FONT_FAMILY,
    ariaLabel: name,
    content: `<title>${escapeXml(name)}</title><desc>${escapeXml(getWaterfallChartSummary(details))}</desc><g transform="translate(${layout.plotX} ${layout.plotY})">${plot}</g>${labels}${ticks}${annotations}${legend}`,
  });
}

export const waterfallChartRenderer: ChartType<
  typeof waterfallChartVariant,
  WaterfallChartData,
  WaterfallChartDetails,
  WaterfallChartLayout
> = {
  renderingText: "Rendering waterfall…",
  unavailableText: "Waterfall unavailable",
  parameters: waterfallChartVariant,
  parseParameters: validateWaterfallChartInput,
  createDetails: (data, settings) => ({ type: "waterfall", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getWaterfallChartSummary,
  getLayout: getWaterfallChartLayout,
  renderSvg: renderWaterfallChartSvg,
  deserializeDetails: deserializeWaterfallChartDetails,
};
