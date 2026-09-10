import type { CellDimensions } from "@earendil-works/pi-tui";
import {
  createChartScene,
  defineChart,
  dot,
  rect,
  renderChartSvg as renderTanStackChartSvg,
} from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import type { SceneNode } from "@tanstack/charts/types";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type BoxplotChartInput, boxplotChartVariant } from "../schemas";
import {
  ansiColor,
  type ChartDetails,
  type ChartLayout,
  type ChartTheme,
  type ChartType,
  DEFAULT_FONT_FAMILY,
  escapeXml,
  getChartColors,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  RASTER_DENSITY,
  scaleChartFontSize,
  validCellDimensions,
} from "../types";

export type { BoxplotChartInput };
export { boxplotChartVariant };
export type BoxplotChartData = Omit<BoxplotChartInput, "type" | "showOutliers"> & {
  showOutliers: boolean;
};
export type BoxplotChartDetails = ChartDetails & BoxplotChartData & { type: "boxplot" };
export type BoxplotChartLayout = ChartLayout & {
  plotX: number;
  plotY: number;
  plotWidthPx: number;
  plotHeightPx: number;
  fontSizePx: number;
};

export function validateBoxplotChartInput(input: BoxplotChartInput): BoxplotChartData {
  if (!Value.Check(boxplotChartVariant, input)) throw new Error("invalid boxplot chart parameters");
  const labels = new Set<string>();
  const groups = input.groups.map(({ label, values }) => {
    const normalized = label.trim();
    if (!normalized || labels.has(normalized))
      throw new Error("groups must have unique nonblank labels after trimming");
    labels.add(normalized);
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error("boxplot samples must be finite numbers");
    return { label: normalized, values: [...values] };
  });
  const text = (value: string | undefined, name: string) => {
    if (value?.trim() === "") throw new Error(`${name} must not be blank`);
    return value?.trim();
  };
  const title = text(input.title, "title");
  const xLabel = text(input.xLabel, "xLabel");
  const yLabel = text(input.yLabel, "yLabel");
  return {
    groups,
    showOutliers: input.showOutliers ?? true,
    ...(title === undefined ? {} : { title }),
    ...(xLabel === undefined ? {} : { xLabel }),
    ...(yLabel === undefined ? {} : { yLabel }),
  };
}

const detailsSchema = Type.Object(
  {
    ...boxplotChartVariant.properties,
    showOutliers: Type.Boolean(),
    imageWidthCells: Type.Number({ exclusiveMinimum: 0 }),
    fontFamily: Type.String({ maxLength: 200 }),
    fontSize: Type.Optional(Type.Number({ minimum: MIN_FONT_SIZE_PX, maximum: MAX_FONT_SIZE_PX })),
  },
  { additionalProperties: false },
);

export function deserializeBoxplotChartDetails(value: unknown): BoxplotChartDetails | undefined {
  if (!Value.Check(detailsSchema, value) || !Number.isFinite(value.imageWidthCells))
    return undefined;
  const { imageWidthCells, fontFamily, fontSize, ...input } = value;
  try {
    return {
      type: "boxplot",
      ...validateBoxplotChartInput(input),
      imageWidthCells,
      fontFamily,
      ...(fontSize === undefined ? {} : { fontSize }),
    };
  } catch {
    return undefined;
  }
}

export function getBoxplotStatistics(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined) throw new Error("boxplot requires samples");
  // Type 7: linearly interpolate adjacent order statistics at zero-based rank (n - 1) * p.
  const quantile = (p: number) => {
    const rank = (sorted.length - 1) * p;
    const lower = sorted[Math.floor(rank)] ?? min;
    const upper = sorted[Math.ceil(rank)] ?? max;
    return lower + (upper - lower) * (rank - Math.floor(rank));
  };
  const q1 = quantile(0.25);
  const median = quantile(0.5);
  const q3 = quantile(0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const inliers = sorted.filter((value) => value >= lowerFence && value <= upperFence);
  return {
    min,
    q1,
    median,
    q3,
    max,
    lowerWhisker: inliers[0] ?? min,
    upperWhisker: inliers[inliers.length - 1] ?? max,
    outliers: sorted.filter((value) => value < lowerFence || value > upperFence),
  };
}

