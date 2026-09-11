import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
  getPngDimensions,
  Image,
  setCapabilities,
  setCellDimensions,
  Text,
} from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { ToolExecutionComponent } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import chartExtension, {
  chartBarParameters,
  chartBezierParameters,
  chartDonutParameters,
  chartGanttParameters,
  chartLineParameters,
  chartNetworkParameters,
  chartPieParameters,
  chartScatterParameters,
  chartTreeParameters,
} from "../index";
import {
  ChartComponent,
  rasterizeSvg,
  resolveChartFontFamily,
  resolveChartSettings,
} from "../types";
import {
  getPieChartLayout,
  pieChartRenderer,
  renderPieChartSvg,
  validatePieChartInput,
} from "../types/pie";
import { scatterChartRenderer } from "../types/scatter";

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

type SettingsStorage = Parameters<typeof SettingsManager.fromStorage>[0];

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: unknown;
};
type PieChartParameters = Omit<
  { type: "pie"; data: Array<{ label: string; value: number }>; title?: string },
  "type"
>;
type PieChartExecute = (
  toolCallId: string,
  params: PieChartParameters,
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<ToolResult>;

function registerTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  chartExtension({
    on: () => {},
    registerTool: (definition: ToolDefinition) => tools.push(definition),
  } as unknown as ExtensionAPI);
  return tools;
}

