import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import type { SceneNode, SceneRect } from "@tanstack/charts";
import { Value } from "typebox/value";
import { createPieChartTool, createTreemapChartTool } from "../metadata";
import {
  chartTreemapParameters,
  hasBoundedTreemapHierarchy,
  type TreemapChartInput,
} from "../schemas";
import { rasterizeSvg } from "../types";
import {
  createTreemapScene,
  deserializeTreemapChartDetails,
  getTreemapChartLayout,
  getTreemapChartSummary,
  getTreemapHierarchy,
  renderTreemapChartSvg,
  treemapChartRenderer,
  validateTreemapChartInput,
} from "../types/treemap";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const input: TreemapChartInput = {
  type: "treemap",
  data: [
    {
      label: " src ",
      children: [
        {
          label: "core",
          children: [
            { label: "a.ts", value: 1 },
            { label: "b.ts", value: 3 },
          ],
        },
        { label: "empty", value: 0 },
      ],
    },
    { label: "vendor", children: [{ label: "a.ts", value: 4 }] },
  ],
  unit: " kB ",
};
const details = (options: Partial<TreemapChartInput> = {}) =>
  treemapChartRenderer.createDetails(validateTreemapChartInput({ ...input, ...options }), {
    imageWidthCells: 60,
    fontFamily: "sans-serif",
  });
const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;
function rectangles(nodes: readonly SceneNode[]): SceneRect[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? rectangles(node.children) : node.kind === "rect" ? [node] : [],
  );
}

