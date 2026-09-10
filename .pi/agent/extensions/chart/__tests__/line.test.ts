import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getPngDimensions } from "@earendil-works/pi-tui";
import chartExtension from "../index";
import {
  getLineChartLayout,
  type LineChartInput,
  lineChartRenderer,
  renderLineChartSvg,
  validateLineChartInput,
} from "../types/line";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };

function details(input: LineChartInput) {
  return lineChartRenderer.createDetails(lineChartRenderer.parseParameters(input), settings);
}

function chartPoints(svg: string): Array<[number, number]> {
  const path = /<path[^>]*data-ts-key="line[^>]* d="([^"]+)"/.exec(svg)?.[1];
  if (path === undefined) throw new Error("expected line path");
  return [...path.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((point) => {
    const x = Number(point[1]);
    const y = Number(point[2]);
    if (x === undefined || y === undefined) throw new Error("expected point coordinates");
    return [x, y];
  });
}

function registerTool(): ToolDefinition {
  let tool: ToolDefinition | undefined;
  chartExtension({
    registerTool: (definition: ToolDefinition) => {
      if (definition.name === "chart_line") tool = definition;
    },
  } as unknown as ExtensionAPI);
  if (tool === undefined) throw new Error("chart was not registered");
  return tool;
}

describe("line chart", () => {
  const numeric: LineChartInput = {
    type: "line",
    xType: "numeric",
    data: [
      { x: 0, y: 2 },
      { x: 10, y: 4 },
      { x: 100, y: 8 },
    ],
  };

  test("uses proportional numeric and temporal x spacing", () => {
    const numericPoints = chartPoints(renderLineChartSvg(details(numeric), theme));
    const numericFirst = numericPoints[0]?.[0] ?? 0;
    const numericSecond = numericPoints[1]?.[0] ?? 0;
    const numericThird = numericPoints[2]?.[0] ?? 0;
    expect((numericThird - numericSecond) / (numericSecond - numericFirst)).toBeCloseTo(9, 3);

    const temporal: LineChartInput = {
      type: "line",
      xType: "temporal",
      data: [
        { x: "2024-01-01", y: 2 },
        { x: "2024-01-02", y: 4 },
        { x: "2024-01-11", y: 8 },
      ],
    };
    const temporalPoints = chartPoints(renderLineChartSvg(details(temporal), theme));
    const first = temporalPoints[0]?.[0] ?? 0;
    const second = temporalPoints[1]?.[0] ?? 0;
    const third = temporalPoints[2]?.[0] ?? 0;
    expect((third - second) / (second - first)).toBeCloseTo(9, 3);
  });

  test("preserves null values as disconnected paths and omits their markers", () => {
    const input: LineChartInput = {
      type: "line",
      xType: "numeric",
      markers: true,
      data: [
        { x: 0, y: 1 },
        { x: 1, y: null },
        { x: 2, y: 3 },
        { x: 3, y: 4 },
      ],
    };
    const svg = renderLineChartSvg(details(input), theme);
    expect((svg.match(/<path[^>]*data-ts-key="line/g) ?? []).length).toBe(2);
    expect((svg.match(/<circle[^>]*:dot"/g) ?? []).length).toBe(3);
    expect(renderLineChartSvg(details({ ...input, markers: false }), theme)).not.toContain(':dot"');
  });

  test("validates temporal dates, finite values, and strictly increasing x values", () => {
    expect(() =>
      validateLineChartInput({
        type: "line",
        xType: "temporal",
        data: [
          { x: "2024-02-30", y: 1 },
          { x: "2024-03-01", y: 2 },
        ],
      }),
    ).toThrow("valid ISO date");
    expect(() =>
      validateLineChartInput({
        type: "line",
        xType: "numeric",
        data: [
          { x: 2, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
    ).toThrow("strictly increasing");
    expect(() =>
      validateLineChartInput({
        type: "line",
        xType: "numeric",
        data: [
          { x: 1, y: null },
          { x: 2, y: null },
        ],
      }),
    ).toThrow("at least one");
  });

  test("escapes labels, defaults markers off, and keeps narrow ticks within the image", () => {
    const input: LineChartInput = {
      type: "line",
      xType: "numeric",
      title: "A < B",
      xLabel: "Time & date",
      yLabel: "Value > 0",
      data: [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
      ],
    };
    const lineDetails = details(input);
    expect(lineDetails.markers).toBe(false);
    const narrow = getLineChartLayout({ widthPx: 9, heightPx: 18 }, 28, true, true, true);
    expect(narrow.heightCells).toBeLessThanOrEqual(18);
    const svg = renderLineChartSvg(lineDetails, theme, narrow, `A < B & C "quoted" '`);
    expect(svg).toContain("Time &amp; date");
    expect(svg).toContain("Value &gt; 0");
    expect(svg).toContain('font-family="A &lt; B &amp; C &quot;quoted&quot; &apos;"');
    expect(svg).not.toContain("NaN");
  });

  test("routes a line call through replay details and PNG output", async () => {
    const tool = registerTool();
    const context = {
      mode: "print",
      cwd: process.cwd(),
      isProjectTrusted: () => false,
      ui: {
        theme: {
          ...theme,
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        },
      },
    };
    const result = await tool.execute(
      "chart",
      { ...numeric, title: "Trend" },
      undefined,
      undefined,
      context as unknown as ExtensionContext,
    );
    expect(result.details).toMatchObject({ type: "line", xType: "numeric", markers: false });
    const image = result.content.find((content) => content.type === "image");
    expect(image?.type).toBe("image");
    if (image?.type !== "image") throw new Error("expected PNG image");
    expect(getPngDimensions(image.data)).toMatchObject({ widthPx: 720 });

    const tuiResult = await tool.execute(
      "chart",
      { ...numeric, title: "Trend" },
      undefined,
      undefined,
      { ...context, mode: "tui" } as unknown as ExtensionContext,
    );
    expect(tuiResult.content).toEqual([
      { type: "text", text: "Trend line chart: 0 2; 10 4; 100 8" },
    ]);
    expect(tuiResult.details).toMatchObject({ type: "line", title: "Trend" });
  });
});