function registerTool(name = "chart_pie"): ToolDefinition {
  const tool = registerTools().find((definition) => definition.name === name);
  if (tool === undefined) throw new Error("chart tool was not registered");
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
const scatterRows = [
  { x: 1, y: 2 },
  { x: 2, y: 1 },
];

function currentChartFontFamily(): string {
  const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
  return resolveChartSettings(settings.getGlobalSettings(), settings.getProjectSettings())
    .fontFamily;
}

function settingsManager(
  globalSettings: unknown,
  projectSettings: unknown,
  projectTrusted: boolean,
): SettingsManager {
  const values: Record<"global" | "project", string> = {
    global: JSON.stringify(globalSettings),
    project: JSON.stringify(projectSettings),
  };
  const storage: SettingsStorage = {
    withLock(scope, update) {
      const next = update(values[scope]);
      if (next !== undefined) values[scope] = next;
    },
  };
  return SettingsManager.fromStorage(storage, { projectTrusted });
}

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
  test("keeps crowded two-column legend entries within their columns", () => {
    const crowdedRows = validatePieChartInput({
      type: "pie",
      data: [
        { label: "TypeScript (.ts)", value: 1 },
        { label: "Markdown (.md)", value: 1 },
        { label: "Lua (.lua)", value: 1 },
        { label: "JSON (.json)", value: 1 },
        { label: "Shell (.sh)", value: 1 },
        { label: "TSX (.tsx)", value: 1 },
        { label: "No extension", value: 1 },
        { label: "Fish (.fish)", value: 1 },
        { label: "YAML (.yml)", value: 1 },
        { label: "YAML (.yaml)", value: 1 },
        { label: "PNG (.png)", value: 1 },
        { label: "Other types", value: 1 },
      ],
    });
    const layout = getPieChartLayout(undefined, 60, crowdedRows.length);
    const svg = renderPieChartSvg(crowdedRows, theme, layout);

    expect(svg).toContain(">TypeScript… 8.3%<");
    expect(svg).toContain(">Markdown (.… 8.3%<");
    expect(svg).not.toContain(">TypeScript (.ts) 8.3%<");
    expect(svg).not.toContain(">Markdown (.md) 8.3%<");
    expect(layout.legendX - (layout.pieX + layout.pieDiameterPx)).toBe(11);
    expect(layout.legendColumnWidthPx).toBeGreaterThan(140);
  });
  test("registers focused chart tools with public schemas that omit type", () => {
    const pie = registerTool();
    const donut = registerTool("chart_donut");
    const bar = registerTool("chart_bar");
    const scatter = registerTool("chart_scatter");
    const line = registerTool("chart_line");
    const histogram = registerTool("chart_histogram");
    const bezier = registerTool("chart_bezier");
    const heatmap = registerTool("chart_heatmap");
    const boxplot = registerTool("chart_boxplot");
    const waterfall = registerTool("chart_waterfall");
    const dumbbell = registerTool("chart_dumbbell");
    const stackedBar = registerTool("chart_stacked_bar");
    const gantt = registerTool("chart_gantt");
    const network = registerTool("chart_network");
    const tree = registerTool("chart_tree");
    const treemap = registerTool("chart_treemap");

    expect(registerTools().map((tool) => tool.name)).toEqual([
      "chart_pie",
      "chart_donut",
      "chart_bar",
      "chart_scatter",
      "chart_line",
      "chart_histogram",
      "chart_bezier",
      "chart_heatmap",
      "chart_boxplot",
      "chart_waterfall",
      "chart_dumbbell",
      "chart_stacked_bar",
      "chart_gantt",
      "chart_network",
      "chart_tree",
      "chart_treemap",
    ]);
    expect([
      pie.name,
      donut.name,
      bar.name,
      scatter.name,
      line.name,
      histogram.name,
      bezier.name,
      heatmap.name,
      boxplot.name,
      waterfall.name,
      dumbbell.name,
      stackedBar.name,
      gantt.name,
      network.name,
      tree.name,
      treemap.name,
    ]).toEqual([
      "chart_pie",
      "chart_donut",
      "chart_bar",
      "chart_scatter",
      "chart_line",
      "chart_histogram",
      "chart_bezier",
      "chart_heatmap",
      "chart_boxplot",
      "chart_waterfall",
      "chart_dumbbell",
      "chart_stacked_bar",
      "chart_gantt",
      "chart_network",
      "chart_tree",
      "chart_treemap",
    ]);
    for (const tool of [
      pie,
      donut,
      bar,
      scatter,
      line,
      histogram,
      bezier,
      heatmap,
      boxplot,
      waterfall,
      dumbbell,
      stackedBar,
      gantt,
      network,
      tree,
      treemap,
    ]) {
      expect(tool.renderShell).toBe("self");
      const renderCall = tool.renderCall;
      if (renderCall === undefined) throw new Error(`${tool.name} call renderer is missing`);
      expect(renderCall({} as never, theme, {} as never).render(80)).toEqual([]);
    }
    expect(registerTools().some((tool) => tool.name === "chart")).toBe(false);
    expect(pie.parameters).toBe(chartPieParameters);
    expect(donut.parameters).toBe(chartDonutParameters);
    expect(bar.parameters).toBe(chartBarParameters);
    expect(scatter.parameters).toBe(chartScatterParameters);
    expect(line.parameters).toBe(chartLineParameters);
    expect(bezier.parameters).toBe(chartBezierParameters);
    expect(tree.parameters).toBe(chartTreeParameters);
    expect(network.parameters).toBe(chartNetworkParameters);
    expect(gantt.parameters).toBe(chartGanttParameters);
    expect(Value.Check(chartPieParameters, { data: rows, title: "Status" })).toBe(true);
    expect(Value.Check(chartBarParameters, { data: rows })).toBe(true);
    expect(
      Value.Check(chartScatterParameters, {
        data: [
          { x: 2, y: 1, label: "CLI" },
          { x: 1, y: 2 },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(chartScatterParameters, {
        data: [
          { x: 2, y: 1 },
          { x: 1, y: 2 },
        ],
        type: "scatter",
      }),
    ).toBe(false);
    expect(
      Value.Check(chartScatterParameters, {
        data: [
          { x: 2, y: 1 },
          { x: 1, y: 2 },
        ],
        series: "tools",
      }),
    ).toBe(false);
    expect(
      Value.Check(chartLineParameters, {
        xType: "numeric",
        data: [
          { x: 1, y: 2 },
          { x: 2, y: null },
        ],
      }),
    ).toBe(true);
    expect(Value.Check(chartPieParameters, { type: "pie", data: rows })).toBe(false);
    expect(Value.Check(chartBarParameters, { type: "bar", data: rows })).toBe(false);
    expect(
      Value.Check(chartLineParameters, {
        type: "line",
        xType: "numeric",
        data: [
          { x: 1, y: 2 },
          { x: 2, y: null },
        ],
      }),
    ).toBe(false);
  });

  test("replays pie details without a type through chart_pie", () => {
    const tool = registerTool();
    const component = tool.renderResult?.(
      { content: [{ type: "text", text: "summary" }], details: { rows, imageWidthCells: 60 } },
      { expanded: false, isPartial: false },
      theme,
      { invalidate: () => undefined } as never,
    );

    expect(component).toBeInstanceOf(ChartComponent);
  });

  test("uses the existing sans-serif default and safely applies a custom font", () => {
    const svg = renderPieChartSvg(rows, theme);
    expect(svg).toContain('font-family="sans-serif"');

    const customFont = `A < B & C "quoted" '`;
    const customSvg = renderPieChartSvg(rows, theme, undefined, undefined, customFont);
    expect(customSvg).toContain('font-family="A &lt; B &amp; C &quot;quoted&quot; &apos;"');
    expect(customSvg).not.toContain(`font-family="${customFont}"`);
  });

  test("merges trusted project chart configuration over global configuration", () => {
    const manager = settingsManager(
      { charts: { fontFamily: "Global Font" } },
      { charts: { fontFamily: "Project Font" } },
      true,
    );
    expect(resolveChartFontFamily(manager.getGlobalSettings(), manager.getProjectSettings())).toBe(
      "Project Font",
    );

    const untrustedManager = settingsManager(
      { charts: { fontFamily: "Global Font" } },
      { charts: { fontFamily: "Project Font" } },
      false,
    );
    expect(
      resolveChartFontFamily(
        untrustedManager.getGlobalSettings(),
        untrustedManager.getProjectSettings(),
      ),
    ).toBe("Global Font");
  });

  test("rejects invalid chart font configuration", () => {
    expect(() => resolveChartFontFamily({ charts: { fontFamily: "   " } }, {})).toThrow(
      "global charts.fontFamily",
    );
    expect(() => resolveChartFontFamily({}, { charts: { unexpected: "value" } })).toThrow(
      "project charts.unexpected: unknown field",
    );
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

    expect(nativeImageCellSize(64, 540, 220, 60, 13)).toEqual({ columns: 60, rows: 13 });
    expect(nativeImageCellSize(30, 252, 251, 28, 14)).toEqual({ columns: 28, rows: 14 });
  });

  test("renders a transparent themed SVG with matching slice and legend colors", () => {
    const svg = renderPieChartSvg(rows, theme);
    expect(svg).toContain('width="540" height="220"');
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

  test("uses a readable fallback when the configured font cannot be matched", async () => {
    const svg = renderPieChartSvg(rows, theme, undefined, "Dansk: æøå");
    const png = Buffer.from(
      await rasterizeSvg(svg, undefined, { fontFamily: "chart-font-that-does-not-exist" }),
      "base64",
    );

    expect(getPngDimensions(png.toString("base64"))).toEqual({ widthPx: 540, heightPx: 220 });
    expect(topLeftPngAlpha(png)).toBe(0);
  });

  test("rejects a mid-flight abort promptly and discards the native result", async () => {
    const svg = renderPieChartSvg(rows, theme);
    await rasterizeSvg(svg); // Warm the cached font resolution so the native render has started.

    const controller = new AbortController();
    const pending = rasterizeSvg(svg, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toThrow("Aborted");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });

  test("bounds a slow raster and safely ignores its eventual completion", async () => {
    const circles = Array.from(
      { length: 900 },
      (_, index) => `<circle cx="${index % 540}" cy="${index % 220}" r="${(index % 7) + 1}"/>`,
    ).join("");
    const svg = renderPieChartSvg(rows, theme).replace("</svg>", `${circles}</svg>`);

    await expect(rasterizeSvg(svg, undefined, { timeoutMs: 1 })).rejects.toThrow(
      "timed out after 1ms",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  });

  test("reads terminal image width from the Pi settings file", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-chart-settings-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      await writeFile(
        join(agentDir, "settings.json"),
        JSON.stringify({ terminal: { imageWidthCells: 73 } }),
      );
      process.env.PI_CODING_AGENT_DIR = agentDir;
      const result = await (registerTool().execute as PieChartExecute)(
        "chart_pie",
        { data: rows },
        undefined,
        undefined,
        tuiContext,
      );
      expect(result.details).toMatchObject({ imageWidthCells: 73 });
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("returns TUI chart data without a native image and retains an image outside TUI", async () => {
    const tool = registerTool();
    const execute = tool.execute as PieChartExecute;
    const params = { data: rows, title: "Status" };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart_pie", params, undefined, undefined, tuiContext),
      execute("chart_pie", params, undefined, undefined, printContext),
    ]);

    expect(tuiResult.content).toEqual([
      { type: "text", text: "Status pie chart: Open 3 (75.0%); Closed 1 (25.0%)" },
    ]);
    expect(tuiResult.details).toEqual(
      expect.objectContaining({
        rows,
        title: "Status",
        imageWidthCells: 80,
        fontFamily: currentChartFontFamily(),
      }),
    );
    const image = printResult.content.find((content) => content.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(getPngDimensions(image?.data ?? "")).toEqual({ widthPx: 720, heightPx: 220 });
  });

  test("rasterizes at native logical dimensions and displays compact wide and narrow cell heights", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const requestedSvg: string[] = [];
    const component = new ChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      pieChartRenderer,
      async (svg) => {
        requestedSvg.push(svg);
        const dimensions = /<svg[^>]*width="(\d+)" height="(\d+)"/.exec(svg);
        if (dimensions === null) throw new Error("expected SVG dimensions");
        return pngHeader(Number(dimensions[1]), Number(dimensions[2]));
      },
    );

    expect(component.render(64)).toEqual([]);
    await Promise.resolve();
    const wide = component.render(64)[0] ?? "";
    expect(requestedSvg[0]).toContain('width="540" height="234" viewBox="0 0 540 220"');
    expect(/(?:^|,)c=60(?:,|;)/.test(wide)).toBe(true);
    expect(/(?:^|,)r=13(?:,|;)/.test(wide)).toBe(true);

    expect(component.render(30)).toEqual([]);
    await Promise.resolve();
    const narrow = component.render(30)[0] ?? "";
    expect(requestedSvg[1]).toContain('width="252" height="252" viewBox="0 0 252 251"');
    expect(/(?:^|,)c=28(?:,|;)/.test(narrow)).toBe(true);
    expect(/(?:^|,)r=14(?:,|;)/.test(narrow)).toBe(true);
  });

  test("cancels stale resize jobs and only invalidates for the current raster", async () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    let invalidations = 0;
    const component = new ChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => {
        invalidations++;
      },
      pieChartRenderer,
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
    const component = new ChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      pieChartRenderer,
      async () => {
        calls++;
        throw new Error("rsvg-convert failed");
      },
    );

    expect(component.render(64)).toEqual([]);
    await Promise.resolve();
    await Promise.resolve();
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(calls).toBe(1);

    component.invalidate();
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(calls).toBe(1);
  });

  test("contains synchronous SVG failures instead of escaping render", () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    let invalidations = 0;
    const component = new ChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => {
        invalidations++;
      },
      {
        ...pieChartRenderer,
        renderSvg: () => {
          throw new Error("invalid chart SVG");
        },
      },
    );

    expect(() => component.render(64)).not.toThrow();
    expect(component.render(64)).toEqual(["Pie chart unavailable"]);
    expect(invalidations).toBe(1);
  });

  test("invalidates cached rasters when the theme identity changes", async () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const requestedSvg: string[] = [];
    const component = new ChartComponent(
      { rows, imageWidthCells: 60 },
      theme,
      () => undefined,
      pieChartRenderer,
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

    expect(component.render(64)).toEqual([]);
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
      renderShell: "self" as const,
      renderCall() {
        return new Text("", 0, 0);
      },
      renderResult(
        result: { details?: unknown },
        _options: unknown,
        renderTheme: Theme,
        context: { lastComponent?: unknown; invalidate: () => void },
      ) {
        const previous = context.lastComponent;
        if (previous instanceof ChartComponent) {
          previous.update(renderTheme);
          return previous;
        }
        return new ChartComponent(
          result.details as { rows: typeof scatterRows; imageWidthCells: number },
          renderTheme,
          context.invalidate,
          scatterChartRenderer,
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
    expect(toolRow.render(66)).toEqual([]);
    toolRow.markExecutionStarted();
    toolRow.setArgsComplete();
    expect(toolRow.render(66)).toEqual([]);
    toolRow.updateResult({
      content: [{ type: "text", text: "summary" }],
      details: { rows: scatterRows, imageWidthCells: 60 },
      isError: false,
    });

    expect(toolRow.render(66)).toEqual([]);
    expect(rasterCalls).toBe(1);
    raster.resolve(pngHeader());
    await new Promise<void>((resolve) => setImmediate(resolve));

    const ready = toolRow.render(66);
    expect(ready.join("\n")).toContain("\u001b_G");
    expect(ready.join("\n")).not.toContain("Rendering scatter chart…");
    expect(ready.join("\n")).not.toContain("chart");
    expect(ready.length).toBeGreaterThan(1);
    expect(toolRow.render(66)).toHaveLength(ready.length);
    expect(rasterCalls).toBe(1);
  });

  test("keeps raster errors visible after hiding the pending tool row", async () => {
    Reflect.set(globalThis, Symbol.for("@earendil-works/pi-coding-agent:theme"), theme);
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    let rasterCalls = 0;
    const renderers = {
      renderShell: "self" as const,
      renderCall: () => new Text("", 0, 0),
      renderResult(
        result: { details?: unknown },
        _options: unknown,
        renderTheme: Theme,
        context: { lastComponent?: unknown; invalidate: () => void },
      ) {
        const previous = context.lastComponent;
        if (previous instanceof ChartComponent) {
          previous.update(renderTheme);
          return previous;
        }
        return new ChartComponent(
          result.details as { rows: typeof rows; imageWidthCells: number },
          renderTheme,
          context.invalidate,
          pieChartRenderer,
          async () => {
            rasterCalls++;
            throw new Error("rsvg-convert failed");
          },
        );
      },
    };
    const toolRow = new ToolExecutionComponent(
      "chart",
      "chart-error",
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

    expect(toolRow.render(66)).toEqual([]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(toolRow.render(66).join("\n")).toContain("Pie chart unavailable");
    expect(rasterCalls).toBe(1);
  });

  test("honors an already-aborted non-TUI tool call", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = registerTool().execute as PieChartExecute;

    await expect(
      execute("chart_pie", { data: rows }, controller.signal, undefined, printContext),
    ).rejects.toThrow("aborted");
  });
});
