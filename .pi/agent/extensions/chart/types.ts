import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type CellDimensions,
  type Component,
  getCellDimensions,
  Image,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";

export const DEFAULT_IMAGE_WIDTH_CELLS = 60;
export const FALLBACK_CELL_DIMENSIONS = { widthPx: 9, heightPx: 18 };
export const MAX_CHART_HEIGHT_CELLS = 18;
export const RASTER_DENSITY = 2;
export const DEFAULT_FONT_FAMILY = "sans-serif";

const MAX_FONT_FAMILY_LENGTH = 200;
const MAX_SVG_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const RASTERIZE_TIMEOUT_MS = 10_000;
const MAX_CACHED_RASTERS = 4;
const CHART_COLOR_TOKENS = [
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
] as const satisfies readonly Parameters<Theme["getFgAnsi"]>[0][];

export type ChartTheme = Pick<Theme, "getFgAnsi">;

export type ChartLayout = {
  widthPx: number;
  heightPx: number;
  heightCells: number;
};

export type ChartDetails = {
  imageWidthCells: number;
  /** Optional only for chart results saved before font configuration existed. */
  fontFamily?: string;
};

export type ChartSettings = {
  imageWidthCells: number;
  fontFamily: string;
};

export interface ChartRenderer<TDetails extends ChartDetails, TLayout extends ChartLayout> {
  readonly renderingText: string;
  readonly unavailableText: string;
  getLayout(
    details: TDetails,
    cellDimensions: CellDimensions | undefined,
    widthCells: number,
  ): TLayout;
  renderSvg(details: TDetails, theme: ChartTheme, layout: TLayout): string;
}

export interface ChartType<
  TParameters extends TSchema,
  TData,
  TDetails extends ChartDetails,
  TLayout extends ChartLayout,
> extends ChartRenderer<TDetails, TLayout> {
  readonly parameters: TParameters;
  parseParameters(parameters: Static<TParameters>): TData;
  createDetails(data: TData, settings: ChartSettings): TDetails;
  getCallHeader(parameters: Static<TParameters>): string;
  getSummary(details: TDetails): string;
  deserializeDetails(value: unknown): TDetails | undefined;
}

export type Rasterize = (svg: string, signal?: AbortSignal) => Promise<string>;

type RasterKey = {
  widthCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
};

export function resolveChartFontFamily(globalSettings: unknown, projectSettings: unknown): string {
  return (
    configuredChartFontFamily(projectSettings, "project") ??
    configuredChartFontFamily(globalSettings, "global") ??
    DEFAULT_FONT_FAMILY
  );
}

function configuredChartFontFamily(
  settings: unknown,
  scope: "global" | "project",
): string | undefined {
  if (isRecord(settings) === false || settings.charts === undefined) return undefined;
  if (isRecord(settings.charts) === false) {
    throw new Error(`${scope} charts: expected an object`);
  }

  const unknownFields = Object.keys(settings.charts).filter((field) => field !== "fontFamily");
  if (unknownFields.length > 0) {
    throw new Error(`${scope} charts.${unknownFields[0]}: unknown field`);
  }

  const fontFamily = settings.charts.fontFamily;
  if (fontFamily === undefined) return undefined;
  if (typeof fontFamily !== "string") {
    throw new Error(`${scope} charts.fontFamily: expected a string`);
  }

  const normalized = fontFamily.trim();
  if (normalized.length === 0 || normalized.length > MAX_FONT_FAMILY_LENGTH) {
    throw new Error(
      `${scope} charts.fontFamily: expected a non-empty string of at most ${MAX_FONT_FAMILY_LENGTH} characters`,
    );
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function ansiColor(ansi: string, fallback: string): string {
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

export function getChartColors(theme: ChartTheme): string[] {
  const colors = new Set<string>();
  for (const token of CHART_COLOR_TOKENS) {
    colors.add(ansiColor(theme.getFgAnsi(token), "currentColor"));
  }
  return [...colors];
}

export function escapeXml(value: string): string {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[character] ??
      character,
  );
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

export function validCellDimensions(dimensions: CellDimensions): CellDimensions {
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

export function renderChartSvg<TDetails extends ChartDetails, TLayout extends ChartLayout>(
  renderer: ChartRenderer<TDetails, TLayout>,
  details: TDetails,
  theme: ChartTheme,
): string {
  const layout = renderer.getLayout(details, undefined, details.imageWidthCells);
  return renderer.renderSvg(details, theme, layout);
}

/** Renders only from the stored data so resizing never mutates the tool result. */
export class ChartComponent<TDetails extends ChartDetails, TLayout extends ChartLayout>
  implements Component
{
  private readonly cache = new Map<string, string>();
  private readonly errors = new Set<string>();
  private pending: { key: string; controller: AbortController; generation: number } | undefined;
  private generation = 0;
  private theme: Theme;

  constructor(
    private readonly details: TDetails,
    theme: Theme,
    private readonly requestRender: () => void,
    private readonly renderer: ChartRenderer<TDetails, TLayout>,
    private readonly rasterize: Rasterize = rasterizeSvg,
  ) {
    this.theme = theme;
  }

  update(theme: Theme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.resetRasters();
  }

  invalidate(): void {
    // Pi also invalidates the whole tool row to request async redraws. Keep the
    // completed raster; update() resets it when the renderer's theme changes.
  }

  matches(renderer: object): boolean {
    return this.renderer === renderer;
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
      const layout = this.renderer.getLayout(this.details, dimensions, widthCells);
      return new Image(
        png,
        "image/png",
        { fallbackColor: (text) => this.theme.fg("toolOutput", text) },
        {
          maxWidthCells: widthCells,
          maxHeightCells: layout.heightCells,
        },
      ).render(width);
    }
    if (this.errors.has(cacheKey)) {
      return [truncateToWidth(this.theme.fg("error", this.renderer.unavailableText), width)];
    }

    this.startRaster(cacheKey, key);
    return [truncateToWidth(this.theme.fg("muted", this.renderer.renderingText), width)];
  }

  private resetRasters(): void {
    this.cache.clear();
    this.errors.clear();
    this.pending?.controller.abort();
    this.pending = undefined;
    this.generation++;
  }

  private startRaster(cacheKey: string, key: RasterKey): void {
    if (this.pending?.key === cacheKey) return;
    this.pending?.controller.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.pending = { key: cacheKey, controller, generation };
    const layout = this.renderer.getLayout(
      this.details,
      { widthPx: key.cellWidthPx, heightPx: key.cellHeightPx },
      key.widthCells,
    );
    const svg = this.renderer.renderSvg(this.details, this.theme, layout);

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
      .catch((_error: unknown) => {
        if (controller.signal.aborted || this.pending?.generation !== generation) return;
        this.errors.add(cacheKey);
        this.pending = undefined;
        this.requestRender();
      });
  }
}