describe("treemap", () => {
  test("aggregates nested children without double counting, retaining exact paths and independent data", () => {
    const d = details();
    const { rows, total } = getTreemapHierarchy(d);
    expect(total).toBe(8);
    expect(rows.map((row) => row.total)).toEqual([8, 4, 4, 1, 3, 0, 4, 4]);
    expect(rows.filter((row) => row.contribution > 0).map((row) => row.contribution)).toEqual([
      1, 3, 4,
    ]);
    expect(d.data[0]?.label).toBe("src");
    expect(input.data[0]?.label).toBe(" src ");
    expect(d.data).not.toBe(input.data);
    expect(getTreemapChartSummary(d)).toContain('["src","empty"]=0 kB');
    expect(getTreemapChartSummary(d)).toContain('["src","core","b.ts"]=3 kB');
    expect(deserializeTreemapChartDetails(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  test("actual TanStack squarification preserves areas, hierarchy containment, nonoverlap and group colors", () => {
    for (const width of [8, 20, 60]) {
      const d = details();
      const layout = getTreemapChartLayout(d, undefined, width);
      const scene = createTreemapScene(d, layout);
      const tiles = rectangles(scene.nodes);
      expect(tiles).toHaveLength(3);
      expect(scene.points.map((point) => point.datum.ancestorIds)).toEqual([
        ["root", "0", "0.0"],
        ["root", "0", "0.0"],
        ["root", "1"],
      ]);
      for (const [index, tile] of tiles.entries()) {
        const expectedArea =
          layout.widthPx * layout.plotHeightPx * ([1 / 8, 3 / 8, 4 / 8][index] ?? -1);
        expect(Math.abs(tile.width * tile.height - expectedArea)).toBeLessThanOrEqual(
          layout.widthPx + layout.plotHeightPx,
        );
        expect(tile.x).toBeGreaterThanOrEqual(0);
        expect(tile.y).toBeGreaterThanOrEqual(0);
        expect(tile.x + tile.width).toBeLessThanOrEqual(layout.widthPx + 1e-9);
        expect(tile.y + tile.height).toBeLessThanOrEqual(layout.plotHeightPx + 1e-9);
        for (const other of tiles.slice(index + 1)) {
          const overlapX =
            Math.min(tile.x + tile.width, other.x + other.width) - Math.max(tile.x, other.x);
          const overlapY =
            Math.min(tile.y + tile.height, other.y + other.height) - Math.max(tile.y, other.y);
          expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1e-9);
        }
      }
      expect(tiles[0]?.style?.fill).toBe(tiles[1]?.style?.fill);
      expect(tiles[0]?.style?.fill).not.toBe(tiles[2]?.style?.fill);
      // Descendant rectangles tile their parent bounding rectangle, not disconnected regions.
      const first = tiles[0];
      const second = tiles[1];
      assert(first && second);
      const boundingArea =
        (Math.max(first.x + first.width, second.x + second.width) - Math.min(first.x, second.x)) *
        (Math.max(first.y + first.height, second.y + second.height) - Math.min(first.y, second.y));
      expect(
        Math.abs(boundingArea - (layout.widthPx * layout.plotHeightPx) / 2),
      ).toBeLessThanOrEqual(layout.widthPx + layout.plotHeightPx);
      expect(renderTreemapChartSvg(d, theme, layout)).toBe(renderTreemapChartSvg(d, theme, layout));
    }
  });

  test("keeps rounded coordinates inside a fractional height cap", () => {
    const d = details({
      data: [
        {
          label: "a",
          children: [
            { label: "x", value: 1 },
            { label: "y", value: 1 },
          ],
        },
        { label: "b", value: 1 },
      ],
      maxHeightCells: 8,
    });
    const layout = getTreemapChartLayout(d, { widthPx: 16, heightPx: 4 }, 4);

    expect(Number.isInteger(layout.plotHeightPx)).toBe(true);
    expect(() => createTreemapScene(d, layout)).not.toThrow();
  });

  test("rejects invalid hierarchy at execution and replay boundaries, including hostile depth and cycles", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartTreemapParameters, parameters)).toBe(true);
    expect(Value.Check(chartTreemapParameters, input)).toBe(false);
    let deep: unknown = { label: "leaf", value: 1 };
    for (let index = 0; index < 1000; index++) deep = { label: "parent", children: [deep] };
    const cycle: { label: string; children: unknown[] } = { label: "cycle", children: [] };
    cycle.children.push(cycle);
    const badInputs = [
      { data: [] },
      { data: null },
      { data: [null] },
      { data: [deep] },
      { data: [cycle] },
      { data: Array.from({ length: 7 }, (_, i) => ({ label: String(i), value: 1 })) },
      {
        data: [
          {
            label: "parent",
            children: Array.from({ length: 64 }, (_, i) => ({ label: String(i), value: 1 })),
          },
        ],
      },
      { data: [{ label: "parent", children: [] }] },
      { data: [{ label: "missing" }] },
      { data: [{ label: "both", value: 1, children: [{ label: "child", value: 2 }] }] },
      {
        data: [
          { label: "same", value: 1 },
          { label: " same ", value: 2 },
        ],
      },
      {
        data: [
          {
            label: "parent",
            children: [
              { label: "same", value: 1 },
              { label: " same ", value: 2 },
            ],
          },
        ],
      },
      ...[NaN, Infinity, -Infinity, -1, null, "1", undefined].map((value) => ({
        data: [{ label: "leaf", value }],
      })),
      {
        data: [
          { label: "a", value: Number.MAX_VALUE },
          { label: "b", value: Number.MAX_VALUE },
        ],
      },
      {
        data: [
          {
            label: "parent",
            children: [
              { label: "a", value: Number.MAX_VALUE },
              { label: "b", value: Number.MAX_VALUE },
            ],
          },
        ],
      },
      { data: [{ label: "zero", value: 0 }] },
      { data: [{ label: " ", value: 1 }] },
      { data: [{ label: "x".repeat(23), value: 1 }] },
      { data: [{ label: "leaf", value: 1, extra: true }] },
      { title: " " },
      { title: "x".repeat(81) },
      { unit: " " },
      { unit: "x".repeat(23) },
      { unit: null },
      { extra: true },
      { type: "treemap" },
    ];
    for (const bad of badInputs) {
      await expect(
        createTreemapChartTool().execute(
          "bad",
          { ...parameters, ...bad } as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
      if (!("type" in bad))
        expect(deserializeTreemapChartDetails({ ...details(), ...bad })).toBeUndefined();
    }
    expect(hasBoundedTreemapHierarchy({ data: [deep] })).toBe(false);
    for (const bad of [
      { imageWidthCells: Infinity },
      { imageWidthCells: 0 },
      { fontSize: 33 },
      { fontFamily: undefined },
      { type: "pie" },
    ])
      expect(deserializeTreemapChartDetails({ ...details(), ...bad })).toBeUndefined();
  });

  test("zero leaves consume no area and extreme finite values remain finite", async () => {
    for (const value of [Number.MIN_VALUE, 1e-160, 7, Number.MAX_VALUE]) {
      const d = details({
        data: [
          { label: "a", value },
          { label: "zero", children: [{ label: "b", value: 0 }] },
        ],
      });
      const scene = createTreemapScene(d);
      expect(rectangles(scene.nodes)).toHaveLength(1);
      const svg = renderTreemapChartSvg(d, theme);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    }
    const d = details({
      data: [
        { label: "tiny", value: Number.MIN_VALUE },
        { label: "huge", value: Number.MAX_VALUE },
      ],
    });
    expect(getTreemapChartSummary(d)).toContain('["tiny"]=5e-324 kB');
    expect(renderTreemapChartSvg(d, theme)).not.toMatch(/NaN|Infinity|undefined/);
  }, 15_000);

  test("escapes labels, titles, units and fonts; native fitted labels are individually clipped", () => {
    const d = details({
      title: '<script>"&',
      unit: "ø<&",
      data: [
        { label: "æ<&", value: 0.1 },
        { label: "å", value: 0.2 },
      ],
    });
    const svg = renderTreemapChartSvg({ ...d, fontFamily: 'Font "<&' }, theme);
    expect(svg).not.toContain("<script>");
    for (const escaped of [
      "æ&lt;&amp;",
      "ø&lt;&amp;",
      "å",
      "&lt;script&gt;&quot;&amp;",
      "Font &quot;&lt;&amp;",
      "0.30000000000000004",
    ])
      expect(svg).toContain(escaped);
    expect(svg).toContain("<clipPath");
    const tiny = renderTreemapChartSvg(d, theme, getTreemapChartLayout(d, undefined, 1));
    expect(tiny).not.toMatch(/<text[^>]*data-ts-key=/);
    expect(tiny).toContain("0.30000000000000004");
  });

  test("maximum bounded hierarchy fits the shared SVG worker limit at supported fonts and widths", async () => {
    const leaves = Array.from({ length: 61 }, (_, i) => ({
      label: `${i}${"&".repeat(20)}`,
      value: i + 1,
    }));
    const d = details({
      title: "&".repeat(80),
      unit: "&".repeat(22),
      data: [
        {
          label: "&".repeat(22),
          children: [
            { label: "&".repeat(22), children: [{ label: "&".repeat(22), children: leaves }] },
          ],
        },
      ],
    });
    expect(getTreemapHierarchy(d).rows).toHaveLength(65);
    for (const width of [8, 60]) {
      const svg = renderTreemapChartSvg(
        { ...d, fontSize: 32 },
        theme,
        getTreemapChartLayout({ ...d, fontSize: 32 }, undefined, width),
      );
      expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
      expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    }
  }, 15_000);
  test("print uses the worker, TUI defers images, and cancellation fails before execution", async () => {
    const tool = createTreemapChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateTreemapChartInput(input));
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
    const tui = await createTreemapChartTool().execute(
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
    expect(invalid.render(80)).toEqual(["Treemap unavailable"]);
  }, 15_000);
});
