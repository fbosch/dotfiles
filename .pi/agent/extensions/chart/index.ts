import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  type CellDimensions,
  getCellDimensions,
  Image,
  Text,
  truncateToWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { createChartScene, defineChart, renderChartSvg } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import { Type } from "typebox";

const DEFAULT_IMAGE_WIDTH_CELLS = 60;
const FALLBACK_CELL_DIMENSIONS = { widthPx: 9, heightPx: 18 };
const CHART_HEIGHT_CELLS = 20;
const CHART_WIDTH_RATIO = 0.62;
const MAX_SLICES = 12;
const MAX_LABEL_LENGTH = 22;
const MAX_SVG_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const RASTERIZE_TIMEOUT_MS = 10_000;
const MAX_CACHED_RASTERS = 4;
const SLICE_COLOR_TOKENS = [
  "accent",
  "success",
  "warning",
  "error",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
] as const satisfies readonly ThemeColor[];

type PieChartInput = { labels: string[]; values: number[] };
type ChartRow = { label: string; value: number };
export type PieChartLayout = {
  widthPx: number;
  heightPx: number;
  chartWidthPx: number;
  legendX: number;
};
export type PieChartDetails = {
  rows: ChartRow[];
  imageWidthCells: number;
};
type Rasterize = (svg: string, signal?: AbortSignal) => Promise<string>;

type RasterKey = {
  widthCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
};

export function getPieChartLayout(
  cellDimensions?: CellDimensions,
  imageWidthCells = DEFAULT_IMAGE_WIDTH_CELLS,
): PieChartLayout {
  const cellWidth = cellDimensions?.widthPx;
  const cellHeight = cellDimensions?.heightPx;
  const validDimensions =
    typeof cellWidth === "number" &&
    Number.isFinite(cellWidth) &&
    cellWidth > 0 &&
    typeof cellHeight === "number" &&
    Number.isFinite(cellHeight) &&
    cellHeight > 0;
  const dimensions = validDimensions
    ? { widthPx: cellWidth, heightPx: cellHeight }
    : FALLBACK_CELL_DIMENSIONS;
  const widthPx = Math.round(imageWidthCells * dimensions.widthPx);
  const heightPx = Math.round(CHART_HEIGHT_CELLS * dimensions.heightPx);
  const chartWidthPx = Math.round(widthPx * CHART_WIDTH_RATIO);

  return { widthPx, heightPx, chartWidthPx, legendX: chartWidthPx + 20 };
}

export function validatePieChartInput(input: PieChartInput): ChartRow[] {
  if (input.labels.length !== input.values.length) {
    throw new Error("labels and values must have the same length");
  }
  if (input.labels.length < 2 || input.labels.length > MAX_SLICES) {
    throw new Error(`provide between 2 and ${MAX_SLICES} slices`);
  }

  const labels = new Set<string>();
  const rows = input.labels.map((label, index) => {
    const value = input.values[index];
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

function ansiColor(ansi: string, fallback: string): string {
  const rgb = ansi.match(/(?:38|48);2;(\d+);(\d+);(\d+)/);
  if (rgb) return `rgb(${rgb[1]}, ${rgb[2]}, ${rgb[3]})`;
  const indexed = ansi.match(/(?:38|48);5;(\d+)/);
  if (!indexed) return fallback;
  const index = Number(indexed[1]);
  if (index < 16) {
    const basic = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ];
    return basic[index] ?? fallback;
  }
  if (index >= 232) {
    const shade = 8 + (index - 232) * 10;
    return `rgb(${shade}, ${shade}, ${shade})`;
  }
  const cube = index - 16;
  const channel = (value: number) => [0, 95, 135, 175, 215, 255][value] ?? 0;
  return `rgb(${channel(Math.floor(cube / 36))}, ${channel(Math.floor((cube % 36) / 6))}, ${channel(cube % 6)})`;
}

function getSliceColors(theme: Pick<Theme, "getFgAnsi">): string[] {
  const colors = new Set<string>();
  for (const token of SLICE_COLOR_TOKENS) {
    colors.add(ansiColor(theme.getFgAnsi(token), "currentColor"));
  }
  return [...colors];
}

function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&apos;", '"': "&quot;" })[character] ?? character,
  );
}

