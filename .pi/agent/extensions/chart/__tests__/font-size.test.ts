import { describe, expect, test } from "bun:test";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { rasterizeSvg, resolveChartSettings } from "../types";
import { barChartRenderer, getBarChartLayout } from "../types/bar";
import { getLineChartLayout, lineChartRenderer } from "../types/line";
import { getPieChartLayout, pieChartRenderer } from "../types/pie";

const theme = {
  getFgAnsi: (color: string) =>
    color === "text" ? "\u001b[38;2;187;187;187m" : "\u001b[38;2;102;165;173m",
};

const settings = { imageWidthCells: 60, fontFamily: "Zenbones Brainy", fontSize: 20 };

function svgFontSizes(svg: string): number[] {
  return [...svg.matchAll(/font-size="(\d+)"/g)].map((match) => Number(match[1]));
}

describe("chart font size", () => {
  test("keeps existing sizing when omitted and validates the merged optional setting", () => {
    expect(resolveChartSettings({}, {})).toEqual({ fontFamily: "sans-serif" });
    expect(
      resolveChartSettings(
        { charts: { fontFamily: "Global", fontSize: 14 } },
        { charts: { fontSize: 20 } },
      ),
    ).toEqual({ fontFamily: "Global", fontSize: 20 });

    for (const fontSize of ["20", -1, Number.NEGATIVE_INFINITY, 33]) {
      expect(() => resolveChartSettings({ charts: { fontSize } }, {})).toThrow(
        "global charts.fontSize",
      );
    }
  });

  test("persists a configured size and replays prior details without one", () => {
    const pie = pieChartRenderer.createDetails(
      pieChartRenderer.parseParameters({
        type: "pie",
        data: [
          { label: "Open", value: 3 },
          { label: "Closed", value: 1 },
        ],
      }),
      settings,
    );
    const bar = barChartRenderer.createDetails(
      barChartRenderer.parseParameters({
        type: "bar",
        data: [
          { label: "Loss", value: -2 },
          { label: "Gain", value: 4 },
        ],
      }),
      settings,
    );
    const line = lineChartRenderer.createDetails(
      lineChartRenderer.parseParameters({
        type: "line",
        xType: "numeric",
        data: [
          { x: 0, y: 1 },
          { x: 1, y: 2 },
        ],
      }),
      settings,
    );

    expect([pie.fontSize, bar.fontSize, line.fontSize]).toEqual([20, 20, 20]);
    expect(
      pieChartRenderer.deserializeDetails({ rows: pie.rows, imageWidthCells: 60 }),
    ).toBeDefined();
    expect(
      barChartRenderer.deserializeDetails({ type: "bar", rows: bar.rows, imageWidthCells: 60 }),
    ).toBeDefined();
    expect(lineChartRenderer.deserializeDetails({ ...line, fontSize: undefined })).toBeDefined();
  });

  test("uses configured logical pixels in every renderer and reserves layout space", async () => {
    const pie = pieChartRenderer.createDetails(
      pieChartRenderer.parseParameters({
        type: "pie",
        title: "Status",
        data: [
          { label: "Open", value: 3 },
          { label: "Closed", value: 1 },
        ],
      }),
      settings,
    );
    const bar = barChartRenderer.createDetails(
      barChartRenderer.parseParameters({
        type: "bar",
        title: "Balance",
        data: [
          { label: "Loss", value: -2 },
          { label: "Gain", value: 4 },
        ],
      }),
      settings,
    );
    const line = lineChartRenderer.createDetails(
      lineChartRenderer.parseParameters({
        type: "line",
        xType: "numeric",
        title: "Trend",
        xLabel: "Time",
        yLabel: "Value",
        data: [
          { x: 0, y: 1 },
          { x: 1, y: 2 },
        ],
      }),
      settings,
    );
    const dimensions = { widthPx: 9, heightPx: 18 };
    const pieLayout = pieChartRenderer.getLayout(pie, dimensions, 28);
    const barLayout = barChartRenderer.getLayout(bar, dimensions, 28);
    const lineLayout = lineChartRenderer.getLayout(line, dimensions, 28);
    const svgs = [
      pieChartRenderer.renderSvg(pie, theme, pieLayout),
      barChartRenderer.renderSvg(bar, theme, barLayout),
      lineChartRenderer.renderSvg(line, theme, lineLayout),
    ];

    for (const svg of svgs) {
      expect(svg).toContain('font-family="Zenbones Brainy"');
      expect(svg).not.toContain("currentColor");
      expect(svgFontSizes(svg).some((size) => size >= 17)).toBe(true);
    }
    expect(pieLayout.heightCells).toBeLessThanOrEqual(18);
    expect(barLayout.rowHeightPx).toBeGreaterThan(
      getBarChartLayout(dimensions, 28, 2, true).rowHeightPx,
    );
    expect(lineLayout.heightPx).toBeGreaterThan(
      getLineChartLayout(dimensions, 28, true, true, true).heightPx,
    );
    expect(getPieChartLayout(dimensions, 28, 12, 32).heightCells).toBeLessThanOrEqual(18);

    const pngs = await Promise.all(
      svgs.map((svg) => rasterizeSvg(svg, undefined, { fontFamily: "Zenbones Brainy" })),
    );
    expect(pngs.map(getPngDimensions)).toEqual([
      { widthPx: pieLayout.widthPx, heightPx: pieLayout.heightPx },
      { widthPx: barLayout.widthPx, heightPx: barLayout.heightPx },
      { widthPx: lineLayout.widthPx, heightPx: lineLayout.heightPx },
    ]);
  });
});
