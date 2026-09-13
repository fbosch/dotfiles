import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { createHeatmapChartTool, createPieChartTool } from "../metadata";
import { chartHeatmapParameters, type HeatmapChartInput } from "../schemas";
import { rasterizeSvg } from "../types";
import {
  deserializeHeatmapChartDetails,
  getHeatmapChartLayout,
  getHeatmapChartSummary,
  getHeatmapDomain,
  heatmapChartRenderer,
  renderHeatmapChartSvg,
  validateHeatmapChartInput,
} from "../types/heatmap";
import manifest from "./fixtures/visual-validation/manifest.json";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };
const input: HeatmapChartInput = {
  type: "heatmap",
  rows: [" A ", "B"],
  columns: ["X", "Y", "Z"],
  data: [
    [-2, 0, null],
    [1, 2, 4],
  ],
};
const details = (options: Partial<HeatmapChartInput> = {}) =>
  heatmapChartRenderer.createDetails(validateHeatmapChartInput({ ...input, ...options }), settings);
const context = (mode: "tui" | "print") =>
  ({
    mode,
    cwd: process.cwd(),
    isProjectTrusted: () => false,
    ui: { theme },
  }) as unknown as ExtensionContext;
function rectangles(svg: string) {
  return [...svg.matchAll(/<rect\b[^>]*data-ts-key="[^"]*"[^>]*\/>/g)].map((match) => {
    const attrs = Object.fromEntries(
      [...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    return {
      key: attrs["data-ts-key"],
      x: Number(attrs.x),
      y: Number(attrs.y),
      width: Number(attrs.width),
      height: Number(attrs.height),
      fill: attrs.fill,
    };
  });
}

type HeatmapVisualProfile = keyof typeof manifest.profiles;

type RenderedHeatmapView = {
  fixtureId: string;
  profileName: HeatmapVisualProfile;
  details: ReturnType<typeof details>;
  layout: ReturnType<typeof getHeatmapChartLayout>;
  svg: string;
};

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a heatmap visual fixture");
  return value;
}

const frozenHeatmap = required(manifest.charts.find((chart) => chart.chart === "heatmap"));
const renderedHeatmapViews: RenderedHeatmapView[] = frozenHeatmap.cases.flatMap((fixture) => {
  const profiles = [
    ...fixture.profiles.map((profileName) => ({
      profileName: profileName as HeatmapVisualProfile,
      maxHeightCells: undefined,
    })),
    ...(fixture.heightCaps ?? []).map((cap) => ({
      profileName: cap.profile as HeatmapVisualProfile,
      maxHeightCells: cap.maxHeightCells,
    })),
  ];
  return profiles.map(({ profileName, maxHeightCells }) => {
    const profile = manifest.profiles[profileName];
    const parameters = {
      ...fixture.args,
      type: "heatmap" as const,
      ...(maxHeightCells === undefined ? {} : { maxHeightCells }),
    } as HeatmapChartInput;
    const renderedDetails = heatmapChartRenderer.createDetails(
      heatmapChartRenderer.parseParameters(parameters),
      { imageWidthCells: profile.widthCells, fontFamily: "sans-serif" },
    );
    const layout = getHeatmapChartLayout(
      renderedDetails,
      { widthPx: profile.cellWidthPx, heightPx: profile.cellHeightPx },
      profile.widthCells,
    );
    return {
      fixtureId: fixture.id,
      profileName,
      details: renderedDetails,
      layout,
      svg: renderHeatmapChartSvg(renderedDetails, theme, layout),
    };
  });
});

