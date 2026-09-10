import { describe, expect, test } from "bun:test";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { LazyChartComponent } from "../lazy";
import { createBezierChartTool, createPieChartTool } from "../metadata";
import { type BezierChartInput, chartBezierParameters } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  bezierChartRenderer,
  deserializeBezierChartDetails,
  getBezierChartGeometry,
  getBezierChartLayout,
  renderBezierChartSvg,
  validateBezierChartInput,
} from "../types/bezier";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const settings = { imageWidthCells: 80, fontFamily: "sans-serif", fontSize: 14 };
const input = {
  start: { x: -2, y: 0 },
  control1: { x: 4, y: 8 },
  control2: { x: -4, y: 8 },
  end: { x: 2, y: 0 },
};
const parse = (value = input) => validateBezierChartInput({ type: "bezier", ...value });
const details = bezierChartRenderer.createDetails(parse(), settings);
const context = (mode: "tui" | "print" | "json" | "rpc") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;

function path(svg: string): string {
  const match = /<path data-ts-key="bezier"[^>]* d="([^"]+)"/.exec(svg);
  if (!match?.[1]) throw new Error("missing cubic path");
  return match[1];
}

describe("bezier", () => {
  test("accepts four bounded points without a discriminator and rejects malformed arguments", async () => {
    expect(Value.Check(chartBezierParameters, input)).toBe(true);
    expect(parse().showControls).toBe(false);
    const invalid: unknown[] = [
      {},
      { ...input, start: undefined },
      { ...input, control2: null },
      { ...input, end: { x: 0 } },
      { ...input, start: { x: 0, y: 0, label: "A" } },
      { ...input, type: "bezier" },
      { ...input, data: [] },
      ...[null, "true", 1].map((showControls) => ({ ...input, showControls })),
      ...[NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, "1", null].flatMap((coordinate) =>
        (["start", "control1", "control2", "end"] as const).flatMap((name) =>
          (["x", "y"] as const).map((axis) => ({
            ...input,
            [name]: { ...input[name], [axis]: coordinate },
          })),
        ),
      ),
      { ...input, title: "x".repeat(81) },
      { ...input, xLabel: "x".repeat(41) },
    ];
    const tool = createBezierChartTool();
    for (const value of invalid) {
      expect(Value.Check(chartBezierParameters, value)).toBe(false);
      await expect(
        tool.execute("bad", value as never, undefined, undefined, context("tui")),
      ).rejects.toThrow();
    }
    for (const label of ["title", "xLabel", "yLabel"] as const) {
      expect(() => validateBezierChartInput({ type: "bezier", ...input, [label]: "   " })).toThrow(
        "blank",
      );
    }
    const normalized = validateBezierChartInput({
      type: "bezier",
      ...input,
      title: " æøå ",
      showControls: true,
    });
    expect(normalized.title).toBe("æøå");
    expect(normalized.showControls).toBe(true);
    expect(normalized.start).not.toBe(input.start);
  });

  test("emits one exact SVG cubic using the supplied controls, without sampled interpolation", () => {
    const layout = getBezierChartLayout(undefined, 80);
    const { project } = getBezierChartGeometry(details, layout);
    const [a, b, c, d] = [input.start, input.control1, input.control2, input.end].map(project);
    const svg = renderBezierChartSvg(details, theme, layout);
    expect(path(svg)).toBe(`M ${a?.x} ${a?.y} C ${b?.x} ${b?.y}, ${c?.x} ${c?.y}, ${d?.x} ${d?.y}`);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).not.toContain("control-guide-");
    const guided = renderBezierChartSvg({ ...details, showControls: true }, theme, layout);
    expect(path(guided)).toBe(path(svg));
    expect(guided.match(/data-ts-key="control-guide-/g)).toHaveLength(2);
    expect(guided).toContain('stroke-opacity="0.35"');
    expect(guided).not.toContain("stroke-dasharray");
    expect(guided.match(/data-ts-key="control-\d"/g)).toHaveLength(2);
    expect(svg.match(/<circle /g)).toHaveLength(2);
  });

  test("defaults to a compact square without axes or visible labels", () => {
    for (const cells of [
      { widthPx: 9, heightPx: 18 },
      { widthPx: 16, heightPx: 38 },
    ]) {
      for (const width of [12, 28, 60, 80]) {
        const layout = getBezierChartLayout(cells, width);
        expect(layout.widthPx).toBe(layout.heightPx);
        expect(layout.plotWidthPx).toBe(layout.plotHeightPx);
        expect(layout.widthPx).toBeLessThanOrEqual(width * cells.widthPx);
        expect(layout.heightCells).toBeLessThanOrEqual(11);
        expect(layout.plotX).toBeLessThanOrEqual(cells.widthPx);
        expect(layout.plotY).toBe(layout.plotX);
        const svg = renderBezierChartSvg(details, theme, layout);
        expect(svg).not.toMatch(/<text|<title|<line /);
        expect(svg).toContain("<desc>Bezier chart:");
        expect(svg).toContain('class="ts-chart__dot"');
        const cubic = path(svg)
          .match(/-?\d+(?:\.\d+)?/g)
          ?.map(Number);
        const endpoints = [...svg.matchAll(/<circle [^>]*cx="([^"]+)" cy="([^"]+)"/g)];
        expect(endpoints).toHaveLength(2);
        // TanStack formats dot coordinates to two decimals; the cubic retains full precision.
        for (const [index, offset] of [0, 6].entries()) {
          expect(
            Math.abs(Number(endpoints[index]?.[1]) - (cubic?.[offset] ?? NaN)),
          ).toBeLessThanOrEqual(0.005001);
          expect(
            Math.abs(Number(endpoints[index]?.[2]) - (cubic?.[offset + 1] ?? NaN)),
          ).toBeLessThanOrEqual(0.005001);
        }
      }
    }
  });

  test("reserves space only for supplied labels and title while keeping the plot square", () => {
    const plain = getBezierChartLayout();
    for (const [title, xLabel, yLabel] of [
      [true, false, false],
      [false, true, false],
      [false, false, true],
      [true, true, true],
    ] as const) {
      const layout = getBezierChartLayout(undefined, 60, title, xLabel, yLabel);
      expect(layout.plotWidthPx).toBe(layout.plotHeightPx);
      expect(layout.plotX > plain.plotX).toBe(yLabel);
      expect(layout.plotY > plain.plotY).toBe(title);
      const svg = renderBezierChartSvg(
        {
          ...details,
          ...(title ? { title: "Curve" } : {}),
          ...(xLabel ? { xLabel: "Time" } : {}),
          ...(yLabel ? { yLabel: "Progress" } : {}),
        },
        theme,
        layout,
      );
      expect(svg.match(/<text /g) ?? []).toHaveLength(
        Number(title) + Number(xLabel) + Number(yLabel),
      );
    }
  });

  test("uses equal pixel scales and keeps the whole control polygon in view across layouts", () => {
    for (const cells of [
      { widthPx: 9, heightPx: 18 },
      { widthPx: 16, heightPx: 38 },
    ]) {
      for (const width of [28, 60, 80]) {
        const layout = getBezierChartLayout(cells, width, true, true, true, 14);
        const { project } = getBezierChartGeometry(details, layout);
        const origin = project({ x: 0, y: 0 });
        expect(project({ x: 1, y: 0 }).x - origin.x).toBeCloseTo(
          origin.y - project({ x: 0, y: 1 }).y,
          10,
        );
        for (const point of Object.values(input)) {
          const projected = project(point);
          expect(projected.x).toBeGreaterThanOrEqual(layout.plotX);
          expect(projected.x).toBeLessThanOrEqual(layout.plotX + layout.plotWidthPx);
          expect(projected.y).toBeGreaterThanOrEqual(layout.plotY);
          expect(projected.y).toBeLessThanOrEqual(layout.plotY + layout.plotHeightPx);
        }
        expect(layout.heightCells).toBeLessThanOrEqual(18);
      }
    }
  });

  test("renders coincident, straight, vertical, horizontal, closed and extreme cubics safely", () => {
    const cases = [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [-1e9, -1e9, -1e9, -1e9],
      [0, 1, 2, 3],
      [-1e9, 1e9, -1e9, 1e9],
      [0, Number.MIN_VALUE, 0, Number.MIN_VALUE],
      [1, 1 + Number.EPSILON, 1, 1 + Number.EPSILON],
    ];
    for (const values of cases) {
      for (const mode of ["diagonal", "vertical", "horizontal"] as const) {
        const points = values.map((value) => ({
          x: mode === "vertical" ? 0 : value,
          y: mode === "horizontal" ? 0 : value,
        }));
        const [start, control1, control2, end] = points;
        const data = validateBezierChartInput({
          type: "bezier",
          start,
          control1,
          control2,
          end,
        } as BezierChartInput);
        const saved = bezierChartRenderer.createDetails(data, settings);
        expect(renderBezierChartSvg(saved, theme)).not.toMatch(/NaN|Infinity/);
        expect(deserializeBezierChartDetails(saved)).toEqual(saved);
      }
    }
    const closed = { ...details, end: details.start };
    expect(renderBezierChartSvg(closed, theme)).not.toMatch(/NaN|Infinity/);
  });

  test("round-trips replay including configured widths above 60 and rejects corrupt details", () => {
    expect(deserializeBezierChartDetails(JSON.parse(JSON.stringify(details)))).toEqual(details);
    for (const value of [
      null,
      {},
      { ...details, type: "line" },
      { ...details, showControls: undefined },
      { ...details, start: { x: NaN, y: 0 } },
      { ...details, imageWidthCells: Infinity },
      { ...details, imageWidthCells: 0 },
      { ...details, fontSize: Infinity },
      { ...details, fontFamily: " " },
      { ...details, extra: true },
    ]) {
      expect(deserializeBezierChartDetails(value)).toBeUndefined();
    }
  });

  test("escapes labels and rasterizes at full resolution", async () => {
    const labeled = { ...details, title: "æøå <&>", xLabel: "X <value>", yLabel: "Y & value" };
    const layout = getBezierChartLayout({ widthPx: 16, heightPx: 38 }, 80, true, true, true, 14);
    const svg = renderBezierChartSvg(labeled, theme, layout);
    expect(svg).toContain("æøå &lt;&amp;&gt;");
    expect(svg).toContain("X &lt;value&gt;");
    expect(svg).toContain("Y &amp; value");
    expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({
      widthPx: layout.widthPx,
      heightPx: layout.heightPx,
    });
  });

  test("returns text in TUI, PNG outside TUI, reuses result slots and honors cancellation", async () => {
    const tool = createBezierChartTool();
    const result = await tool.execute("curve", input, undefined, undefined, context("tui"));
    expect(result.content).toHaveLength(1);
    expect(result.details).toMatchObject({ type: "bezier", ...input, showControls: false });
    for (const mode of ["print", "rpc", "json"] as const) {
      const output = await tool.execute("curve", input, undefined, undefined, context(mode));
      expect(
        output.content.some(
          (part) => part.type === "image" && getPngDimensions(part.data) !== null,
        ),
      ).toBe(true);
    }
    const options = { expanded: false, isPartial: false };
    const component = tool.renderResult?.(result, options, theme, { invalidate() {} } as never);
    expect(component).toBeInstanceOf(LazyChartComponent);
    expect(
      tool.renderResult?.(result, options, theme, {
        lastComponent: component,
        invalidate() {},
      } as never),
    ).toBe(component);
    const controller = new AbortController();
    controller.abort();
    await expect(
      tool.execute("cancel", input, controller.signal, undefined, context("print")),
    ).rejects.toThrow();
  });
});

test("replays saved bezier details by discriminator and retains the completed image", async () => {
  setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  setCellDimensions({ widthPx: 9, heightPx: 18 });
  const ready = Promise.withResolvers<string[]>();
  const component = createPieChartTool().renderResult?.(
    { content: [], details: JSON.parse(JSON.stringify(details)) },
    { expanded: false, isPartial: false },
    theme,
    {
      invalidate() {
        const lines = component?.render(84) ?? [];
        if (lines.length) ready.resolve(lines);
      },
    } as never,
  );
  expect(component?.render(84)).toEqual([]);
  const lines = await ready.promise;
  expect(lines.join("\n")).toContain("\u001b_G");
  component?.invalidate();
  expect(component?.render(84)).toEqual(lines);
});

test("malformed bezier replay falls back without throwing or rasterizing", async () => {
  const ready = Promise.withResolvers<void>();
  const component = new LazyChartComponent({
    type: "bezier",
    details: { ...details, start: null },
    theme,
    requestRender: ready.resolve,
  });
  expect(component.render(80)).toEqual([]);
  await ready.promise;
  expect(component.render(80)).toEqual(["Bezier chart unavailable"]);
});
