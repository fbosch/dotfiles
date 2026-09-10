import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { createDumbbellChartTool, createPieChartTool } from "../metadata";
import { chartDumbbellParameters, type DumbbellChartInput } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  deserializeDumbbellChartDetails,
  dumbbellChartRenderer,
  getDumbbellChartLayout,
  getDumbbellChartSummary,
  getDumbbellDomain,
  renderDumbbellChartSvg,
  validateDumbbellChartInput,
} from "../types/dumbbell";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const input: DumbbellChartInput = {
  type: "dumbbell",
  data: [
    { label: " Up ", before: -10, after: 20 },
    { label: "Down", before: 5, after: -5 },
    { label: "Equal", before: 0, after: 0 },
  ],
};
const details = (options: Partial<DumbbellChartInput> = {}) =>
  dumbbellChartRenderer.createDetails(validateDumbbellChartInput({ ...input, ...options }), {
    imageWidthCells: 60,
    fontFamily: "sans-serif",
  });
function marks(svg: string, tag: string) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*\\/>`, "g"))].map((match) =>
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

describe("dumbbell", () => {
  test("normalizes independent rows, defaults and exact signed differences without mutating input", () => {
    const d = details();
    expect(d).toMatchObject({ beforeLabel: "Before", afterLabel: "After", showDifferences: false });
    expect(getDumbbellChartSummary(d)).toBe(
      "Dumbbell: Up: Before=-10, After=20, difference=+30; Down: Before=5, After=-5, difference=-10; Equal: Before=0, After=0, difference=0",
    );
    expect(input.data[0]?.label).toBe(" Up ");
    expect(getDumbbellDomain(d)).toEqual([-11.5, 21.5]);
    expect(deserializeDumbbellChartDetails(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(
      getDumbbellChartSummary(details({ data: [{ label: "A", before: -1e9, after: 1e9 }] })),
    ).toContain("difference=+2000000000");
  });

  test("TanStack dots align exactly with one horizontal connector per independent row", () => {
    for (const showDifferences of [false, true]) {
      const d = details({ showDifferences });
      const layout = getDumbbellChartLayout(d);
      const svg = renderDumbbellChartSvg(d, theme, layout);
      const dots = marks(svg, "circle").filter((mark) => mark["data-ts-key"]);
      const lines = marks(svg, "line");
      expect(dots).toHaveLength(6);
      expect(lines).toHaveLength(3);
      lines.forEach((line, index) => {
        const before = dots.find((mark) => mark["data-ts-key"]?.endsWith(`:before-${index}`));
        const after = dots.find((mark) => mark["data-ts-key"]?.endsWith(`:after-${index}`));
        assert(before && after);
        expect(Number(before.cx)).toBeCloseTo(Number(line.x1), 2);
        expect(Number(after.cx)).toBeCloseTo(Number(line.x2), 2);
        expect(Number(before.cy)).toBeCloseTo(Number(line.y1), 2);
        expect(Number(after.cy)).toBeCloseTo(Number(line.y2), 2);
        expect(line.y1).toBe(line.y2);
        expect(Number(before.r)).toBeGreaterThan(Number(after.r));
        expect(before.fill).toBe("none");
        expect(Number(line.y1)).toBeCloseTo(
          ((index + (showDifferences ? 0.3 : 0.5)) * layout.plotHeightPx) / 3,
          2,
        );
      });
      expect(svg.includes("Δ +30")).toBe(showDifferences);
      expect(svg.includes("Δ -10")).toBe(showDifferences);
      expect(svg.includes("Δ 0")).toBe(showDifferences);
    }
  });

  test("rejects invalid execution and persisted values and unknown fields", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartDumbbellParameters, parameters)).toBe(true);
    expect(Value.Check(chartDumbbellParameters, input)).toBe(false);
    const invalid = [
      { data: [] },
      { data: Array.from({ length: 13 }, (_, i) => ({ label: `${i}`, before: 0, after: 0 })) },
      {
        data: [
          { label: "A", before: 0, after: 1 },
          { label: " A ", before: 2, after: 3 },
        ],
      },
      ...[NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, null, "1", undefined].flatMap((value) => [
        { data: [{ label: "A", before: value, after: 0 }] },
        { data: [{ label: "A", before: 0, after: value }] },
      ]),
      ...["", " ", "a".repeat(23)].map((label) => ({ data: [{ label, before: 0, after: 1 }] })),
      { data: [{ label: "A", before: 0, after: 1, extra: true }] },
      { beforeLabel: " " },
      { afterLabel: "a".repeat(23) },
      { showDifferences: "true" },
      { title: " " },
      { title: "a".repeat(81) },
      { xLabel: " " },
      { yLabel: "a".repeat(41) },
      { extra: true },
      { type: "dumbbell" },
    ];
    for (const bad of invalid) {
      await expect(
        createDumbbellChartTool().execute(
          "bad",
          { ...parameters, ...bad } as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
      if (!("type" in bad))
        expect(deserializeDumbbellChartDetails({ ...details(), ...bad })).toBeUndefined();
    }
    for (const bad of [
      { type: "bar" },
      { imageWidthCells: Infinity },
      { imageWidthCells: 0 },
      { fontFamily: undefined },
      { fontSize: 33 },
      { beforeLabel: undefined },
      { showDifferences: undefined },
    ]) {
      expect(deserializeDumbbellChartDetails({ ...details(), ...bad })).toBeUndefined();
    }
  });

  test("constant, subnormal, negative-only and extreme domains produce finite full-resolution PNGs", async () => {
    for (const value of [0, 7, -7, 1e9, -1e9, Number.MIN_VALUE]) {
      const d = details({ data: [{ label: "A", before: value, after: value }] });
      const [min, max] = getDumbbellDomain(d);
      expect(min).toBeLessThan(value);
      expect(max).toBeGreaterThan(value);
      const svg = renderDumbbellChartSvg(d, theme);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      const layout = getDumbbellChartLayout(d);
      expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({
        widthPx: layout.widthPx,
        heightPx: layout.heightPx,
      });
    }
    const d = {
      ...details({
        data: Array.from({ length: 12 }, (_, i) => ({
          label: `${i}${"&".repeat(20)}`,
          before: -1e9,
          after: 1e9,
        })),
        title: "&".repeat(80),
        xLabel: "&".repeat(40),
        yLabel: "&".repeat(40),
        showDifferences: true,
      }),
      fontSize: 32,
    };
    for (const width of [8, 20, 60]) {
      const svg = renderDumbbellChartSvg(d, theme, getDumbbellChartLayout(d, undefined, width));
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
      expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    }
  }, 15_000);

  test("escapes annotations, preserves Danish letters and resolves customized series names", () => {
    const d = details({
      data: [{ label: " æ<& ", before: 0.1, after: 0.3 }],
      beforeLabel: " Før ",
      afterLabel: " Efter ",
      title: '<script>"&',
      xLabel: "ø<&",
      yLabel: "å<&",
      showDifferences: true,
    });
    const svg = renderDumbbellChartSvg({ ...d, fontFamily: 'Font "<&' }, theme);
    expect(svg).not.toContain("<script>");
    for (const text of [
      "æ&lt;&amp;",
      "ø&lt;&amp;",
      "å&lt;&amp;",
      "&lt;script&gt;&quot;&amp;",
      "Før",
      "Efter",
      "Font &quot;&lt;&amp;",
    ])
      expect(svg).toContain(text);
    expect(getDumbbellChartSummary(d)).toContain("difference=+0.19999999999999998");
  });

  test("executes through the shared worker in print mode, defers TUI rasterization and honors cancellation", async () => {
    const tool = createDumbbellChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateDumbbellChartInput(input));
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

  test("replays by discriminator, retains the cached component and shows malformed replay failures", async () => {
    const { type: _type, ...parameters } = input;
    const tui = await createDumbbellChartTool().execute(
      "replay",
      parameters,
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
    expect(invalid.render(80)).toEqual(["Dumbbell chart unavailable"]);
  }, 15_000);
});
