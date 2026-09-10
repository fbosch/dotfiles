import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { createBoxplotChartTool, createPieChartTool } from "../metadata";
import { type BoxplotChartInput, chartBoxplotParameters } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  boxplotChartRenderer,
  deserializeBoxplotChartDetails,
  getBoxplotChartLayout,
  getBoxplotDomain,
  getBoxplotStatistics,
  renderBoxplotChartSvg,
  validateBoxplotChartInput,
} from "../types/boxplot";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };
const input: BoxplotChartInput = {
  type: "boxplot",
  groups: [
    { label: " A ", values: [100, 3, 2, 1, 0, 4] },
    { label: "B", values: [-3] },
  ],
};
const details = (options: Partial<BoxplotChartInput> = {}) =>
  boxplotChartRenderer.createDetails(validateBoxplotChartInput({ ...input, ...options }), settings);
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

describe("boxplot", () => {
  test("computes type-7 quartiles without mutating unsorted samples", () => {
    for (const [values, expected] of [
      [
        [5, 1, 3, 2, 4],
        [2, 3, 4],
      ],
      [
        [4, 2, 1, 3],
        [1.75, 2.5, 3.25],
      ],
      [[-2], [-2, -2, -2]],
      [
        [8, 0],
        [2, 4, 6],
      ],
      [
        [7, 7, 7, 7],
        [7, 7, 7],
      ],
      [
        [-1, -4, -3, -2],
        [-3.25, -2.5, -1.75],
      ],
    ] as const) {
      const before = [...values];
      const s = getBoxplotStatistics(values);
      expect([s.q1, s.median, s.q3]).toEqual([...expected]);
      expect(s.lowerWhisker).toBe(Math.min(...values));
      expect(s.upperWhisker).toBe(Math.max(...values));
      expect(s.outliers).toEqual([]);
      expect([...values]).toEqual(before);
    }
  });

  test("uses actual inlier samples and inclusive fences, preserving duplicate outliers", () => {
    expect(getBoxplotStatistics([100, 3, 2, 1, 0, 4])).toEqual({
      min: 0,
      q1: 1.25,
      median: 2.5,
      q3: 3.75,
      max: 100,
      lowerWhisker: 0,
      upperWhisker: 4,
      outliers: [100],
    });
    expect(getBoxplotStatistics([-3, 0, 0, 1, 2, 2, 5]).outliers).toEqual([]);
    expect(getBoxplotStatistics([-3.01, 0, 0, 1, 2, 2, 5.01]).outliers).toEqual([-3.01, 5.01]);
    expect(getBoxplotStatistics([0, 0, 0, 0, 0, 0, 9, 9]).outliers).toEqual([9, 9]);
  });

  test("rejects malformed public inputs and enforces sample, group, label and text limits", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartBoxplotParameters, parameters)).toBe(true);
    expect(Value.Check(chartBoxplotParameters, input)).toBe(false);
    expect(details()).toMatchObject({
      showOutliers: true,
      groups: [
        { label: "A", values: input.groups[0]?.values },
        { label: "B", values: [-3] },
      ],
    });
    const invalid: unknown[] = [
      { groups: [] },
      { groups: Array.from({ length: 13 }, (_, i) => ({ label: `${i}`, values: [1] })) },
      ...[
        [],
        Array(201).fill(0),
        [NaN],
        [Infinity],
        [-Infinity],
        [1e9 + 1],
        [-1e9 - 1],
        [null],
        ["1"],
      ].map((values) => ({ groups: [{ label: "A", values }] })),
      ...["", " ", "x".repeat(23)].map((label) => ({ groups: [{ label, values: [1] }] })),
      {
        groups: [
          { label: "A", values: [1] },
          { label: " A ", values: [2] },
        ],
      },
      { ...parameters, showOutliers: 1 },
      { ...parameters, title: " " },
      { ...parameters, title: "x".repeat(81) },
      { ...parameters, xLabel: " " },
      { ...parameters, yLabel: "x".repeat(41) },
      { ...parameters, extra: true },
      { groups: [{ label: "A", values: [1], extra: true }] },
    ];
    for (const candidate of invalid)
      await expect(
        createBoxplotChartTool().execute(
          "bad",
          candidate as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
    expect(
      details({
        groups: Array.from({ length: 12 }, (_, i) => ({
          label: `${i}`,
          values: Array(200).fill(i % 2 ? -1e9 : 1e9),
        })),
      }).groups,
    ).toHaveLength(12);
  });

  test("TanStack emits correct box, median, whisker, cap and outlier coordinates with a stable hidden-outlier domain", () => {
    const d = details();
    const layout = getBoxplotChartLayout(d);
    const svg = renderBoxplotChartSvg(d, theme, layout);
    const boxes = marks(svg, "rect");
    const lines = marks(svg, "line");
    const dots = marks(svg, "circle");
    expect(boxes).toHaveLength(2);
    expect(lines).toHaveLength(10);
    expect(dots).toHaveLength(1);
    const [min, max] = getBoxplotDomain(d);
    const x = (value: number) => ((value - min) / (max - min)) * layout.plotWidthPx;
    expect(Number(boxes[0]?.x)).toBeCloseTo(x(1.25), 2);
    expect(Number(boxes[0]?.width)).toBeCloseTo(x(3.75) - x(1.25), 2);
    expect(Number(dots[0]?.cx)).toBeCloseTo(x(100), 2);
    expect(Number(lines.find((line) => line["data-ts-key"] === "median-0")?.x1)).toBeCloseTo(
      x(2.5),
      2,
    );
    expect(Number(lines.find((line) => line["data-ts-key"] === "whisker-upper-0")?.x2)).toBeCloseTo(
      x(4),
      2,
    );
    expect(Number(boxes[1]?.y)).toBeGreaterThan(Number(boxes[0]?.y));
    const hidden = details({ showOutliers: false });
    expect(getBoxplotDomain(hidden)).toEqual(getBoxplotDomain(d));
    const hiddenSvg = renderBoxplotChartSvg(hidden, theme);
    expect(marks(hiddenSvg, "circle")).toHaveLength(0);
    expect(marks(hiddenSvg, "rect")).toEqual(boxes);
    expect(marks(hiddenSvg, "line")).toEqual(lines);
  });

  test("handles constant, singleton, two-point, subnormal and extreme ranges as finite SVG", async () => {
    for (const values of [
      [0],
      [1e9],
      [-1e9],
      [7, 7],
      [0, 8],
      [-1e9, 1e9],
      [-Number.MIN_VALUE, 0, Number.MIN_VALUE],
    ]) {
      const d = details({ groups: [{ label: "A", values }] });
      const svg = renderBoxplotChartSvg(d, theme);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(marks(svg, "line")).toHaveLength(5);
      expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    }
  }, 15_000);

  test("fits the maximum distinct-outlier payload inside the shared worker budget", async () => {
    const d = details({
      groups: Array.from({ length: 12 }, (_, i) => ({
        label: `${i}${"&".repeat(20)}`,
        values: [
          ...Array(102).fill(0),
          ...Array.from({ length: 49 }, (_, j) => -1e9 + j),
          ...Array.from({ length: 49 }, (_, j) => 1e9 - j),
        ],
      })),
      title: "&".repeat(80),
    });
    const svg = renderBoxplotChartSvg(d, theme);
    expect(marks(svg, "circle")).toHaveLength(1176);
    expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
    expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
  }, 15_000);

  test("escapes titles, axes, labels and font names, and validates persisted details", () => {
    const d = {
      ...details({
        groups: [{ label: "æ<&", values: [0, 1] }],
        title: '<script>"&',
        xLabel: "ø<&",
        yLabel: "å<&",
      }),
      fontFamily: 'Font "<&',
    };
    const svg = renderBoxplotChartSvg(d, theme);
    expect(svg).not.toContain("<script>");
    for (const value of [
      "æ&lt;&amp;",
      "ø&lt;&amp;",
      "å&lt;&amp;",
      "&lt;script&gt;&quot;&amp;",
      'font-family="Font &quot;&lt;&amp;"',
    ])
      expect(svg).toContain(value);
    expect(deserializeBoxplotChartDetails(JSON.parse(JSON.stringify(d)))).toEqual(d);
    for (const bad of [
      { ...d, groups: [] },
      { ...d, groups: [{ label: "A", values: [NaN] }] },
      { ...d, showOutliers: undefined },
      { ...d, imageWidthCells: Infinity },
      { ...d, imageWidthCells: 0 },
      { ...d, fontSize: 33 },
      { ...d, extra: true },
    ])
      expect(deserializeBoxplotChartDetails(bad)).toBeUndefined();
    for (const fontSize of [8, 14, 32]) {
      const layout = getBoxplotChartLayout({ ...d, fontSize }, { widthPx: 16, heightPx: 38 });
      expect(layout.plotHeightPx).toBeGreaterThanOrEqual(layout.fontSizePx * 1.6);
    }
  });
  test("returns exact text/details in TUI and PNG in print, replays by discriminator, and reuses the result slot", async () => {
    const tool = createBoxplotChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateBoxplotChartInput(input));
    const printed = await tool.execute("print", parameters, undefined, undefined, context("print"));
    const image = printed.content.find((part) => part.type === "image");
    assert(image?.type === "image");
    expect(getPngDimensions(image.data)).toBeDefined();
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      tool.execute("aborted", parameters, aborted.signal, undefined, context("tui")),
    ).rejects.toThrow();
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 9, heightPx: 18 });
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
  }, 15_000);
});
