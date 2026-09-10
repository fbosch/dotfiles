import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { createPieChartTool, createWaterfallChartTool } from "../metadata";
import { chartWaterfallParameters, type WaterfallChartInput } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  deserializeWaterfallChartDetails,
  getWaterfallChartLayout,
  getWaterfallChartSummary,
  getWaterfallDomain,
  getWaterfallRows,
  renderWaterfallChartSvg,
  validateWaterfallChartInput,
  waterfallChartRenderer,
} from "../types/waterfall";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };
const input: WaterfallChartInput = {
  type: "waterfall",
  start: -10,
  deltas: [
    { label: " Up ", value: 30 },
    { label: "Down", value: -50 },
    { label: "Back", value: 25 },
    { label: "Zero", value: 0 },
  ],
};
const details = (options: Partial<WaterfallChartInput> = {}) =>
  waterfallChartRenderer.createDetails(
    validateWaterfallChartInput({ ...input, ...options }),
    settings,
  );
const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;
function marks(svg: string, tag: string) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*\\/>`, "g"))].map((match) =>
    Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

describe("waterfall", () => {
  test("preserves ordered signed cumulative arithmetic, including intermediate extrema and negative totals", () => {
    const d = details();
    expect(getWaterfallRows(d).map(({ from, to }) => [from, to])).toEqual([
      [0, -10],
      [-10, 20],
      [20, -30],
      [-30, -5],
      [-5, -5],
      [0, -5],
    ]);
    expect(getWaterfallDomain(d)).toEqual([-32.5, 22.5]);
    expect(getWaterfallChartSummary(d)).toBe(
      "Waterfall: Start: -10; Up: +30 (-10 → 20); Down: -50 (20 → -30); Back: +25 (-30 → -5); Zero: 0 (-5 → -5); Total: -5",
    );
    expect(input.deltas[0]?.label).toBe(" Up ");
    const fractional = details({
      start: 0.1,
      deltas: [
        { label: "A", value: 0.2 },
        { label: "A", value: -0.1 },
      ],
    });
    expect(getWaterfallChartSummary(fractional)).toContain(
      "0.30000000000000004 → 0.20000000000000004",
    );
    expect(deserializeWaterfallChartDetails(JSON.parse(JSON.stringify(fractional)))).toEqual(
      fractional,
    );
  });

  test("TanStack rectangles and descending connectors use every exact running total", () => {
    const d = details();
    const layout = getWaterfallChartLayout(d);
    const svg = renderWaterfallChartSvg(d, theme, layout);
    const [min, max] = getWaterfallDomain(d);
    const x = (value: number) => ((value - min) / (max - min)) * layout.plotWidthPx;
    const rows = getWaterfallRows(d);
    const bars = marks(svg, "rect").filter((mark) => mark["data-ts-key"]?.includes(":bar-"));
    const lines = marks(svg, "line");
    expect(bars).toHaveLength(rows.length);
    rows.forEach((row, i) => {
      const bar = bars.find((mark) => mark["data-ts-key"]?.endsWith(`:bar-${i}`));
      assert(bar);
      expect(Number(bar.x)).toBeCloseTo(x(Math.min(row.from, row.to)), 2);
      expect(Number(bar.width)).toBeCloseTo(Math.abs(x(row.to) - x(row.from)), 2);
      expect(Number(bar.y)).toBeCloseTo(((i + 0.25) * layout.plotHeightPx) / rows.length, 2);
      if (i < rows.length - 1) {
        const connector = lines.find((mark) => mark["data-ts-key"] === `connector-${i}`);
        assert(connector);
        expect(Number(connector.x1)).toBeCloseTo(x(row.to), 2);
        expect(Number(connector.x2)).toBeCloseTo(x(row.to), 2);
        expect(Number(connector.y1)).toBeCloseTo(
          ((i + 0.75) * layout.plotHeightPx) / rows.length,
          2,
        );
        expect(Number(connector.y2)).toBeCloseTo(
          ((i + 1.25) * layout.plotHeightPx) / rows.length,
          2,
        );
      }
    });
    expect(bars.find((bar) => bar["data-ts-key"]?.endsWith(":bar-1"))?.fill).toBe("#579aca");
    expect(bars.find((bar) => bar["data-ts-key"]?.endsWith(":bar-2"))?.fill).toBe("#e69f57");
    expect(svg).toContain("Increase (+)");
    expect(svg).toContain("Decrease (−)");
    expect(lines.find((line) => line["data-ts-key"] === "zero-bar-4")).toBeDefined();
  });

  test("zero-only, constant, subnormal and bounded extreme data produce finite full-size PNGs", async () => {
    for (const start of [0, 7, -7, 1e9, -1e9, Number.MIN_VALUE]) {
      const d = details({ start, deltas: [{ label: "No change", value: 0 }] });
      const svg = renderWaterfallChartSvg(d, theme);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      const [min, max] = getWaterfallDomain(d);
      expect(min).toBeLessThanOrEqual(Math.min(0, start));
      expect(max).toBeGreaterThanOrEqual(Math.max(0, start));
      expect(max).toBeGreaterThan(min);
      expect(marks(svg, "line").some((line) => line["data-ts-key"] === "zero-bar-1")).toBe(true);
      const layout = getWaterfallChartLayout(d);
      expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({
        widthPx: layout.widthPx,
        heightPx: layout.heightPx,
      });
    }
    const max = details({
      start: 0,
      deltas: Array.from({ length: 12 }, (_, i) => ({
        label: "&".repeat(22),
        value: i % 2 ? -1e9 : 1e9,
      })),
      title: "&".repeat(80),
      xLabel: "&".repeat(40),
      yLabel: "&".repeat(40),
    });
    const svg = renderWaterfallChartSvg({ ...max, fontSize: 32 }, theme);
    expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
    expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
  }, 15_000);

  test("rejects malformed execution and replay inputs, including transient cumulative overflow and caller totals", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartWaterfallParameters, parameters)).toBe(true);
    expect(Value.Check(chartWaterfallParameters, input)).toBe(false);
    const invalid = [
      { start: undefined },
      { start: null },
      { start: "1" },
      { start: NaN },
      { start: Infinity },
      { start: -Infinity },
      { start: 1e9 + 1 },
      { start: -1e9 - 1 },
      { deltas: [] },
      { deltas: Array(13).fill({ label: "A", value: 0 }) },
      ...[NaN, Infinity, -Infinity, null, "1", 1e9 + 1, -1e9 - 1].map((value) => ({
        deltas: [{ label: "A", value }],
      })),
      ...["", " ", "a".repeat(23)].map((label) => ({ deltas: [{ label, value: 0 }] })),
      { deltas: [{ label: "A", value: 1, extra: true }] },
      {
        start: 1e9,
        deltas: [
          { label: "Up", value: 1 },
          { label: "Back", value: -1 },
        ],
      },
      { start: -1e9, deltas: [{ label: "Down", value: -1 }] },
      { total: 3 },
      { end: 3 },
      { extra: true },
      { title: " " },
      { title: "a".repeat(81) },
      { xLabel: " " },
      { yLabel: "a".repeat(41) },
    ];
    for (const bad of invalid) {
      await expect(
        createWaterfallChartTool().execute(
          "bad",
          { ...parameters, ...bad } as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
      expect(deserializeWaterfallChartDetails({ ...details(), ...bad })).toBeUndefined();
    }
    for (const bad of [
      { imageWidthCells: Infinity },
      { imageWidthCells: 0 },
      { fontFamily: undefined },
      { fontSize: 33 },
      { type: "bar" },
    ])
      expect(deserializeWaterfallChartDetails({ ...details(), ...bad })).toBeUndefined();
  });

  test("escapes labels and annotations while retaining Danish letters and exact summary", () => {
    const d = {
      ...details({
        title: '<script>"&',
        xLabel: "ø<&",
        yLabel: "å<&",
        deltas: [{ label: " æ<& ", value: 1 }],
      }),
      fontFamily: 'Font "<&',
    };
    const svg = renderWaterfallChartSvg(d, theme);
    expect(svg).not.toContain("<script>");
    for (const text of [
      "æ&lt;&amp;",
      "ø&lt;&amp;",
      "å&lt;&amp;",
      "&lt;script&gt;&quot;&amp;",
      'font-family="Font &quot;&lt;&amp;"',
    ])
      expect(svg).toContain(text);
    expect(getWaterfallChartSummary(d)).toContain("æ<&: +1 (-10 → -9)");
  });

  test("executes in TUI/print, replays by discriminator, preserves cached result identity, and fails visibly on malformed replay", async () => {
    const tool = createWaterfallChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateWaterfallChartInput(input));
    const printed = await tool.execute("print", parameters, undefined, undefined, context("print"));
    const image = printed.content.find((part) => part.type === "image");
    assert(image?.type === "image");
    expect(getPngDimensions(image.data)).toBeDefined();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      tool.execute("abort", parameters, aborted.signal, undefined, context("tui")),
    ).rejects.toThrow();
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
      { content: [], details: { ...tui.details, total: 1 } } as never,
      { expanded: false, isPartial: false },
      theme,
      ctx as never,
    );
    expect(invalid.render(80)).toEqual([]);
    await ready;
    expect(invalid.render(80)).toEqual(["Waterfall unavailable"]);
  }, 15_000);
});
