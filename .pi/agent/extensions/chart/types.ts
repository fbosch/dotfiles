import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { getAgentDir, SettingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import {
  type CellDimensions,
  type Component,
  getCellDimensions,
  Image,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { ResvgRenderOptions } from "@resvg/resvg-js";
import type { Static, TSchema } from "typebox";
import { CHART_COMPONENT_MARKER } from "./component-marker";

export const DEFAULT_IMAGE_WIDTH_CELLS = 60;
export const FALLBACK_CELL_DIMENSIONS = { widthPx: 9, heightPx: 18 };
export const MAX_CHART_HEIGHT_CELLS = 18;
export const RASTER_DENSITY = 1;
export const DEFAULT_FONT_FAMILY = "sans-serif";
export const MIN_FONT_SIZE_PX = 8;
export const MAX_FONT_SIZE_PX = 32;

const MAX_FONT_FAMILY_LENGTH = 200;
const MAX_SVG_BYTES = 64 * 1024;
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const RASTERIZE_TIMEOUT_MS = 10_000;

const execFileAsync = promisify(execFile);
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
  /** Optional only for chart results saved before font-size configuration existed. */
  fontSize?: number;
};

export type ChartSettings = {
  imageWidthCells: number;
  fontFamily: string;
  fontSize?: number;
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

export type RasterizeOptions = {
  /** The configured family is forwarded explicitly; SVG is never parsed for renderer settings. */
  fontFamily?: string;
  /** Test and integration override; production callers use the bounded default. */
  timeoutMs?: number;
  /** Internal component identity used to coalesce obsolete resize work. */
  coalesceKey?: object;
};

export type Rasterize = (
  svg: string,
  signal?: AbortSignal,
  options?: RasterizeOptions,
) => Promise<string>;

type MatchedFont = {
  family: string;
  file: string;
};

type ResvgFontOptions = NonNullable<ResvgRenderOptions["font"]>;

const fontOptionsCache = new Map<string, Promise<ResvgFontOptions>>();

type NativeJob = {
  svg: string;
  font: ResvgFontOptions;
  isObsolete: () => boolean;
  coalesceKey?: object;
  cancelled: Int32Array;
  resolve: (png: string | undefined) => void;
  reject: (error: unknown) => void;
};

let nativeRenderActive = false;
const queuedNativeRenders: NativeJob[] = [];

let rasterWorker: Worker | undefined;
let activeJob: NativeJob | undefined;
let rasterGeneration = 0;

function finishNativeRender(error?: unknown, base64?: string): void {
  const job = activeJob;
  activeJob = undefined;
  nativeRenderActive = false;
  if (error !== undefined) job?.reject(error);
  else job?.resolve(base64);
  const next = queuedNativeRenders.shift();
  if (next !== undefined) runNativeRender(next);
}

export function shutdownRasterizer(): void {
  rasterGeneration++;
  for (const job of queuedNativeRenders.splice(0)) job.reject(abortError());
  const worker = rasterWorker;
  rasterWorker = undefined;
  if (activeJob !== undefined) Atomics.store(activeJob.cancelled, 0, 1);
  finishNativeRender(abortError());
  // Native work may finish before termination; never block Pi shutdown waiting for it.
  if (worker !== undefined) void worker.terminate().catch(() => {});
}

function getRasterWorker(): Worker {
  if (rasterWorker !== undefined) return rasterWorker;
  const worker = new Worker(new URL("./raster-worker.cjs", import.meta.url));
  rasterWorker = worker;
  worker.on("message", (message: { base64?: string; error?: string }) => {
    if (rasterWorker !== worker) return;
    finishNativeRender(
      message.error === undefined ? undefined : new Error(message.error),
      message.base64,
    );
  });
  const failed = (error: unknown) => {
    if (rasterWorker !== worker) return;
    rasterWorker = undefined;
    finishNativeRender(error);
  };
  worker.on("error", failed);
  worker.on("exit", (code) => failed(new Error(`chart raster worker exited (${code})`)));
  // Raster callers own bounded timers; an idle or logically cancelled worker must not keep Pi alive.
  worker.unref();
  return worker;
}

function runNativeRender(job: NativeJob): void {
  nativeRenderActive = true;
  activeJob = job;
  if (job.isObsolete()) {
    finishNativeRender();
    return;
  }
  try {
    getRasterWorker().postMessage({
      svg: job.svg,
      font: job.font,
      cancelled: job.cancelled,
      maxPngBytes: MAX_PNG_BYTES,
    });
  } catch (error) {
    finishNativeRender(error);
  }
}

/** Keeps one native renderer active and coalesces obsolete resize work into the latest request. */
function enqueueNativeRender(
  svg: string,
  font: ResvgFontOptions,
  isObsolete: () => boolean,
  coalesceKey: object | undefined,
  cancelled: Int32Array,
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const job = {
      svg,
      font,
      isObsolete,
      cancelled,
      ...(coalesceKey === undefined ? {} : { coalesceKey }),
      resolve,
      reject,
    };
    if (nativeRenderActive) {
      if (coalesceKey !== undefined) {
        const index = queuedNativeRenders.findIndex((queued) => queued.coalesceKey === coalesceKey);
        if (index !== -1) queuedNativeRenders.splice(index, 1)[0]?.resolve(undefined);
      }
      queuedNativeRenders.push(job);
      return;
    }
    runNativeRender(job);
  });
}

