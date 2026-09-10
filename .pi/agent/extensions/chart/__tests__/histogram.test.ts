import { describe, expect, test } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { LazyChartComponent } from "../lazy";
import { createHistogramChartTool } from "../metadata";
import { chartHistogramParameters, type HistogramChartInput } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  deserializeHistogramChartDetails,
  getHistogramChartLayout,
  getHistogramChartSummary,
  histogramChartRenderer,
  renderHistogramChartSvg,
  validateHistogramChartInput,
} from "../types/histogram";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };
const parse = (data: number[], bins?: number) =>
  validateHistogramChartInput({ type: "histogram", data, ...(bins === undefined ? {} : { bins }) });
const details = histogramChartRenderer.createDetails(parse([-2, -1, 0, 0, 2], 4), settings);
const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;

describe("histogram", () => {
  test("counts exact edges to the right and includes the maximum in the last bin", () => {
    expect(details.rows).toEqual([
      { lower: -2, upper: -1, count: 1 },
      { lower: -1, upper: 0, count: 1 },
      { lower: 0, upper: 1, count: 2 },
      { lower: 1, upper: 2, count: 1 },
    ]);
    expect(parse([2, 0, -1, 0, -2], 4).rows).toEqual(details.rows);
    expect(getHistogramChartSummary(details)).toBe(
      "Histogram: [-2, -1): 1; [-1, 0): 1; [0, 1): 2; [1, 2]: 1",
    );
    expect(parse([0, 0.099999999, 0.1, 0.3], 3).rows.map((row) => row.count)).toEqual([2, 1, 1]);
  });

  test("uses deterministic square-root bins and retains empty bins", () => {
    expect(parse([0, 0, 0, 4]).rows).toEqual([
      { lower: 0, upper: 2, count: 3 },
      { lower: 2, upper: 4, count: 1 },
    ]);
    expect(parse([0, 5], 5).rows.map((row) => row.count)).toEqual([1, 0, 0, 0, 1]);
    expect(parse([0, 5], 1).rows).toEqual([{ lower: 0, upper: 5, count: 2 }]);
    expect(parse(Array.from({ length: 200 }, (_, index) => index)).rows).toHaveLength(15);
    expect(parse([0, 100], 50).rows).toHaveLength(50);
  });

  test("centers constant and singleton samples in one bin", () => {
    expect(parse([0]).rows).toEqual([{ lower: -0.5, upper: 0.5, count: 1 }]);
    expect(parse([-100, -100], 50).rows).toEqual([{ lower: -101, upper: -99, count: 2 }]);
    expect(parse([Number.MIN_VALUE]).rows).toEqual([{ lower: -0.5, upper: 0.5, count: 1 }]);
  });

  test("rejects overflow and collapsed boundaries rather than dropping samples", () => {
    expect(() => parse([-Number.MAX_VALUE, Number.MAX_VALUE])).toThrow(
      "range cannot be represented",
    );
    expect(() => parse([Number.MAX_VALUE])).toThrow("range cannot be represented");
    expect(() => parse([1, 1 + Number.EPSILON], 2)).toThrow("boundaries cannot be represented");
    expect(() => parse([0, Number.MIN_VALUE], 2)).toThrow("boundaries cannot be represented");
    expect(parse([0, Number.MIN_VALUE], 1).rows[0]?.count).toBe(2);
    expect(parse([-1e307, 1e307], 50).rows.reduce((total, row) => total + row.count, 0)).toBe(2);
  });

  test("exposes a bounded discriminator-free schema and rejects malformed inputs", async () => {
    expect(Value.Check(chartHistogramParameters, { data: [1] })).toBe(true);
    const invalid: unknown[] = [
      {},
      { data: [] },
      { data: Array(201).fill(1) },
      { data: [null] },
      { data: ["1"] },
      { data: [{ value: 1 }] },
      { data: [1], type: "histogram" },
      { data: [1], weights: [1] },
      ...[0, 51, 1.5, "2", null].map((bins) => ({ data: [1], bins })),
      { data: [1], title: "x".repeat(81) },
      { data: [1], xLabel: "x".repeat(41) },
    ];
    for (const input of invalid) expect(Value.Check(chartHistogramParameters, input)).toBe(false);
    const tool = createHistogramChartTool();
    for (const data of [[Number.NaN], [Infinity], [-Infinity]]) {
      expect(() => parse(data)).toThrow();
      await expect(
        tool.execute("bad", { data }, undefined, undefined, context("tui")),
      ).rejects.toThrow();
    }
    for (const input of invalid) {
      await expect(
        tool.execute("bad", input as never, undefined, undefined, context("tui")),
      ).rejects.toThrow();
    }
    for (const label of ["title", "xLabel", "yLabel"] as const) {
      expect(() =>
        validateHistogramChartInput({ type: "histogram", data: [1], [label]: "   " }),
      ).toThrow("blank");
    }
    expect(() =>
      validateHistogramChartInput({
        type: "histogram",
        data: [null],
      } as unknown as HistogramChartInput),
    ).toThrow();
  });

  test("round-trips details and rejects malformed replay data", () => {
    expect(deserializeHistogramChartDetails(JSON.parse(JSON.stringify(details)))).toEqual(details);
    for (const invalid of [
      null,
      {},
      { ...details, rows: [] },
      { ...details, yLabel: undefined },
      { ...details, imageWidthCells: Infinity },
      { ...details, fontSize: Infinity },
      { ...details, rows: [{ lower: 0, upper: 0, count: 1 }] },
      { ...details, rows: [{ lower: 0, upper: 1, count: 0 }] },
      { ...details, rows: [{ lower: 0, upper: 1, count: -1 }] },
      { ...details, rows: [{ lower: 0, upper: 1, count: 1.5 }] },
      { ...details, rows: [{ lower: -Number.MAX_VALUE, upper: Number.MAX_VALUE, count: 1 }] },
      {
        ...details,
        rows: [
          { lower: 0, upper: 1, count: 200 },
          { lower: 2, upper: 3, count: 1 },
        ],
      },
    ])
      expect(deserializeHistogramChartDetails(invalid)).toBeUndefined();
  });

  test("renders contiguous count-scaled bars, escaped labels, and full-resolution PNG", async () => {
    const labeled = {
      ...details,
      title: "æøå <&>",
      xLabel: "Sample <value>",
      yLabel: "Events & count",
    };
    const svg = renderHistogramChartSvg(labeled, theme);
    expect(svg).toContain("æøå &lt;&amp;&gt;");
    expect(svg).toContain("Sample &lt;value&gt;");
    expect(svg).toContain("Events &amp; count");
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(renderHistogramChartSvg(details, theme)).toContain(">Count</text>");
    const rectangles = [
      ...svg.matchAll(
        /<rect data-bin="\d+" x="([^"]+)" y="[^"]+" width="([^"]+)" height="([^"]+)"/g,
      ),
    ].map((match) => ({ x: Number(match[1]), width: Number(match[2]), height: Number(match[3]) }));
    expect(rectangles).toHaveLength(4);
    expect(rectangles.map((rect) => rect.height)).toEqual([72, 72, 144, 72]);
    for (let index = 1; index < rectangles.length; index++) {
      const previous = rectangles[index - 1];
      expect(rectangles[index]?.x).toBeCloseTo((previous?.x ?? 0) + (previous?.width ?? 0));
    }
    const cells = { widthPx: 16, heightPx: 38 };
    const layout = getHistogramChartLayout(cells, 60, true, true, 14);
    expect(layout.heightCells).toBeLessThanOrEqual(18);
    expect(getHistogramChartLayout(cells, 28, true, true, 32).heightCells).toBeLessThanOrEqual(18);
    const extreme = histogramChartRenderer.createDetails(
      parse([1e308, Number.MAX_VALUE], 2),
      settings,
    );
    expect(renderHistogramChartSvg(extreme, theme)).not.toMatch(/NaN|Infinity/);
    const png = await rasterizeSvg(renderHistogramChartSvg(labeled, theme, layout));
    expect(getPngDimensions(png)).toEqual({ widthPx: 960, heightPx: layout.heightPx });
    const maximum = histogramChartRenderer.createDetails(parse([-1e307, 1e307], 50), settings);
    expect(Buffer.byteLength(renderHistogramChartSvg(maximum, theme))).toBeLessThan(64 * 1024);
    expect(
      getPngDimensions(await rasterizeSvg(renderHistogramChartSvg(maximum, theme))),
    ).not.toBeNull();
  });

  test("executes in TUI and print modes and reuses the result component", async () => {
    const tool = createHistogramChartTool();
    const input = { data: [-2, -1, 0, 0, 2], bins: 4 };
    const tui = await tool.execute("histogram", input, undefined, undefined, context("tui"));
    expect(tui.content).toHaveLength(1);
    expect(tui.details?.rows).toEqual(details.rows);
    const printed = await tool.execute("histogram", input, undefined, undefined, context("print"));
    expect(
      printed.content.some((part) => part.type === "image" && getPngDimensions(part.data) !== null),
    ).toBe(true);
    const renderContext = { invalidate: () => undefined } as never;
    const component = tool.renderResult?.(
      tui,
      { expanded: false, isPartial: false },
      theme,
      renderContext,
    );
    expect(component).toBeDefined();
    const repeated = tool.renderResult?.(tui, { expanded: false, isPartial: false }, theme, {
      lastComponent: component,
      invalidate: () => undefined,
    } as never);
    expect(repeated).toBe(component);
    const abort = new AbortController();
    abort.abort();
    await expect(
      tool.execute("aborted", input, abort.signal, undefined, context("print")),
    ).rejects.toThrow();
  });
});

test("loads histogram replay on render and retains the completed image", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  const ready = Promise.withResolvers<string[]>();
  const component = new LazyChartComponent({
    type: "histogram",
    details,
    theme,
    requestRender() {
      const lines = component.render(64);
      if (lines.length > 0) ready.resolve(lines);
    },
  });
  expect(component.render(64)).toEqual([]);
  const lines = await ready.promise;
  expect(lines.join("\n")).toContain("\u001b_G");
  component.invalidate();
  expect(component.render(64)).toEqual(lines);
});
