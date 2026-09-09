import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type CellDimensions,
  type Component,
  getCellDimensions,
  Image,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { type ResvgRenderOptions, renderAsync } from "@resvg/resvg-js";
import type { Static, TSchema } from "typebox";

export const DEFAULT_IMAGE_WIDTH_CELLS = 60;
export const FALLBACK_CELL_DIMENSIONS = { widthPx: 9, heightPx: 18 };
export const MAX_CHART_HEIGHT_CELLS = 18;
export const RASTER_DENSITY = 1;
export const DEFAULT_FONT_FAMILY = "sans-serif";

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
  resolve: (png: Buffer | undefined) => void;
  reject: (error: unknown) => void;
};

let nativeRenderActive = false;
const queuedNativeRenders: NativeJob[] = [];

function runNativeRender(job: NativeJob): void {
  nativeRenderActive = true;
  void renderAsync(job.svg, { font: job.font })
    .then(
      (image) => (job.isObsolete() ? undefined : image.asPng()),
      (error: unknown) => {
        throw error;
      },
    )
    .then(job.resolve, job.reject)
    .finally(() => {
      nativeRenderActive = false;
      const next = queuedNativeRenders.shift();
      if (next !== undefined) runNativeRender(next);
    });
}

/** Keeps one native renderer active and coalesces obsolete resize work into the latest request. */
function enqueueNativeRender(
  svg: string,
  font: ResvgFontOptions,
  isObsolete: () => boolean,
  coalesceKey: object | undefined,
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const job = {
      svg,
      font,
      isObsolete,
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
 * Renders on resvg's native async worker. Abort and timeout reject the caller promptly,
 * but resvg 2.6.2 does not reliably stop in-flight native work, so late output is discarded.
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

  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectPending: ((reason: Error) => void) | undefined;
  const pending = new Promise<never>((_resolve, reject) => {
    rejectPending = reject;
  });
  const abort = () => {
    if (settled) return;
    settled = true;
    rejectPending?.(abortError());
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectPending?.(new Error(`chart rasterization timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  try {
    const font = await Promise.race([
      getFontOptions(options.fontFamily ?? DEFAULT_FONT_FAMILY),
      pending,
    ]);
    if (settled) throw abortError();
    signal?.throwIfAborted();

    // Do not call asPng after logical cancellation: encoding is synchronous on the JS thread.
    const nativeRender = enqueueNativeRender(
      svg,
      font,
      () => settled || signal?.aborted === true,
      options.coalesceKey,
    );
    const png = await Promise.race([nativeRender, pending]);
    if (png === undefined || settled || signal?.aborted) throw abortError();
    if (png.byteLength > MAX_PNG_BYTES) throw new Error("chart PNG exceeded the resource limit");
    settled = true;
    return png.toString("base64");
  } finally {
    settled = true;
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

    void this.rasterize(svg, controller.signal, {
      coalesceKey: this.rasterQueueKey,
      ...(this.details.fontFamily === undefined ? {} : { fontFamily: this.details.fontFamily }),
    })
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