export function getBoxplotDomain(details: BoxplotChartData): [number, number] {
  const values = details.groups.flatMap((group) => group.values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Keep hidden outliers in the domain; minimum padding also protects constant and subnormal data.
  const padding = Math.max((max - min) * 0.05, Math.abs(min) * 1e-12, Math.abs(max) * 1e-12, 1e-12);
  return [min - padding, max + padding];
}

export function getBoxplotChartLayout(
  details: BoxplotChartDetails,
  cellDimensions?: CellDimensions,
  width = details.imageWidthCells,
): BoxplotChartLayout {
  const cells = validCellDimensions(cellDimensions ?? { widthPx: NaN, heightPx: NaN });
  const widthPx = Math.round(width * cells.widthPx);
  const fontSizePx = scaleChartFontSize(details.fontSize ?? 14, cells);
  const plotX = Math.min(
    widthPx * 0.4,
    Math.max(...details.groups.map((group) => group.label.length)) * fontSizePx * 0.65 +
      fontSizePx * (details.yLabel ? 2.5 : 1),
  );
  const plotY = fontSizePx * (details.title ? 2.5 : 1);
  const plotWidthPx = Math.max(1, widthPx - plotX - fontSizePx);
  const plotHeightPx = details.groups.length * Math.max(cells.heightPx * 1.5, fontSizePx * 1.6);
  const heightPx = Math.ceil(plotY + plotHeightPx + fontSizePx * (details.xLabel ? 3.5 : 2));
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

export function getBoxplotChartSummary(details: BoxplotChartDetails): string {
  return `${details.title ?? "Box plot"} (type-7 quartiles; 1.5×IQR whiskers; outlier dots ${details.showOutliers ? "shown" : "hidden"})${details.xLabel ? `; X: ${details.xLabel}` : ""}${details.yLabel ? `; Y: ${details.yLabel}` : ""}: ${details.groups
    .map((group) => {
      const s = getBoxplotStatistics(group.values);
      return `${group.label}: n=${group.values.length}, min=${s.min}, Q1=${s.q1}, median=${s.median}, Q3=${s.q3}, max=${s.max}, whiskers=${s.lowerWhisker} to ${s.upperWhisker}, outliers=${s.outliers.length}`;
    })
    .join("; ")}`;
}

export function renderBoxplotChartSvg(
  details: BoxplotChartDetails,
  theme: ChartTheme,
  layout = getBoxplotChartLayout(details),
): string {
  const [min, max] = getBoxplotDomain(details);
  const rows = details.groups.map((group, index) => ({
    ...getBoxplotStatistics(group.values),
    index,
    label: group.label,
  }));
  const foreground = ansiColor(theme.getFgAnsi("text"), "#b0b0b0");
  const color = getChartColors(theme)[0] ?? "#6aa5ad";
  const x = (value: number) => (value - min) / (max - min);
  const rowHeight = layout.plotHeightPx / rows.length;
  const scene = createChartScene(
    defineChart({
      marks: [
        rect(rows, {
          x1: (row) => x(row.q1),
          x2: (row) => x(row.q3),
          y1: (row) => rows.length - row.index - 0.75,
          y2: (row) => rows.length - row.index - 0.25,
          key: (row) => `box-${row.index}`,
          fill: color,
          fillOpacity: 0.4,
          stroke: color,
          inset: 0,
        }),
        dot(
          details.showOutliers
            ? rows.flatMap((row) =>
                [...new Set(row.outliers)].map((value) => ({
                  x: x(value),
                  y: rows.length - row.index - 0.5,
                })),
              )
            : [],
          { x: "x", y: "y", r: 2, fill: color, key: (_row, context) => `outlier-${context.index}` },
        ),
      ],
      scales: {
        x: { scale: scaleLinear().domain([0, 1]), axis: false },
        y: { scale: scaleLinear().domain([0, rows.length]), axis: false },
      },
      margin: 0,
      focus: false,
    }),
    { width: layout.plotWidthPx, height: layout.plotHeightPx },
  );
  const rules = rows.flatMap((row): SceneNode[] => {
    const y = (row.index + 0.5) * rowHeight;
    const rule = (key: string, x1: number, x2: number, y1: number, y2: number): SceneNode => ({
      kind: "rule",
      key: `${key}-${row.index}`,
      x1: x(x1) * layout.plotWidthPx,
      x2: x(x2) * layout.plotWidthPx,
      y1,
      y2,
      style: { stroke: foreground, strokeWidth: 1.5 },
    });
    return [
      rule("whisker-lower", row.lowerWhisker, row.q1, y, y),
      rule("whisker-upper", row.q3, row.upperWhisker, y, y),
      rule("lower", row.lowerWhisker, row.lowerWhisker, y - rowHeight * 0.15, y + rowHeight * 0.15),
      rule("upper", row.upperWhisker, row.upperWhisker, y - rowHeight * 0.15, y + rowHeight * 0.15),
      rule("median", row.median, row.median, y - rowHeight * 0.25, y + rowHeight * 0.25),
    ];
  });
  const plot = renderTanStackChartSvg(
    { ...scene, nodes: [...scene.nodes, ...rules] },
    { ariaLabel: "Box plot", idPrefix: "pi-boxplot" },
  )
    .replace(/^<svg\b[^>]*>/, "")
    .replace(/<\/svg>$/, "")
    // TanStack owns every dot coordinate. Drop nonvisual per-dot metadata and inherit fill to
    // fit all 1,176 possible distinct outliers inside the shared 64 KiB worker input budget.
    .replace(/<circle\b[^>]*\/>/g, (circle) =>
      circle.replace(/ (?:data-ts-key|fill)="[^"]*"/g, ""),
    );
  const font = layout.fontSizePx;
  const text = (value: string, x: number, y: number, anchor = "middle", extra = "") =>
    `<text x="${x}" y="${y}" font-size="${font}" text-anchor="${anchor}" fill="${foreground}" ${extra}>${escapeXml(value)}</text>`;
  const shorten = (value: string, space: number) => {
    const length = Math.max(1, Math.floor(space / (font * 0.65)));
    return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
  };
  const labels = rows
    .map((row) =>
      text(
        shorten(row.label, layout.plotX - font * (details.yLabel ? 2 : 0.5)),
        layout.plotX - 6,
        layout.plotY + (row.index + 0.5) * rowHeight + font * 0.35,
        "end",
      ),
    )
    .join("");
  const ticks = Array.from({ length: 3 }, (_, i) =>
    text(
      Number((min + ((max - min) * i) / 2).toPrecision(3)).toString(),
      layout.plotX + (layout.plotWidthPx * i) / 2,
      layout.plotY + layout.plotHeightPx + font * 1.3,
      i === 0 ? "start" : i === 2 ? "end" : "middle",
    ),
  ).join("");
  const middleY = layout.plotY + layout.plotHeightPx / 2;
  const annotations =
    (details.title ? text(shorten(details.title, layout.widthPx - 16), 8, font, "start") : "") +
    (details.xLabel
      ? text(
          shorten(details.xLabel, layout.plotWidthPx),
          layout.plotX + layout.plotWidthPx / 2,
          layout.heightPx - font * 0.5,
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
  const name = details.title ?? "Box plot";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx * RASTER_DENSITY}" height="${layout.heightPx * RASTER_DENSITY}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" font-family="${escapeXml(details.fontFamily ?? DEFAULT_FONT_FAMILY)}" aria-label="${escapeXml(name)}"><title>${escapeXml(name)}</title><desc>${escapeXml(getBoxplotChartSummary(details))}</desc><g fill="${escapeXml(color)}" transform="translate(${layout.plotX} ${layout.plotY})">${plot}</g>${labels}${ticks}${annotations}</svg>`;
}

export const boxplotChartRenderer: ChartType<
  typeof boxplotChartVariant,
  BoxplotChartData,
  BoxplotChartDetails,
  BoxplotChartLayout
> = {
  renderingText: "Rendering box plot…",
  unavailableText: "Box plot unavailable",
  parameters: boxplotChartVariant,
  parseParameters: validateBoxplotChartInput,
  createDetails: (data, settings) => ({ type: "boxplot", ...data, ...settings }),
  getCallHeader: (parameters) =>
    parameters.title === undefined ? "chart" : `chart: ${parameters.title.trim()}`,
  getSummary: getBoxplotChartSummary,
  getLayout: getBoxplotChartLayout,
  renderSvg: renderBoxplotChartSvg,
  deserializeDetails: deserializeBoxplotChartDetails,
};
