import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  getPngDimensions,
  Image,
  setCapabilities,
  setCellDimensions,
} from "@earendil-works/pi-tui";
import chartExtension, {
  getPieChartLayout,
  renderPieChartSvg,
  validatePieChartInput,
} from "../index";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  getFgAnsi: (color: string) => {
    const colors: Record<string, string> = {
      accent: "\u001b[38;2;96;165;250m",
      success: "\u001b[38;2;74;222;128m",
      warning: "\u001b[38;2;250;204;21m",
      error: "\u001b[38;2;248;113;113m",
      text: "\u001b[38;2;230;232;236m",
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

type PieChartExecute = (
  toolCallId: string,
  params: { labels: string[]; values: number[] },
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<{ content: Array<{ type: string; data: string; mimeType: string }> }>;

function registerTool(): PieChartExecute {
  let execute: PieChartExecute | undefined;
  chartExtension({
    registerTool: (tool: ToolDefinition) => {
      execute = tool.execute as PieChartExecute;
    },
  } as unknown as ExtensionAPI);
  if (execute === undefined) throw new Error("pie_chart was not registered");
  return execute;
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

const printContext = { mode: "print", ui: { theme } } as unknown as ExtensionContext;
const tuiContext = { mode: "tui", ui: { theme } } as unknown as ExtensionContext;

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

  test("uses Pi's 60-cell default and bounded non-TUI cell fallback", () => {
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
  });

  test("matches Pi's public native Image wide and narrow tool constraints", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });

    expect(nativeImageCellSize(64)).toEqual({ columns: 60, rows: 20 });
    expect(nativeImageCellSize(30)).toEqual({ columns: 28, rows: 10 });
  });

  test("renders a simple pie in a native-size panel with a semantic themed legend", () => {
    const svg = renderPieChartSvg(
      validatePieChartInput({ labels: ["<Open>", "Closed"], values: [3, 1] }),
      theme,
    );

    expect(svg).toContain('width="540"');
    expect(svg).toContain('viewBox="0 0 540 360"');
    expect(svg).toContain('x="355"');
    expect(svg).toContain('x="371"');
    expect(svg).toContain("rgb(96, 165, 250)");
    expect(svg).toContain("rgb(74, 222, 128)");
    expect(svg).toContain("rgb(25, 28, 38)");
    expect(svg).toContain("&lt;Open&gt;");
    expect(svg).toContain('aria-label="Pie chart"');
    expect(svg).not.toContain("innerRadius");
  });

  test("returns a runtime-sized TUI PNG and the bounded non-TUI fallback PNG", async () => {
    const execute = registerTool();
    const params = { labels: ["Open", "Closed"], values: [3, 1] };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart", params, undefined, undefined, tuiContext),
      execute("chart", params, undefined, undefined, printContext),
    ]);

    for (const result of [tuiResult, printResult]) {
      const image = result.content[0];
      expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
      expect(getPngDimensions(image?.data ?? "")).toEqual({ widthPx: 540, heightPx: 360 });
    }
  });

  test("honors an already-aborted tool call", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      registerTool()(
        "chart",
        { labels: ["Open", "Closed"], values: [3, 1] },
        controller.signal,
        undefined,
        printContext,
      ),
    ).rejects.toThrow("aborted");
  });
});
