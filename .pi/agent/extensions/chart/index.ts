import { createChartScene, defineChart, renderChartSvg } from "@tanstack/charts";
import { pie, polar, radialArc } from "@tanstack/charts/polar";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const WIDTH = 640;
const HEIGHT = 360;
const MAX_SLICES = 12;
const MAX_LABEL_LENGTH = 80;
const MAX_SVG_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const SLICE_COLORS = [
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#2dd4bf",
  "#22d3ee",
  "#818cf8",
  "#e879f9",
  "#fb7185",
  "#a3e635",
] as const;

type PieChartInput = { labels: string[]; values: number[] };
type ChartRow = { label: string; value: number };

export function validatePieChartInput(input: PieChartInput): ChartRow[] {
  if (input.labels.length !== input.values.length) {
    throw new Error("labels and values must have the same length");
  }
  if (input.labels.length < 2 || input.labels.length > MAX_SLICES) {
    throw new Error(`provide between 2 and ${MAX_SLICES} slices`);
  }

  const rows = input.labels.map((label, index) => {
    const value = input.values[index];
    if (typeof label !== "string" || label.trim().length === 0 || label.length > MAX_LABEL_LENGTH) {
      throw new Error(`label ${index + 1} must be 1-${MAX_LABEL_LENGTH} characters`);
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`value ${index + 1} must be a finite nonnegative number`);
    }
    return { label, value };
  });

  if (rows.reduce((total, row) => total + row.value, 0) <= 0) {
    throw new Error("values must have a positive total");
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
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ??
      character,
  );
}

export function renderPieChartSvg(
  rows: ChartRow[],
  theme: Pick<Theme, "getFgAnsi" | "getBgAnsi">,
): string {
  const slices = pie(rows, { value: "value", gapAngle: 0.025 });
  const definition = defineChart({
    marks: [
      polar({
        inset: 18,
        radiusRatio: 0.86,
        marks: [
          radialArc(slices, {
            innerRadius: ({ radius }) => radius * 0.5,
            color: "label",
            key: "label",
          }),
        ],
        scales: { angle: null, radius: null },
      }),
    ],
    scales: { x: null, y: null },
    color: { domain: rows.map((row) => row.label), range: SLICE_COLORS },
  });
  const scene = createChartScene(definition, { width: WIDTH, height: HEIGHT });
  const chart = renderChartSvg(scene, {
    ariaLabel: "Pie chart",
    ariaDescription: rows.map((row) => `${row.label}: ${row.value}`).join(", "),
    idPrefix: "pi-pie",
  });
  const foreground = ansiColor(theme.getFgAnsi("text"), "#e5e7eb");
  const background = ansiColor(theme.getBgAnsi("toolSuccessBg"), "#111827");
  const legend = rows
    .map((row, index) => {
      const y = 24 + index * 25;
      const percentage = (
        (row.value / rows.reduce((total, item) => total + item.value, 0)) *
        100
      ).toFixed(1);
      return `<rect x="432" y="${y - 11}" width="10" height="10" rx="2" fill="${SLICE_COLORS[index] ?? SLICE_COLORS[0]}"/><text x="448" y="${y}" fill="${foreground}" font-family="sans-serif" font-size="12">${escapeXml(row.label)} ${percentage}%</text>`;
    })
    .join("");
  return chart
    .replace(">", `><rect width="100%" height="100%" fill="${background}"/>`)
    .replace("</svg>", `<g>${legend}</g></svg>`);
}

async function rasterizeSvg(svg: string, signal?: AbortSignal): Promise<string> {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES)
    throw new Error("chart SVG exceeded the resource limit");
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
      const abort = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", reject);
      child.once("exit", (code) => {
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) reject(new DOMException("Aborted", "AbortError"));
        else if (code === 0) resolve();
        else reject(new Error(`rsvg-convert exited with code ${code ?? "unknown"}`));
      });
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
      const png = await rasterizeSvg(renderPieChartSvg(rows, ctx.ui.theme), signal);
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
