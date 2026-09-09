import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  getPngDimensions,
  Image,
  setCapabilities,
  setCellDimensions,
} from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { ToolExecutionComponent } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import chartExtension, {
  getPieChartLayout,
  PieChartComponent,
  pieChartVariant,
  rasterizeSvg,
  renderPieChartSvg,
  validatePieChartInput,
} from "../index";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
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
function pngHeader(widthPx = 540, heightPx = 360): string {
  const header = Buffer.concat([
    Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
    Buffer.alloc(8),
  ]);
  header.writeUInt32BE(widthPx, 16);
  header.writeUInt32BE(heightPx, 20);
  return header.toString("base64");
}

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: unknown;
};
type PieChartExecute = (
  toolCallId: string,
  params: { type: "pie"; data: Array<{ label: string; value: number }>; title?: string },
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
  if (tool === undefined) throw new Error("chart was not registered");
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

function nativeImageCellSize(
  width: number,
  widthPx = 540,
  heightPx = 360,
  maxWidthCells = 60,
  maxHeightCells?: number,
): { columns: number; rows: number } {
  const image = new Image(pngHeader(widthPx, heightPx), "image/png", imageTheme, {
    maxWidthCells,
    ...(maxHeightCells === undefined ? {} : { maxHeightCells }),
  });
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

const rows = validatePieChartInput({
  type: "pie",
  data: [
    { label: "Open", value: 3 },
    { label: "Closed", value: 1 },
  ],
});

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("pie chart", () => {
  test("validates bounded nonnegative values, a finite total, and unique labels", () => {
    expect(
      validatePieChartInput({
        type: "pie",
        data: [
          { label: " Open ", value: 3 },
          { label: "Closed", value: 1 },
        ],
      }),
    ).toEqual([
      { label: "Open", value: 3 },
      { label: "Closed", value: 1 },
    ]);
    expect(() =>
      validatePieChartInput({ type: "pie", data: [{ label: "Open", value: 1 }] }),
    ).toThrow("between 2");
    expect(() =>
      validatePieChartInput({
        type: "pie",
        data: [
          { label: "Open", value: 1 },
          { label: "Closed", value: -1 },
        ],
      }),
    ).toThrow("finite nonnegative");
    expect(() =>
      validatePieChartInput({
        type: "pie",
        data: [
          { label: "Open", value: 0 },
          { label: "Closed", value: 0 },
        ],
      }),
    ).toThrow("finite positive total");
    expect(() =>
      validatePieChartInput({
        type: "pie",
        data: [
          { label: "Open", value: 1 },
          { label: " Open ", value: 2 },
        ],
      }),
    ).toThrow("duplicates");
  });

  test("registers chart with the pie variant schema", () => {
    const tool = registerTool();

    expect(tool.name).toBe("chart");
    expect(tool.parameters).toBe(pieChartVariant);
    expect(Value.Check(pieChartVariant, { type: "pie", data: rows, title: "Status" })).toBe(true);
    expect(Value.Check(pieChartVariant, { type: "bar", data: rows })).toBe(false);
    expect(
      Value.Check(pieChartVariant, {
        type: "pie",
        data: rows,
        labels: ["Open", "Closed"],
        values: [3, 1],
      }),
    ).toBe(false);
  });

  test("derives compact logical height from pie and legend layout", () => {
    const wide = getPieChartLayout();
    const narrow = getPieChartLayout({ widthPx: 9, heightPx: 18 }, 28, 2);
    const narrowTwelveSlices = getPieChartLayout({ widthPx: 9, heightPx: 18 }, 28, 12);

    expect(wide).toMatchObject({ widthPx: 540, heightPx: 220, heightCells: 13, stacked: false });
    expect(narrow).toMatchObject({ widthPx: 252, heightPx: 251, heightCells: 14, stacked: true });
    expect(narrow.heightCells).toBeLessThanOrEqual(18);
    expect(narrow.legendY).toBeGreaterThan(narrow.pieY + narrow.pieDiameterPx);
    expect(narrowTwelveSlices).toMatchObject({ heightCells: 18, legendColumns: 2, stacked: true });
    expect(narrowTwelveSlices.legendRowHeightPx).toBeGreaterThan(
      narrowTwelveSlices.labelFontSizePx,
    );
    expect(getPieChartLayout({ widthPx: 0, heightPx: Number.NaN })).toEqual(wide);

    const configuredSettings = SettingsManager.inMemory({ terminal: { imageWidthCells: 72 } });
    expect(getPieChartLayout(undefined, configuredSettings.getImageWidthCells()).widthPx).toBe(648);
  });

  test("matches Pi Image intrinsic aspect ratio and explicit logical cell bounds", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });

    expect(nativeImageCellSize(64, 1080, 440, 60, 13)).toEqual({ columns: 60, rows: 13 });
    expect(nativeImageCellSize(30, 504, 502, 28, 14)).toEqual({ columns: 28, rows: 14 });
  });

  test("renders a transparent themed SVG with matching slice and legend colors", () => {
    const svg = renderPieChartSvg(rows, theme);
    expect(svg).toContain('width="1080" height="440"');
    expect(svg).toContain('viewBox="0 0 540 220"');
    expect(svg).toContain("rgb(102, 165, 173)");
    expect(svg).toContain("rgb(129, 155, 105)");
    expect(svg).not.toMatch(/<rect\b[^>]*width="100%"[^>]*height="100%"/);
    expect(svg).toContain('aria-label="Pie chart"');
    expect(fills(svg, "path")).toEqual(fills(svg, "rect"));

    const titledSvg = renderPieChartSvg(rows, theme, undefined, "Status");
    expect(titledSvg).toContain('aria-label="Pie chart: Status"');
    expect(titledSvg).toContain("<title>Status</title>");
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
    const params = { type: "pie" as const, data: rows, title: "Status" };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart", params, undefined, undefined, tuiContext),
      execute("chart", params, undefined, undefined, printContext),
    ]);

    expect(tuiResult.content).toEqual([
      { type: "text", text: "Status pie chart: Open 3 (75.0%); Closed 1 (25.0%)" },
    ]);
    expect(tuiResult.details).toEqual({ rows, title: "Status", imageWidthCells: 60 });
    const image = printResult.content.find((content) => content.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(getPngDimensions(image?.data ?? "")).toEqual({ widthPx: 1080, heightPx: 440 });
  });

  test("rasterizes at 2x logical dimensions and displays compact wide and narrow cell heights", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const requestedSvg: string[] = [];
    const component = new PieChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      async (svg) => {
        requestedSvg.push(svg);
        const dimensions = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg);
        if (dimensions === null) throw new Error("expected SVG dimensions");
        return pngHeader(Number(dimensions[1]), Number(dimensions[2]));
      },
    );

    expect(component.render(64)).toEqual(["Rendering pie chart…"]);
    await Promise.resolve();
    const wide = component.render(64)[0] ?? "";
    expect(requestedSvg[0]).toContain('width="1080" height="440" viewBox="0 0 540 220"');
    expect(/(?:^|,)c=60(?:,|;)/.test(wide)).toBe(true);
    expect(/(?:^|,)r=13(?:,|;)/.test(wide)).toBe(true);

    expect(component.render(30)).toEqual(["Rendering pie chart…"]);
    await Promise.resolve();
    const narrow = component.render(30)[0] ?? "";
    expect(requestedSvg[1]).toContain('width="504" height="502" viewBox="0 0 252 251"');
    expect(/(?:^|,)c=28(?:,|;)/.test(narrow)).toBe(true);
    expect(/(?:^|,)r=14(?:,|;)/.test(narrow)).toBe(true);
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
    first.resolve(pngHeader());
    await Promise.resolve();
    expect(invalidations).toBe(0);

    second.resolve(pngHeader());
    await Promise.resolve();
    expect(invalidations).toBe(1);
  });

  test("shows a sticky error instead of retrying a failed raster until invalidated", async () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    let calls = 0;
    const component = new PieChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      async () => {
        calls++;
        throw new Error("rsvg-convert failed");
      },
    );

    expect(component.render(64)).toEqual(["Rendering pie chart…"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(calls).toBe(1);

    component.invalidate();
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(calls).toBe(1);
  });

  test("invalidates cached rasters when the theme identity changes", async () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const requestedSvg: string[] = [];
    const component = new PieChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      async (svg) => {
        requestedSvg.push(svg);
        return pngHeader();
      },
    );

    component.render(64);
    await Promise.resolve();
    component.render(64);
    component.update({
      ...theme,
      getFgAnsi: (color: ThemeColor) =>
        color === "accent" ? "\u001b[38;2;255;0;0m" : theme.getFgAnsi(color),
    } as unknown as Theme);

    expect(component.render(64)).toEqual(["Rendering pie chart…"]);
    expect(requestedSvg).toHaveLength(2);
    expect(requestedSvg[1]).toContain("rgb(255, 0, 0)");
  });

  test("keeps a completed raster across the real tool-row invalidation lifecycle", async () => {
    Reflect.set(globalThis, Symbol.for("@earendil-works/pi-coding-agent:theme"), theme);
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const raster = deferred<string>();
    let rasterCalls = 0;
    const renderers = {
      renderResult(
        result: { details?: unknown },
        _options: unknown,
        renderTheme: Theme,
        context: { lastComponent?: unknown; invalidate: () => void },
      ) {
        const previous = context.lastComponent;
        if (previous instanceof PieChartComponent) {
          previous.update(renderTheme);
          return previous;
        }
        return new PieChartComponent(
          result.details as { rows: typeof rows; imageWidthCells: number },
          renderTheme,
          context.invalidate,
          async () => {
            rasterCalls++;
            return raster.promise;
          },
        );
      },
    };
    const toolRow = new ToolExecutionComponent(
      "chart",
      "chart-1",
      {},
      { showImages: false },
      renderers,
      { requestRender: () => undefined } as never,
      process.cwd(),
    );
    toolRow.updateResult({
      content: [{ type: "text", text: "summary" }],
      details: { rows, imageWidthCells: 60 },
      isError: false,
    });

    expect(toolRow.render(66).join("\n")).toContain("Rendering pie chart…");
    expect(rasterCalls).toBe(1);
    raster.resolve(pngHeader());
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(toolRow.render(66).join("\n")).toContain("\u001b_G");
    expect(rasterCalls).toBe(1);
  });

  test("honors an already-aborted non-TUI tool call", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = registerTool().execute as PieChartExecute;

    await expect(
      execute("chart", { type: "pie", data: rows }, controller.signal, undefined, printContext),
    ).rejects.toThrow("aborted");
  });
});
