import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
  ToolRenderContext,
} from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  getPngDimensions,
  Image,
  setCapabilities,
  setCellDimensions,
} from "@earendil-works/pi-tui";
import chartExtension, {
  getPieChartLayout,
  PieChartComponent,
  rasterizeSvg,
  renderPieChartSvg,
  validatePieChartInput,
} from "../index";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (color: string) => {
    const colors: Record<string, string> = {
      accent: "\u001b[38;2;102;165;173m",
      success: "\u001b[38;2;129;155;105m",
      warning: "\u001b[38;2;183;126;100m",
      error: "\u001b[38;2;222;110;124m",
      thinkingLow: "\u001b[38;2;96;153;192m",
      thinkingMedium: "\u001b[38;2;102;165;173m",
      thinkingHigh: "\u001b[38;2;178;121;167m",
      thinkingXhigh: "\u001b[38;2;183;126;100m",
      thinkingMax: "\u001b[38;2;222;110;124m",
      bashMode: "\u001b[38;2;129;155;105m",
      text: "\u001b[38;2;187;187;187m",
    };
    return colors[color] ?? "\u001b[38;2;167;139;250m";
  },
  getBgAnsi: () => "\u001b[48;2;25;28;38m",
} as unknown as Theme;

const imageTheme = { fallbackColor: (text: string) => text };
const pngHeader = Buffer.concat([
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  Buffer.from([0, 0, 2, 28, 0, 0, 1, 104]),
]).toString("base64");

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: unknown;
};
type PieChartExecute = (
  toolCallId: string,
  params: { labels: string[]; values: number[] },
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<ToolResult>;

function registerTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  chartExtension({
    registerTool: (definition: ToolDefinition) => {
      tool = definition;
    },
  } as unknown as ExtensionAPI);
  if (tool === undefined) throw new Error("pie_chart was not registered");
  return tool;
}

function topLeftPngAlpha(png: Buffer): number {
  let offset = 8;
  const idat: Buffer[] = [];
  let bitDepth = 0;
  let colorType = 0;

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === "IHDR") {
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  expect(bitDepth).toBe(8);
  expect(colorType).toBe(6);
  const pixels = inflateSync(Buffer.concat(idat));
  return pixels[4] ?? -1;
}

function fills(svg: string, element: "path" | "rect"): string[] {
  return [...svg.matchAll(new RegExp(`<${element}[^>]* fill="([^"]+)"`, "g"))].map(
    (match) => match[1] ?? "",
  );
}

function nativeImageCellSize(width: number): { columns: number; rows: number } {
  const image = new Image(pngHeader, "image/png", imageTheme, { maxWidthCells: 60 });
  const line = image.render(width)[0] ?? "";
  const columns = /(?:^|,)c=(\d+)/.exec(line)?.[1];
  const rows = /(?:^|,)r=(\d+)/.exec(line)?.[1];
  if (columns === undefined || rows === undefined)
    throw new Error("Pi did not render a Kitty image");
  return { columns: Number(columns), rows: Number(rows) };
}