describe("heatmap", () => {
  test("has a bounded discriminator-free contract and validates matrix semantics", async () => {
    const { type: _type, ...parameters } = input;
    expect(Value.Check(chartHeatmapParameters, parameters)).toBe(true);
    expect(Value.Check(chartHeatmapParameters, input)).toBe(false);
    expect(details()).toMatchObject({
      rows: ["A", "B"],
      colorScale: "sequential",
      showValues: false,
    });
    const invalid: unknown[] = [
      { ...parameters, rows: [] },
      { ...parameters, columns: Array(13).fill("X") },
      { ...parameters, rows: ["A", " A "] },
      { ...parameters, columns: ["X", "X", "Z"] },
      { ...parameters, rows: [" ", "B"] },
      { ...parameters, rows: ["x".repeat(23), "B"] },
      { ...parameters, data: [[1, 2]] },
      {
        ...parameters,
        data: [
          [1, 2, 3],
          [1, 2],
        ],
      },
      {
        ...parameters,
        data: [
          [1, 2, 3],
          [1, 2, 3, 4],
        ],
      },
      ...[NaN, Infinity, -Infinity, 1e9 + 1, -1e9 - 1, "1", undefined].map((value) => ({
        ...parameters,
        data: [
          [value, 0, null],
          [1, 2, 3],
        ],
      })),
      { ...parameters, title: " " },
      { ...parameters, title: "x".repeat(81) },
      { ...parameters, colorScale: "rainbow" },
      { ...parameters, showValues: 1 },
      { ...parameters, extra: true },
    ];
    for (const candidate of invalid) {
      await expect(
        createHeatmapChartTool().execute(
          "bad",
          candidate as never,
          undefined,
          undefined,
          context("tui"),
        ),
      ).rejects.toThrow();
    }
    const labels = Array.from({ length: 12 }, (_, i) => `L${i}`);
    const largest = details({
      rows: labels,
      columns: labels,
      data: labels.map(() => labels.map(() => 1e9)),
    });
    expect(largest.data.flat()).toHaveLength(144);
    expect(() =>
      details({ rows: labels, columns: labels, data: largest.data, showValues: true }),
    ).toThrow("36");
  });

  test("preserves row-major matrix geometry in actual TanStack SVG, including missing and zero cells", () => {
    const d = details();
    const layout = getHeatmapChartLayout(d);
    const svg = renderHeatmapChartSvg(d, theme, layout);
    const cells = rectangles(svg);
    expect(cells).toHaveLength(6);
    expect(new Set(cells.map((cell) => cell.key)).size).toBe(6);
    for (const [i, cell] of cells.entries()) {
      expect(cell.x).toBeCloseTo(((i % 3) * layout.plotWidthPx) / 3 + 1, 2);
      expect(cell.y).toBeCloseTo((Math.floor(i / 3) * layout.plotHeightPx) / 2 + 1, 2);
      expect(cell.width).toBeCloseTo(layout.plotWidthPx / 3 - 2, 2);
      expect(cell.height).toBeCloseTo(layout.plotHeightPx / 2 - 2, 2);
    }
    expect(cells[2]?.fill).toBe("url(#pi-heatmap-missing)");
    expect(cells[1]?.fill).not.toBe(cells[2]?.fill);
    expect(svg).toContain('data-color-ramp="true"');
    expect(svg).toContain("Missing (null)");
    expect(svg).not.toContain('data-cell-value="true"');
    expect(getHeatmapChartSummary(d)).toContain("Y = 0, Z = missing");
    expect(getHeatmapDomain(d)).toEqual([-2, 4]);
  });

  test("renders singleton, thin and maximum matrices with one positive-area TanStack cell per entry", () => {
    for (const [rowCount, columnCount] of [
      [1, 1],
      [1, 12],
      [12, 1],
      [12, 12],
    ] as const) {
      const rows = Array.from({ length: rowCount }, (_, i) => `R${i}`);
      const columns = Array.from({ length: columnCount }, (_, i) => `C${i}`);
      const d = details({ rows, columns, data: rows.map(() => columns.map(() => null)) });
      const cells = rectangles(renderHeatmapChartSvg(d, theme));
      expect(cells).toHaveLength(rowCount * columnCount);
      expect(new Set(cells.map((cell) => cell.x)).size).toBe(columnCount);
      expect(new Set(cells.map((cell) => cell.y)).size).toBe(rowCount);
      expect(cells.every((cell) => cell.width > 0 && cell.height > 0)).toBe(true);
    }
  });

  test("uses symmetric diverging domains and matching ramp colors for negative, zero and positive values", () => {
    const d = details({
      data: [
        [-4, 0, 4],
        [null, -1, 2],
      ],
      colorScale: "diverging",
    });
    expect(getHeatmapDomain(d)).toEqual([-4, 4]);
    const svg = renderHeatmapChartSvg(d, theme);
    expect(
      rectangles(svg)
        .slice(0, 3)
        .map((cell) => cell.fill),
    ).toEqual(["#2166ac", "#f7f7f7", "#b2182b"]);
    for (const color of ["#2166ac", "#f7f7f7", "#b2182b"])
      expect(svg).toContain(`stop-color="${color}"`);
    expect(
      getHeatmapDomain(
        details({
          data: [
            [1, 2, 3],
            [4, 5, 6],
          ],
          colorScale: "diverging",
        }),
      ),
    ).toEqual([-6, 6]);
    expect(
      getHeatmapDomain(
        details({
          data: [
            [-1, -2, -3],
            [-4, -5, -6],
          ],
          colorScale: "diverging",
        }),
      ),
    ).toEqual([-6, 6]);
  });

  test("handles constant, all-null, zero-only, subnormal and bounded extreme matrices without fictional ranges", async () => {
    for (const colorScale of ["sequential", "diverging"] as const) {
      for (const row of [
        [null, null, null],
        [0, 0, 0],
        [7, 7, 7],
        [-7, -7, -7],
        [-1e9, 0, 1e9],
        [-Number.MIN_VALUE, 0, Number.MIN_VALUE],
      ]) {
        const d = details({ data: [row, row], colorScale });
        const svg = renderHeatmapChartSvg(d, theme);
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        expect(rectangles(svg)).toHaveLength(6);
        if (row[0] === null) {
          expect(getHeatmapDomain(d)).toBeUndefined();
          expect(svg).toContain("No numeric data");
          expect(svg).not.toContain('data-color-ramp="true"');
          expect(rectangles(svg).every((cell) => cell.fill === "url(#pi-heatmap-missing)")).toBe(
            true,
          );
        } else if (
          row.every((value) => value === row[0]) &&
          (colorScale === "sequential" || row[0] === 0)
        ) {
          expect(svg).toContain(`Constant: ${row[0]}`);
          expect(svg).not.toContain('data-color-ramp="true"');
          expect(new Set(rectangles(svg).map((cell) => cell.fill)).size).toBe(1);
        }
        if (row[0] === null) expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
      }
    }
  }, 15_000);

  test("escapes labels, titles and font names while retaining Danish letters and exact values in summaries", () => {
    const d = details({
      rows: ["æ<&", "ø"],
      columns: ["å", '"X"', "Z"],
      title: '<script>"&',
      data: [
        [1.23456789, 0, null],
        [1, 2, 3],
      ],
      showValues: true,
    });
    d.fontFamily = 'Font "<&';
    const svg = renderHeatmapChartSvg(d, theme);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&quot;&amp;");
    expect(svg).toContain("æ&lt;&amp;");
    expect(svg).toContain("ø");
    expect(svg).toContain("å");
    expect(svg).toContain('font-family="Font &quot;&lt;&amp;"');
    expect(svg.match(/data-cell-value="true"/g)).toHaveLength(5);
    expect(getHeatmapChartSummary(d)).toContain("å = 1.23456789");
    expect(renderHeatmapChartSvg(d, theme, getHeatmapChartLayout(d, undefined, 15))).not.toContain(
      'data-cell-value="true"',
    );
  });

  test("keeps the largest matrix inside the worker SVG budget and supports configured fonts and cell sizes", async () => {
    const labels = Array.from({ length: 12 }, (_, i) => `${i}${"&".repeat(20)}`);
    const d = details({
      rows: labels,
      columns: labels,
      title: "&".repeat(80),
      data: labels.map(() => labels.map((_, i) => (i % 2 ? -1e9 : null))),
    });
    const svg = renderHeatmapChartSvg(d, theme);
    expect(rectangles(svg)).toHaveLength(144);
    expect(Buffer.byteLength(svg)).toBeLessThan(64 * 1024);
    expect(getPngDimensions(await rasterizeSvg(svg))).toBeDefined();
    for (const fontSize of [8, 14, 32]) {
      const configured = { ...details(), fontSize, fontFamily: "Zenbones Brainy" };
      const layout = getHeatmapChartLayout(configured, { widthPx: 16, heightPx: 38 });
      expect(layout.plotHeightPx / configured.rows.length).toBeGreaterThanOrEqual(
        layout.fontSizePx * 1.25,
      );
      expect(layout.heightPx).toBeGreaterThan(
        layout.plotY + layout.plotHeightPx + layout.fontSizePx * 4.5,
      );
      expect(renderHeatmapChartSvg(configured, theme, layout)).toContain(
        'font-family="Zenbones Brainy"',
      );
    }
  }, 15_000);

  test("keeps capped manifest heatmaps raster-visible without changing matrix identity", async () => {
    expect(renderedHeatmapViews).toHaveLength(7);
    for (const view of renderedHeatmapViews) {
      const cells = rectangles(view.svg);
      expect(cells, `${view.fixtureId} ${view.profileName}`).toHaveLength(
        view.details.rows.length * view.details.columns.length,
      );
      expect(new Set(cells.map((cell) => cell.key)).size).toBe(cells.length);
      expect(cells.every((cell) => cell.width > 0 && cell.height > 0)).toBe(true);
      expect(view.svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(getPngDimensions(await rasterizeSvg(view.svg))).toEqual({
        widthPx: view.layout.widthPx,
        heightPx: view.layout.heightPx,
      });

      const showValues =
        view.details.showValues &&
        view.layout.plotWidthPx / view.details.columns.length >= view.layout.fontSizePx * 5 &&
        view.layout.plotHeightPx / view.details.rows.length >= view.layout.fontSizePx * 1.2;
      expect(view.svg.match(/data-cell-value="true"/g)?.length ?? 0).toBe(
        showValues ? view.details.data.flat().filter((value) => value !== null).length : 0,
      );
    }

    const dense = required(
      renderedHeatmapViews.find(
        (view) =>
          view.fixtureId === "heatmap-adversarial-dense-missing" && view.profileName === "N8",
      ),
    );
    const rowLabels = [
      ...dense.svg.matchAll(
        /<text x="[^"]+" y="([^"]+)" font-size="([^"]+)" text-anchor="end"[^>]*>([^<]+)<\/text>/g,
      ),
    ].slice(0, dense.details.rows.length);
    expect(rowLabels).toHaveLength(dense.details.rows.length);
    const rowLabelY = rowLabels.map((match) => Number(match[1]));
    expect(
      rowLabelY.every(
        (value, index) =>
          index === 0 || value - (rowLabelY[index - 1] ?? value) >= dense.layout.fontSizePx,
      ),
    ).toBe(true);
    expect(rowLabels.map((match) => match[3])).toEqual(dense.details.rows);
    expect(new Set(rectangles(dense.svg).map((cell) => cell.y))).toHaveLength(6);
    expect(new Set(rectangles(dense.svg).map((cell) => cell.x))).toHaveLength(6);
  }, 30_000);

  test("round-trips saved details and rejects corrupt replay matrices", () => {
    const d = details({ showValues: true, colorScale: "diverging" });
    expect(deserializeHeatmapChartDetails(JSON.parse(JSON.stringify(d)))).toEqual(d);
    for (const invalid of [
      { ...d, data: [[1]] },
      { ...d, rows: ["A", " A "] },
      { ...d, imageWidthCells: Infinity },
      { ...d, colorScale: "other" },
      { ...d, fontSize: 100 },
      {
        ...d,
        data: [
          [NaN, 0, null],
          [1, 2, 3],
        ],
      },
    ]) {
      expect(deserializeHeatmapChartDetails(invalid)).toBeUndefined();
    }
  });

  test("returns exact text/details in TUI and PNG in print, replays by discriminator, and reuses the result slot", async () => {
    const tool = createHeatmapChartTool();
    const { type: _type, ...parameters } = input;
    const tui = await tool.execute("tui", parameters, undefined, undefined, context("tui"));
    expect(tui.content.map((part) => part.type)).toEqual(["text"]);
    expect(tui.details).toMatchObject(validateHeatmapChartInput(input));
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
