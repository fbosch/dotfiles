import { describe, expect, test } from "bun:test";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { rasterizeSvg } from "../types";
import type { ScatterChartInput } from "../types/scatter";
import {
  getScatterChartLayout,
  renderScatterChartSvg,
  scatterChartRenderer,
  validateScatterChartInput,
} from "../types/scatter";

const theme = {
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
};
const settings = { imageWidthCells: 60, fontFamily: "Zenbones Brainy", fontSize: 16 };

function details(input: ScatterChartInput) {
  return scatterChartRenderer.createDetails(scatterChartRenderer.parseParameters(input), settings);
}

const sample: ScatterChartInput = {
  type: "scatter",
  title: "Developer tooling",
  xLabel: "Monthly usage",
  yLabel: "Satisfaction",
  data: [
    { x: 120, y: 8, label: "CLI" },
    { x: 90, y: 7, label: "Editor" },
    { x: 160, y: 9, label: "Automation" },
  ],
};

describe("scatter chart", () => {
  test("accepts unordered and duplicate coordinates while preserving input order", () => {
    const parsed = validateScatterChartInput({
      type: "scatter",
      data: [
        { x: 4, y: 2, label: "first" },
        { x: 1, y: 3, label: "second" },
        { x: 4, y: 2, label: "duplicate" },
      ],
    });
    expect(parsed.rows).toEqual([
      { x: 4, y: 2, label: "first" },
      { x: 1, y: 3, label: "second" },
      { x: 4, y: 2, label: "duplicate" },
    ]);
  });

  test("rejects non-finite coordinates, empty labels, and invalid row counts", () => {
    expect(() =>
      validateScatterChartInput({
        type: "scatter",
        data: [
          { x: Number.NaN, y: 1 },
          { x: 2, y: 3 },
        ],
      }),
    ).toThrow("x 1 must be a finite number");
    expect(() =>
      validateScatterChartInput({
        type: "scatter",
        data: [
          { x: 1, y: Infinity },
          { x: 2, y: 3 },
        ],
      }),
    ).toThrow("y 1 must be a finite number");
    expect(() =>
      validateScatterChartInput({
        type: "scatter",
        data: [
          { x: 1, y: 2, label: " " },
          { x: 3, y: 4 },
        ],
      }),
    ).toThrow("label 1");
    expect(() => validateScatterChartInput({ type: "scatter", data: [{ x: 1, y: 2 }] })).toThrow(
      "between 2 and 200",
    );
  });

  test("renders finite constant domains, equal fixed dot radii, and escaped labels", () => {
    const chart = details({
      type: "scatter",
      data: [
        { x: 4, y: 2, label: "A < B & C" },
        { x: 4, y: 2, label: "A < B & C" },
      ],
    });
    const svg = renderScatterChartSvg(chart, theme);
    expect(svg).toContain("A &lt; B &amp; C");
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
    const radii = [...svg.matchAll(/<circle[^>]* r="4"/g)];
    expect(radii).toHaveLength(2);
    expect(radii).toHaveLength(2);
  });

  test("uses configured font sizing and keeps a narrow chart within the height cap", () => {
    const chart = details(sample);
    const svg = scatterChartRenderer.renderSvg(
      chart,
      theme,
      scatterChartRenderer.getLayout(chart, undefined, 60),
    );
    expect(svg).toContain('font-family="Zenbones Brainy"');
    expect(svg).toContain('font-size="16"');
    const narrow = getScatterChartLayout({ widthPx: 9, heightPx: 18 }, 28, true, true, true, 16);
    expect(narrow.heightCells).toBeLessThanOrEqual(18);
    expect(renderScatterChartSvg(chart, theme, narrow)).toContain('data-point-label="0"');
  });

  test("rasterizes labeled samples at wide and narrow widths with the configured font", async () => {
    const chart = details(sample);
    const layouts = [
      scatterChartRenderer.getLayout(chart, undefined, 60),
      scatterChartRenderer.getLayout(chart, undefined, 28),
    ];
    const pngs = await Promise.all(
      layouts.map((layout) =>
        rasterizeSvg(
          renderScatterChartSvg(chart, theme, layout, chart.fontFamily),
          undefined,
          chart.fontFamily === undefined ? {} : { fontFamily: chart.fontFamily },
        ),
      ),
    );
    expect(pngs.map(getPngDimensions)).toEqual(
      layouts.map(({ widthPx, heightPx }) => ({ widthPx, heightPx })),
    );
  });
});