type RasterKey = {
  widthCells: number;
  cellWidthPx: number;
  cellHeightPx: number;
};

export function resolveChartSettings(
  globalSettings: unknown,
  projectSettings: unknown,
): Pick<ChartSettings, "fontFamily" | "fontSize"> {
  const global = configuredChartSettings(globalSettings, "global");
  const project = configuredChartSettings(projectSettings, "project");
  return {
    fontFamily: project.fontFamily ?? global.fontFamily ?? DEFAULT_FONT_FAMILY,
    ...(project.fontSize === undefined && global.fontSize === undefined
      ? {}
      : { fontSize: project.fontSize ?? global.fontSize }),
  };
}

/** @deprecated Use resolveChartSettings to resolve all chart configuration together. */
export function resolveChartFontFamily(globalSettings: unknown, projectSettings: unknown): string {
  return resolveChartSettings(globalSettings, projectSettings).fontFamily;
}

function configuredChartSettings(
  settings: unknown,
  scope: "global" | "project",
): Partial<Pick<ChartSettings, "fontFamily" | "fontSize">> {
  if (isRecord(settings) === false || settings.charts === undefined) return {};
  if (isRecord(settings.charts) === false) throw new Error(`${scope} charts: expected an object`);

  const unknownFields = Object.keys(settings.charts).filter(
    (field) => field !== "fontFamily" && field !== "fontSize",
  );
  if (unknownFields.length > 0)
    throw new Error(`${scope} charts.${unknownFields[0]}: unknown field`);

  const result: Partial<Pick<ChartSettings, "fontFamily" | "fontSize">> = {};
  const fontFamily = settings.charts.fontFamily;
  if (fontFamily !== undefined) {
    if (typeof fontFamily !== "string")
      throw new Error(`${scope} charts.fontFamily: expected a string`);
    const normalized = fontFamily.trim();
    if (normalized.length === 0 || normalized.length > MAX_FONT_FAMILY_LENGTH) {
      throw new Error(
        `${scope} charts.fontFamily: expected a non-empty string of at most ${MAX_FONT_FAMILY_LENGTH} characters`,
      );
    }
    result.fontFamily = normalized;
  }
  const fontSize = settings.charts.fontSize;
  if (fontSize !== undefined) {
    if (typeof fontSize !== "number" || Number.isFinite(fontSize) === false) {
      throw new Error(`${scope} charts.fontSize: expected a finite number of logical pixels`);
    }
    if (fontSize < MIN_FONT_SIZE_PX || fontSize > MAX_FONT_SIZE_PX) {
      throw new Error(
        `${scope} charts.fontSize: expected a number between ${MIN_FONT_SIZE_PX} and ${MAX_FONT_SIZE_PX} logical pixels`,
      );
    }
    result.fontSize = fontSize;
  }
  return result;
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

async function findFont(pattern: string): Promise<MatchedFont | undefined> {
  try {
    const { stdout } = await execFileAsync("fc-match", ["-f", "%{family}\t%{file}\n", pattern], {
      encoding: "utf8",
      windowsHide: true,
    });
    const [family, file] = stdout.trim().split("\t", 2);
    if (family === undefined || file === undefined || family.length === 0 || file.length === 0)
      return undefined;
    await access(file);
    return { family: family.split(",")[0] ?? family, file };
  } catch {
    return undefined;
  }
}

async function resolveFontOptions(fontFamily: string): Promise<ResvgFontOptions> {
  const selected = await findFont(fontFamily);
  const sans = await findFont("sans-serif");
  const monospace = await findFont("monospace");
  const matches = [selected, sans, monospace].filter(
    (match): match is MatchedFont => match !== undefined,
  );

  if (matches.length === 0) {
    // Fontconfig is unavailable on some hosts; let resvg use its platform registry rather than fail charts.
    return {
      loadSystemFonts: true,
      defaultFontFamily: fontFamily,
      sansSerifFamily: "sans-serif",
      monospaceFamily: "monospace",
    };
  }

  return {
    loadSystemFonts: false,
    fontFiles: [...new Set(matches.map((match) => match.file))],
    defaultFontFamily: selected?.family ?? fontFamily,
    sansSerifFamily: sans?.family ?? selected?.family ?? fontFamily,
    monospaceFamily: monospace?.family ?? selected?.family ?? fontFamily,
  };
}

function getFontOptions(fontFamily: string): Promise<ResvgFontOptions> {
  const cached = fontOptionsCache.get(fontFamily);
  if (cached !== undefined) return cached;
  const options = resolveFontOptions(fontFamily);
  fontOptionsCache.set(fontFamily, options);
  return options;
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Rasterization, PNG encoding and base64 conversion stay in one lazy worker.
 * Cancellation rejects promptly; shared flags skip remaining stages and late output is discarded.
 */
export async function rasterizeSvg(
  svg: string,
  signal?: AbortSignal,
  options: RasterizeOptions = {},
): Promise<string> {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) {
    throw new Error("chart SVG exceeded the resource limit");
  }
  signal?.throwIfAborted();

  const timeoutMs = options.timeoutMs ?? RASTERIZE_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RASTERIZE_TIMEOUT_MS) {
    throw new Error(`chart rasterization timeout must be between 1 and ${RASTERIZE_TIMEOUT_MS}ms`);
  }

  const generation = rasterGeneration;
  const cancelled = new Int32Array(new SharedArrayBuffer(4));
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: ((reason: Error) => void) | undefined;
  const pending = new Promise<never>((_resolve, reject) => {
    rejectPending = reject;
  });
  const abort = () => {
    if (settled) return;
    settled = true;
    Atomics.store(cancelled, 0, 1);
    rejectPending?.(abortError());
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    Atomics.store(cancelled, 0, 1);
    rejectPending?.(new Error(`chart rasterization timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const font = await Promise.race([
      getFontOptions(options.fontFamily ?? DEFAULT_FONT_FAMILY),
      pending,
    ]);
    if (settled || generation !== rasterGeneration) throw abortError();
    signal?.throwIfAborted();

    const nativeRender = enqueueNativeRender(
      svg,
      font,
      () => settled || signal?.aborted === true,
      options.coalesceKey,
      cancelled,
    );
    const png = await Promise.race([nativeRender, pending]);
    if (png === undefined || settled || signal?.aborted) throw abortError();
    settled = true;
    return png;
  } finally {
    settled = true;
    Atomics.store(cancelled, 0, 1);
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
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

/** Convert the logical chart font setting to pixels for the current terminal cell density. */
export function scaleChartFontSize(fontSize: number, cellDimensions: CellDimensions): number {
  const dimensions = validCellDimensions(cellDimensions);
  return Math.max(
    1,
    Math.round((fontSize * dimensions.heightPx) / FALLBACK_CELL_DIMENSIONS.heightPx),
  );
}

function rasterKeyString(key: RasterKey): string {
  return `${key.widthCells}:${key.cellWidthPx}:${key.cellHeightPx}`;
}

export function createChartSettings(cwd: string, trusted: boolean): ChartSettings {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: trusted });
  return {
    imageWidthCells: settings.getImageWidthCells(),
    ...resolveChartSettings(settings.getGlobalSettings(), settings.getProjectSettings()),
  };
}

export function renderChartSvg<TDetails extends ChartDetails, TLayout extends ChartLayout>(
  renderer: ChartRenderer<TDetails, TLayout>,
  details: TDetails,
  theme: ChartTheme,
): string {
  const layout = renderer.getLayout(details, undefined, details.imageWidthCells);
  return renderer.renderSvg(details, theme, layout);
}
function padSvgToCellGrid(svg: string, targetHeightPx: number): string {
  const openingTagEnd = svg.indexOf(">");
  if (openingTagEnd === -1) return svg;
  const openingTag = svg.slice(0, openingTagEnd + 1);
  const heightMatch = openingTag.match(/\sheight="(\d+(?:\.\d+)?)"/);
  if (heightMatch === null) return svg;
  const currentHeightPx = Number(heightMatch[1]);
  if (!Number.isFinite(currentHeightPx) || targetHeightPx <= currentHeightPx) return svg;

  const paddedTag = openingTag
    .replace(/\sheight="[^"]*"/, ` height="${targetHeightPx}"`)
    .replace(/\spreserveAspectRatio="[^"]*"/, "")
    .replace(/>$/, ' preserveAspectRatio="xMidYMin meet">');
  return `${paddedTag}${svg.slice(openingTagEnd + 1)}`;
}

/** Renders only from the stored data so resizing never mutates the tool result. */
export class ChartComponent<TDetails extends ChartDetails, TLayout extends ChartLayout>
  implements Component
{
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "object" && value !== null && CHART_COMPONENT_MARKER in value;
  }

  // Stable Image identity lets Pi reuse Kitty uploads across unrelated input redraws.
  private readonly cache = new Map<string, Image>();
  private readonly errors = new Set<string>();
  private readonly rasterQueueKey = {};
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
    Object.defineProperty(this, CHART_COMPONENT_MARKER, { value: true });
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
    const image = this.cache.get(cacheKey);
    if (image) return image.render(width);
    if (this.errors.has(cacheKey)) {
      return [truncateToWidth(this.theme.fg("error", this.renderer.unavailableText), width)];
    }

    this.startRaster(cacheKey, key);
    return [];
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
    const svg = padSvgToCellGrid(
      this.renderer.renderSvg(this.details, this.theme, layout),
      layout.heightCells * key.cellHeightPx,
    );

    void this.rasterize(svg, controller.signal, {
      coalesceKey: this.rasterQueueKey,
      ...(this.details.fontFamily === undefined ? {} : { fontFamily: this.details.fontFamily }),
    })
      .then((png) => {
        if (controller.signal.aborted || this.pending?.generation !== generation) return;
        this.cache.set(
          cacheKey,
          new Image(
            png,
            "image/png",
            { fallbackColor: (text) => this.theme.fg("toolOutput", text) },
            { maxWidthCells: key.widthCells, maxHeightCells: layout.heightCells },
          ),
        );
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
