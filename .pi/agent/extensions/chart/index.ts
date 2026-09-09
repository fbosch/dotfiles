import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { type CellDimensions, getCellDimensions, Text } from "@earendil-works/pi-tui";
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
const SLICE_COLOR_TOKENS = [
  "accent",
  "success",
  "warning",
  "error",
  "mdLink",
  "syntaxFunction",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
] as const;

type PieChartInput = { labels: string[]; values: number[] };
type ChartRow = { label: string; value: number };
export type PieChartLayout = {
  widthPx: number;
  heightPx: number;
  chartWidthPx: number;
  legendX: number;
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
  const sliceColors = SLICE_COLOR_TOKENS.map((token) =>
    ansiColor(theme.getFgAnsi(token), "currentColor"),
  );
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
      const color = sliceColors[index] ?? "currentColor";
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
      // Pi's Image component applies the actual tool-content-width clamp at render time.
      const dimensions = ctx.mode === "tui" ? getCellDimensions() : undefined;
      const imageWidthCells = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: ctx.isProjectTrusted(),
      }).getImageWidthCells();
      const png = await rasterizeSvg(
        renderPieChartSvg(rows, ctx.ui.theme, getPieChartLayout(dimensions, imageWidthCells)),
        signal,
      );
      return {
        content: [{ type: "image", data: png, mimeType: "image/png" }],
        details: { slices: rows.length },
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("pie_chart")), 0, 0);
    },
  });
}
