import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import chartExtension from "../index";
import { resolveChartSettings } from "../types";
import {
  type BarChartInput,
  barChartRenderer,
  barChartVariant,
  getBarChartLayout,
  renderBarChartSvg,
  validateBarChartInput,
} from "../types/bar";

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
    return colors[color] ?? colors.accent ?? "";
  },
} as unknown as Theme;

type ChartExecute = (
  toolCallId: string,
  params: BarChartInput,
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: unknown;
}>;

function registerTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  chartExtension({
    on: () => {},
    registerTool: (definition: ToolDefinition) => {
      if (definition.name === "chart_bar") tool = definition;
    },
  } as unknown as ExtensionAPI);
  if (tool === undefined) throw new Error("chart was not registered");
  return tool;
}

const tuiContext = {
  mode: "tui",
  cwd: process.cwd(),
  isProjectTrusted: () => false,
  ui: { theme },
} as unknown as ExtensionContext;

const printContext = { ...tuiContext, mode: "print" } as unknown as ExtensionContext;

function currentChartFontFamily(): string {
  const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
  return resolveChartSettings(settings.getGlobalSettings(), settings.getProjectSettings())
    .fontFamily;
}

describe("bar chart", () => {
  const rows = [
    { label: "Loss", value: -4 },
    { label: "Neutral", value: 0 },
    { label: "Gain", value: 6 },
  ];

  test("validates finite signed values and preserves input order", () => {
    expect(validateBarChartInput({ type: "bar", data: rows })).toEqual(rows);
    expect(() =>
      validateBarChartInput({
        type: "bar",
        data: [
          { label: "Bad", value: Number.NaN },
          { label: "Neutral", value: 0 },
        ],
      }),
    ).toThrow("finite");
    expect(() =>
      validateBarChartInput({
        type: "bar",
        data: [
          { label: "Loss", value: -4 },
          { label: " Loss ", value: 3 },
        ],
      }),
    ).toThrow("duplicates");
    expect(Value.Check(barChartVariant, { type: "bar", data: rows })).toBe(true);
    expect(Value.Check(barChartVariant, { type: "bar", data: [{ label: "x", value: 1 }] })).toBe(
      false,
    );
  });

  test("renders ordered signed bars, a zero baseline, and readable labels and values", () => {
    const svg = renderBarChartSvg(rows, theme, undefined, "Balance");
    expect(svg).toContain('aria-label="Bar chart: Balance"');
    expect(svg).toContain("Loss: -4");
    expect(svg).toContain("Neutral: 0");
    expect(svg).toContain("Gain: 6");
    expect(svg.indexOf("Loss: -4")).toBeLessThan(svg.indexOf("Neutral: 0"));
    expect(svg.indexOf("Neutral: 0")).toBeLessThan(svg.indexOf("Gain: 6"));
    expect(svg).toContain('stroke-opacity="0.72"');
    const zeroBar = /<rect[^>]* x="([^"]+)"[^>]* width="0"/.exec(svg);
    const baseline = /<line x1="([^"]+)" x2="\1" y1="0"/.exec(svg);
    expect(zeroBar?.[1]).toBeDefined();
    expect(baseline?.[1]).toBeDefined();
    expect(Number(zeroBar?.[1])).toBeCloseTo(Number(baseline?.[1]), 1);
    expect(svg).toContain("rgb(102, 165, 173)");
    expect(svg).toContain("rgb(129, 155, 105)");
    expect(svg).not.toMatch(/<rect\b[^>]*width="100%"[^>]*height="100%"/);
  });

  test("escapes custom fonts and adapts raster dimensions to the available width", () => {
    const font = `A < B & C "quoted" '`;
    const svg = renderBarChartSvg(rows, theme, undefined, undefined, font);
    expect(svg).toContain('font-family="A &lt; B &amp; C &quot;quoted&quot; &apos;"');

    const wide = getBarChartLayout(undefined, 60, rows.length, true);
    const narrow = getBarChartLayout({ widthPx: 9, heightPx: 18 }, 28, rows.length, true);
    expect(wide).toMatchObject({ widthPx: 540, heightCells: 7 });
    expect(narrow).toMatchObject({ widthPx: 252, heightCells: 7 });
    expect(wide.plotWidthPx).toBeGreaterThan(narrow.plotWidthPx);

    const wideSvg = renderBarChartSvg(rows, theme, wide, "Balance");
    const narrowSvg = renderBarChartSvg(rows, theme, narrow, "Balance");
    expect(wideSvg).toContain('width="540" height="114" viewBox="0 0 540 114"');
    expect(narrowSvg).toContain('width="252" height="114" viewBox="0 0 252 114"');
  });

  test("routes bar results through TUI replay details and non-TUI PNG output", async () => {
    const execute = registerTool().execute as ChartExecute;
    const params: BarChartInput = { type: "bar", data: rows, title: "Balance" };
    const [tuiResult, printResult] = await Promise.all([
      execute("chart", params, undefined, undefined, tuiContext),
      execute("chart", params, undefined, undefined, printContext),
    ]);
    expect(tuiResult.content).toEqual([
      { type: "text", text: "Balance bar chart: Loss -4; Neutral 0; Gain 6" },
    ]);
    expect(tuiResult.details).toEqual(
      expect.objectContaining({
        type: "bar",
        rows,
        title: "Balance",
        imageWidthCells: 80,
        fontFamily: currentChartFontFamily(),
      }),
    );
    const details = barChartRenderer.deserializeDetails(tuiResult.details);
    if (details === undefined) throw new Error("bar result must include replay details");
    const layout = barChartRenderer.getLayout(details, undefined, details.imageWidthCells);
    const image = printResult.content.find((content) => content.type === "image");
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(getPngDimensions(image?.data ?? "")).toEqual({
      widthPx: layout.widthPx,
      heightPx: layout.heightPx,
    });
  });

  test("deserializes only persisted bar details", () => {
    expect(barChartRenderer.deserializeDetails({ type: "bar", rows, imageWidthCells: 60 })).toEqual(
      { type: "bar", rows, imageWidthCells: 60 },
    );
    expect(barChartRenderer.deserializeDetails({ rows, imageWidthCells: 60 })).toBeUndefined();
  });
});