const printContext = {
  mode: "print",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;
const tuiContext = {
  mode: "tui",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;

const rows = validatePieChartInput({ labels: ["Open", "Closed"], values: [3, 1] });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("pie chart", () => {
  test("validates bounded nonnegative values, a finite total, and unique labels", () => {
    expect(validatePieChartInput({ labels: [" Open ", "Closed"], values: [3, 1] })).toEqual([
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ]);
    expect(() => validatePieChartInput({ labels: ["Open"], values: [1] })).toThrow("between 2");
    expect(() => validatePieChartInput({ labels: ["Open", "Closed"], values: [1, -1] })).toThrow(
      "finite nonnegative",
    );
    expect(() => validatePieChartInput({ labels: ["Open", "Closed"], values: [0, 0] })).toThrow(
      "finite positive total",
    );
    expect(() => validatePieChartInput({ labels: ["Open", " Open "], values: [1, 2] })).toThrow(
      "duplicates",
    );
  });

  test("uses Pi's configured size and bounded non-TUI cell fallback", () => {
    expect(getPieChartLayout()).toEqual({
      widthPx: 540,
      heightPx: 360,
      chartWidthPx: 335,
      legendX: 355,
    });
    expect(getPieChartLayout({ widthPx: 7, heightPx: 14 })).toEqual({
      widthPx: 420,
      heightPx: 280,
      chartWidthPx: 260,
      legendX: 280,
    });
    expect(getPieChartLayout({ widthPx: 0, heightPx: Number.NaN })).toEqual(getPieChartLayout());

    const configuredSettings = SettingsManager.inMemory({ terminal: { imageWidthCells: 72 } });
    expect(getPieChartLayout(undefined, configuredSettings.getImageWidthCells()).widthPx).toBe(648);
  });

  test("matches Pi's native Image two-column padding and cell height", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });

    expect(nativeImageCellSize(64)).toEqual({ columns: 60, rows: 20 });
    expect(nativeImageCellSize(30)).toEqual({ columns: 28, rows: 10 });
  });

  test("renders a transparent themed SVG with matching slice and legend colors", () => {
    const svg = renderPieChartSvg(rows, theme);
    expect(svg).toContain('width="540"');
    expect(svg).toContain('viewBox="0 0 540 360"');
    expect(svg).toContain("rgb(102, 165, 173)");
    expect(svg).toContain("rgb(129, 155, 105)");
    expect(svg).not.toMatch(/<rect\b[^>]*width="100%"[^>]*height="100%"/);
    expect(svg).toContain('aria-label="Pie chart"');
    expect(fills(svg, "path")).toEqual(fills(svg, "rect"));
  });

  test("keeps the SVG and rasterized PNG background transparent", async () => {
    const svg = renderPieChartSvg(rows, theme);
    const png = Buffer.from(await rasterizeSvg(svg), "base64");

    expect(svg).not.toMatch(/<rect\b[^>]*width="100%"[^>]*height="100%"/);
    expect(topLeftPngAlpha(png)).toBe(0);
  });

  test("returns TUI chart data without a native image and retains an image outside TUI", async () => {
    const tool = registerTool();
    const execute = tool.execute as PieChartExecute;
    const params = { labels: ["Open", "Closed"], values: [3, 1] };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart", params, undefined, undefined, tuiContext),
      execute("chart", params, undefined, undefined, printContext),
    ]);

    expect(tuiResult.content).toEqual([
      { type: "text", text: "Pie chart: Open 3 (75.0%); Closed 1 (25.0%)" },
    ]);
    expect(tuiResult.details).toEqual({ rows, imageWidthCells: 60 });
    const image = printResult.content.find((content) => content.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(getPngDimensions(image?.data ?? "")).toEqual({ widthPx: 540, heightPx: 360 });
  });

  test("rasterizes at the final wide and narrow Image widths without resampling", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const requestedSvg: string[] = [];
    const component = new PieChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      async (svg) => {
        requestedSvg.push(svg);
        return pngHeader;
      },
    );

    expect(component.render(64)).toEqual(["Rendering pie chart…"]);
    await Promise.resolve();
    const wide = component.render(64)[0] ?? "";
    expect(requestedSvg[0]).toContain('width="540"');
    expect(/(?:^|,)c=60(?:,|;)/.test(wide)).toBe(true);
    expect(/(?:^|,)r=20(?:,|;)/.test(wide)).toBe(true);

    expect(component.render(30)).toEqual(["Rendering pie chart…"]);
    await Promise.resolve();
    const narrow = component.render(30)[0] ?? "";
    expect(requestedSvg[1]).toContain('width="252"');
    expect(/(?:^|,)c=28(?:,|;)/.test(narrow)).toBe(true);
    expect(/(?:^|,)r=20(?:,|;)/.test(narrow)).toBe(true);
  });

  test("cancels stale resize jobs and only invalidates for the current raster", async () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    let invalidations = 0;
    const component = new PieChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => {
        invalidations++;
      },
      (_svg, signal) => {
        if (signal === undefined) throw new Error("expected cancellation signal");
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      },
    );

    component.render(64);
    component.render(30);
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    first.resolve(pngHeader);
    await Promise.resolve();
    expect(invalidations).toBe(0);

    second.resolve(pngHeader);
    await Promise.resolve();
    expect(invalidations).toBe(1);
  });

  test("honors an already-aborted non-TUI tool call", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = registerTool().execute as PieChartExecute;

    await expect(
      execute(
        "chart",
        { labels: ["Open", "Closed"], values: [3, 1] },
        controller.signal,
        undefined,
        printContext,
      ),
    ).rejects.toThrow("aborted");
  });
});