export function renderPieChartSvg(
  rows: ChartRow[],
  theme: Pick<Theme, "getFgAnsi">,
  layout = getPieChartLayout(),
): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const slices = pie(rows, { value: "value", gapAngle: 0.025 });
  const sliceColors = getSliceColors(theme);
  const definition = defineChart({
    marks: [
      polar({
        inset: 18,
        radiusRatio: 0.86,
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
    width: layout.chartWidthPx,
    height: layout.heightPx,
  });
  const chart = renderChartSvg(scene, { ariaLabel: "Pie chart", idPrefix: "pi-pie" });
  const foreground = ansiColor(theme.getFgAnsi("text"), "currentColor");
  const legend = rows
    .map((row, index) => {
      const y = 24 + index * 27;
      const percentage = ((row.value / total) * 100).toFixed(1);
      const color = sliceColors[index % sliceColors.length] ?? "currentColor";
      return `<rect x="${layout.legendX}" y="${y - 11}" width="10" height="10" rx="2" fill="${color}"/><text x="${layout.legendX + 16}" y="${y}" fill="${foreground}" font-family="sans-serif" font-size="12">${escapeXml(row.label)}</text><text x="${layout.legendX + 16}" y="${y + 11}" fill="${foreground}" font-family="sans-serif" font-size="10">${percentage}%</text>`;
    })
    .join("");
  const chartBody = chart.replace(/^<svg\b[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthPx}" height="${layout.heightPx}" viewBox="0 0 ${layout.widthPx} ${layout.heightPx}" role="img" aria-label="Pie chart" aria-description="${escapeXml(rows.map((row) => `${row.label}: ${row.value}`).join(", "))}"><g>${chartBody}</g><g>${legend}</g></svg>`;
}

export async function rasterizeSvg(svg: string, signal?: AbortSignal): Promise<string> {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) {
    throw new Error("chart SVG exceeded the resource limit");
  }
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "pi-chart-"));
  const input = join(directory, "chart.svg");
  const output = join(directory, "chart.png");
  try {
    await writeFile(input, svg, "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("rsvg-convert", ["--format", "png", "--output", output, input], {
        stdio: "ignore",
      });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => {
        child.kill("SIGKILL");
        finish(new DOMException("Aborted", "AbortError"));
      };
      const onError = (error: Error) => finish(error);
      const onExit = (code: number | null) => {
        if (signal?.aborted) finish(new DOMException("Aborted", "AbortError"));
        else if (code === 0) finish();
        else finish(new Error(`rsvg-convert exited with code ${code ?? "unknown"}`));
      };
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error(`rsvg-convert timed out after ${RASTERIZE_TIMEOUT_MS}ms`));
      }, RASTERIZE_TIMEOUT_MS);

      child.once("error", onError);
      child.once("exit", onExit);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    signal?.throwIfAborted();
    const png = await readFile(output);
    if (png.byteLength > MAX_PNG_BYTES) throw new Error("chart PNG exceeded the resource limit");
    return png.toString("base64");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validCellDimensions(dimensions: CellDimensions): CellDimensions {
  return Number.isFinite(dimensions.widthPx) &&
    dimensions.widthPx > 0 &&
    Number.isFinite(dimensions.heightPx) &&
    dimensions.heightPx > 0
    ? dimensions
    : FALLBACK_CELL_DIMENSIONS;
}

function rasterKeyString(key: RasterKey): string {
  return `${key.widthCells}:${key.cellWidthPx}:${key.cellHeightPx}`;
}

/** Renders only from the stored data so resizing never mutates the tool result. */
export class PieChartComponent implements Component {
  private readonly cache = new Map<string, string>();
  private pending?: { key: string; controller: AbortController; generation: number };
  private generation = 0;
  private theme: Theme;

