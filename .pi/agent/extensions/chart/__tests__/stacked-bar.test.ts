import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { createPieChartTool, createStackedBarChartTool } from "../metadata";
import { chartStackedBarParameters, type StackedBarChartInput } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  deserializeStackedBarChartDetails,
  getStackedBarChartLayout,
  getStackedBarChartSummary,
  getStackedBarDomain,
  getStackedBarTotals,
  renderStackedBarChartSvg,
  stackedBarChartRenderer,
  validateStackedBarChartInput,
} from "../types/stacked-bar";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const input: StackedBarChartInput = {
  type: "stacked_bar",
  categories: [" North ", "South", "Zero"],
  series: [
    { name: " First ", values: [1, 6, 0] },
    { name: "Second", values: [3, 2, 0] },
    { name: "Empty", values: [0, 0, 0] },
  ],
};
const details = (options: Partial<StackedBarChartInput> = {}) =>
  stackedBarChartRenderer.createDetails(validateStackedBarChartInput({ ...input, ...options }), {
    imageWidthCells: 60,
    fontFamily: "sans-serif",
  });
function rectangles(svg: string) {
  return [...svg.matchAll(/<rect\b[^>]*\/>/g)].map((match) =>
    Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}
const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;

describe("stacked bar", () => {
  test("trims labels, preserves independent raw arrays and resolves normalization only once", () => {
    const d = details();
    expect(d.normalize).toBe(false);
    expect(d.categories).toEqual(["North", "South", "Zero"]);
    expect(d.series[0]?.name).toBe("First");
    expect(d.series[0]?.values).not.toBe(input.series[0]?.values);
    expect(input.categories[0]).toBe(" North ");
    expect(getStackedBarTotals(d)).toEqual([4, 8, 0]);
    expect(getStackedBarDomain(d)).toEqual([0, 8]);
    expect(getStackedBarChartSummary(d)).toBe(
      "Stacked bar; Raw values and totals: North: First=1, Second=3, Empty=0, total=4; South: First=6, Second=2, Empty=0, total=8; Zero: First=0, Second=0, Empty=0, total=0",
    );
    const normalized = details({ normalize: true });
    expect(getStackedBarDomain(normalized)).toEqual([0, 100]);
    expect(getStackedBarChartSummary(normalized)).toContain(
      "100% normalized; raw values and totals: North: First=1, Second=3, Empty=0, total=4",
    );
    expect(deserializeStackedBarChartDetails(JSON.parse(JSON.stringify(normalized)))).toEqual(
      normalized,
    );
    const decimal = details({
      categories: ["A"],
      series: [
        { name: "A", values: [0.1] },
        { name: "B", values: [0.2] },
      ],
    });
    expect(getStackedBarChartSummary(decimal)).toContain("total=0.30000000000000004");
  });

  test("actual TanStack rectangles stack without gaps in category order with stable legend colors", () => {
    for (const normalize of [false, true]) {
      const d = details({ normalize });
      const layout = getStackedBarChartLayout(d);
      const svg = renderStackedBarChartSvg(d, theme, layout);
      const all = rectangles(svg);
      const bars = all.filter((mark) => mark["data-ts-key"]);
      const legend = all.filter((mark) => !mark["data-ts-key"]);
      expect(bars).toHaveLength(9);
      expect(legend).toHaveLength(3);
      for (let row = 0; row < 3; row++) {
        const marks = [0, 1, 2].map((series) =>
          bars.find((bar) => bar["data-ts-key"]?.endsWith(`series-${series}-row-${row}`)),
        );
        const [first, second, empty] = marks;
        assert(first && second && empty);
        const denominator = normalize ? [4, 8, 1][row] : 8;
        assert(denominator);
        expect(Number(first.x)).toBe(0);
        expect(Number(first.width)).toBeCloseTo(
          (layout.plotWidthPx * (input.series[0]?.values[row] ?? 0)) / denominator,
          2,
        );
        expect(Number(second.x)).toBeCloseTo(Number(first.width), 2);
        // TanStack rounds each SVG coordinate independently to two decimals.
        expect(Math.abs(Number(empty.x) - Number(second.x) - Number(second.width))).toBeLessThan(
          0.011,
        );
        expect(Number(empty.width)).toBe(0);
        expect(first.y).toBe(second.y);
        expect(Number(first.y)).toBeCloseTo(((row + 0.2) * layout.plotHeightPx) / 3, 2);
        marks.forEach((mark, index) => {
          expect(mark?.fill).toBe(legend[index]?.fill);
        });
        if (row === 2) expect(Number(second.width)).toBe(0);
      }
      expect(svg).toContain(">Empty</text>");
      if (normalize) {
        expect(svg).toContain(">0%</text>");
        expect(svg).toContain(">100%</text>");
      }
    }
  });

  test("rejects malformed public inputs and saved details at both boundaries", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartStackedBarParameters, parameters)).toBe(true);
    expect(Value.Check(chartStackedBarParameters, input)).toBe(false);
    const invalid = [
      { categories: [] },
      { categories: Array.from({ length: 13 }, (_, i) => String(i)) },
      { categories: ["A", " A ", "C"] },
      { categories: [" ", "B", "C"] },
      { categories: ["a".repeat(23), "B", "C"] },
      { series: [] },
      { series: Array.from({ length: 7 }, (_, i) => ({ name: String(i), values: [1, 2, 3] })) },
      {
        series: [
          { name: "A", values: [1, 2, 3] },
          { name: " A ", values: [1, 2, 3] },
        ],
      },
      { series: [{ name: " ", values: [1, 2, 3] }] },
      { series: [{ name: "a".repeat(23), values: [1, 2, 3] }] },
      { series: [{ name: "A", values: [1, 2] }] },
      { series: [{ name: "A", values: [1, 2, 3, 4] }] },
      ...[NaN, Infinity, -Infinity, -1, 1e9 + 1, null, "1", undefined].map((value) => ({
        series: [{ name: "A", values: [value, 2, 3] }],
      })),
      { series: [{ name: "A", values: [1, 2, 3], extra: true }] },
      { normalize: "true" },
      { normalize: null },
      { title: " " },
      { title: "a".repeat(81) },
      { xLabel: " " },
      { yLabel: "a".repeat(41) },
      { extra: true },
      { type: "stacked_bar" },
    ];
    for (const bad of invalid) {
      await expect(
        createStackedBarChartTool().execute(
          "bad",
          { ...parameters, ...bad } as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
      if (!("type" in bad))
        expect(deserializeStackedBarChartDetails({ ...details(), ...bad })).toBeUndefined();
    }
    for (const bad of [
      { type: "bar" },
      { imageWidthCells: Infinity },
      { imageWidthCells: 0 },
      { fontFamily: undefined },
      { fontSize: 33 },
      { normalize: undefined },
    ])
      expect(deserializeStackedBarChartDetails({ ...details(), ...bad })).toBeUndefined();
  });

  test("constant, zero, subnormal and maximum totals produce bounded finite full-resolution PNGs", async () => {
    for (const normalize of [false, true]) {
      for (const value of [0, 7, 1e9, Number.MIN_VALUE]) {
        const d = details({
          normalize,
          categories: ["A"],
          series: Array.from({ length: 6 }, (_, i) => ({ name: String(i), values: [value] })),
        });
        expect(getStackedBarTotals(d)).toEqual([value * 6]);
        const svg = renderStackedBarChartSvg(d, theme);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        const bars = rectangles(svg).filter((mark) => mark["data-ts-key"]);
        if (value === 0) expect(bars.every((bar) => Number(bar.width) === 0)).toBe(true);
        const layout = getStackedBarChartLayout(d);
        expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({
          widthPx: layout.widthPx,
          heightPx: layout.heightPx,
        });
      }
    }
    const d = {
      ...details({
        categories: Array.from({ length: 12 }, (_, i) => `${i}${"&".repeat(20)}`),
        series: Array.from({ length: 6 }, (_, i) => ({
          name: `${i}${"&".repeat(21)}`,
          values: Array(12).fill(1e9),
        })),
        title: "&".repeat(80),
        xLabel: "&".repeat(40),
        yLabel: "&".repeat(40),
        normalize: true,
      }),
      fontSize: 32,
    };
    for (const width of [8, 20, 60]) {
      const svg = renderStackedBarChartSvg(d, theme, getStackedBarChartLayout(d, undefined, width));
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
      expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    }
  }, 15_000);

  test("escapes user text and preserves complete Danish labels and raw totals in normalized descriptions", () => {
    const d = details({
      categories: [" æ<& "],
      series: [
        { name: " Før<& ", values: [0.1] },
        { name: " Efter ", values: [0.2] },
      ],
      title: '<script>"&',
      xLabel: "ø<&",
      yLabel: "å<&",
      normalize: true,
    });
    const svg = renderStackedBarChartSvg({ ...d, fontFamily: 'Font "<&' }, theme);
    expect(svg).not.toContain("<script>");
    for (const text of [
      "æ&lt;&amp;",
      "ø&lt;&amp;",
      "å&lt;&amp;",
      "&lt;script&gt;&quot;&amp;",
      "Før&lt;&amp;",
      "Efter",
      "Font &quot;&lt;&amp;",
      "total=0.30000000000000004",
    ])
      expect(svg).toContain(text);
  });

  test("print uses the worker, TUI defers images, and cancellation fails before execution", async () => {
    const tool = createStackedBarChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateStackedBarChartInput(input));
    const printed = await tool.execute("print", parameters, undefined, undefined, context("print"));
    const image = printed.content.find((part) => part.type === "image");
    assert(image?.type === "image");
    expect(getPngDimensions(image.data)).toBeDefined();
    const abort = new AbortController();
    abort.abort();
    await expect(
      tool.execute("abort", parameters, abort.signal, undefined, context("tui")),
    ).rejects.toThrow();
  }, 15_000);

  test("replays by saved discriminator, retains the cached component and rejects malformed replay", async () => {
    const { type: _type, ...parameters } = input;
    const tui = await createStackedBarChartTool().execute(
      "replay",
      { ...parameters, normalize: true },
      undefined,
      undefined,
      context("tui"),
    );
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 16, heightPx: 38 });
    const render = createPieChartTool().renderResult;
    assert(render);
    let wake = () => {};
    let ready = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const ctx = { invalidate: () => wake() };
    const component = render(
      tui as never,
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    expect(component.render(80)).toEqual([]);
    await ready;
    ready = new Promise<void>((resolve) => {
      wake = resolve;
    });
    component.render(80);
    await ready;
    expect(component.render(80).join("\n")).toContain("\u001b_G");
    expect(
      render(tui as never, { expanded: false, isPartial: false }, theme, {
        ...ctx,
        lastComponent: component,
      } as never),
    ).toBe(component);
    ready = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const invalid = render(
      { content: [], details: { ...tui.details, extra: true } } as never,
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    expect(invalid.render(80)).toEqual([]);
    await ready;
    expect(invalid.render(80)).toEqual(["Stacked bar chart unavailable"]);
  }, 15_000);
});