  constructor(
    private readonly details: PieChartDetails,
    theme: Theme,
    private readonly requestRender: () => void,
    private readonly rasterize: Rasterize = rasterizeSvg,
  ) {
    this.theme = theme;
  }

  update(theme: Theme): void {
    this.theme = theme;
  }

  invalidate(): void {
    this.cache.clear();
  }

  render(width: number): string[] {
    const dimensions = validCellDimensions(getCellDimensions());
    // Image reserves two columns from its input width before applying maxWidthCells.
    const widthCells = Math.max(1, Math.min(this.details.imageWidthCells, width - 2));
    const key = {
      widthCells,
      cellWidthPx: dimensions.widthPx,
      cellHeightPx: dimensions.heightPx,
    };
    const cacheKey = rasterKeyString(key);
    const png = this.cache.get(cacheKey);
    if (png) {
      return new Image(
        png,
        "image/png",
        { fallbackColor: (text) => this.theme.fg("toolOutput", text) },
        { maxWidthCells: widthCells },
      ).render(width);
    }

    this.startRaster(cacheKey, key);
    return [truncateToWidth(this.theme.fg("muted", "Rendering pie chart…"), width)];
  }

  private startRaster(cacheKey: string, key: RasterKey): void {
    if (this.pending?.key === cacheKey) return;
    this.pending?.controller.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.pending = { key: cacheKey, controller, generation };
    const layout = getPieChartLayout(
      { widthPx: key.cellWidthPx, heightPx: key.cellHeightPx },
      key.widthCells,
    );
    const svg = renderPieChartSvg(this.details.rows, this.theme, layout);

    void this.rasterize(svg, controller.signal)
      .then((png) => {
        if (controller.signal.aborted || this.pending?.generation !== generation) return;
        this.cache.set(cacheKey, png);
        while (this.cache.size > MAX_CACHED_RASTERS) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey !== undefined) this.cache.delete(oldestKey);
        }
        this.pending = undefined;
        this.requestRender();
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || this.pending?.generation !== generation) return;
        this.pending = undefined;
        this.requestRender();
      });
  }
}

function chartText(rows: ChartRow[]): string {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return `Pie chart: ${rows
    .map((row) => `${row.label} ${row.value} (${((row.value / total) * 100).toFixed(1)}%)`)
    .join("; ")}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "pie_chart",
    label: "Pie Chart",
    description:
      "Render a compact pie chart from matching JSON-safe labels and nonnegative numeric values.",
    promptSnippet: "Render simple pie charts from labels and values",
    parameters: Type.Object({
      labels: Type.Array(Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }), {
        minItems: 2,
        maxItems: MAX_SLICES,
      }),
      values: Type.Array(Type.Number({ minimum: 0, maximum: 1_000_000_000 }), {
        minItems: 2,
        maxItems: MAX_SLICES,
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const rows = validatePieChartInput(params);
      const imageWidthCells = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: ctx.isProjectTrusted(),
      }).getImageWidthCells();
      const details: PieChartDetails = { rows, imageWidthCells };
      const text = chartText(rows);
      if (ctx.mode === "tui") {
        // Pi 0.85.1 always appends content images after renderResult; details retain replay data instead.
        return { content: [{ type: "text", text }], details };
      }

      const png = await rasterizeSvg(
        renderPieChartSvg(rows, ctx.ui.theme, getPieChartLayout(undefined, imageWidthCells)),
        signal,
      );
      return {
        content: [
          { type: "text", text },
          { type: "image", data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("pie_chart")), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const details = result.details as PieChartDetails | undefined;
      if (!details || !Array.isArray(details.rows)) {
        const text = result.content.find((content) => content.type === "text");
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const previous = context.lastComponent;
      if (previous instanceof PieChartComponent) {
        previous.update(theme);
        return previous;
      }
      return new PieChartComponent(details, theme, context.invalidate);
    },
  });
}
