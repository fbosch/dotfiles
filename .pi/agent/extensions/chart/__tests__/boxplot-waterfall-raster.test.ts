import { describe, expect, test } from "bun:test";
import { getPngDimensions } from "@earendil-works/pi-tui";
import { Resvg } from "@resvg/resvg-js";
import { rasterizeSvg } from "../types";
import { boxplotChartRenderer } from "../types/boxplot";
import { getWaterfallRows, waterfallChartRenderer } from "../types/waterfall";

const theme = {
  getFgAnsi: () => "\u001b[38;2;187;187;187m",
};
const cells = { widthPx: 9, heightPx: 18 };

function marks(svg: string, tag: string) {
  return [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*\\/>`, "g"))].map((match) =>
    Object.fromEntries(
      [...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map((part) => [part[1], part[2]]),
    ),
  );
}

function textTags(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map((match) => match[0]);
}

function expectTextMasksDoNotOverlap(svg: string): void {
  const openingEnd = svg.indexOf(">");
  if (openingEnd < 0) throw new Error("missing SVG opening tag");
  const colors = ["#ff0000", "#00ff00", "#0000ff"];
  const labels = textTags(svg).map((tag, index) =>
    tag.replace(/\bfill="[^"]*"/, `fill="${colors[index % colors.length]}"`),
  );
  const pixels = new Resvg(`${svg.slice(0, openingEnd + 1)}${labels.join("")}</svg>`).render()
    .pixels;
  let overlap = false;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = (pixels[offset] ?? 0) >= 16;
    const green = (pixels[offset + 1] ?? 0) >= 16;
    const blue = (pixels[offset + 2] ?? 0) >= 16;
    if (Number(red) + Number(green) + Number(blue) > 1) {
      overlap = true;
      break;
    }
  }
  expect(overlap).toBe(false);
}

function rowLabels(svg: string, layout: { plotX: number; plotY: number; plotHeightPx: number }) {
  return textTags(svg).filter((tag) => {
    const x = Number(tag.match(/\bx="([0-9.e+-]+)"/)?.[1]);
    const y = Number(tag.match(/\by="([0-9.e+-]+)"/)?.[1]);
    return (
      tag.includes('text-anchor="end"') &&
      Math.abs(x - (layout.plotX - 6)) < 0.01 &&
      y >= layout.plotY &&
      y <= layout.plotY + layout.plotHeightPx
    );
  });
}

describe("boxplot and waterfall capped raster geometry", () => {
  test("boxplot N8 keeps each distribution and disjoint retained labels in the exact raster", async () => {
    const details = boxplotChartRenderer.createDetails(
      boxplotChartRenderer.parseParameters({
        type: "boxplot",
        groups: [
          { label: "Extreme outlier group", values: [100, 3, 2, 1, 0, 4] },
          { label: "After", values: [1, 2, 2, 3] },
          { label: "Constant", values: [7, 7, 7] },
          { label: "Singleton", values: [-3] },
          { label: "Negative range", values: [-4, -3, -2, -1] },
          { label: "Subnormal", values: [-5e-324, 0, 5e-324] },
        ],
        title: "Degenerate distributions",
        xLabel: "Value",
        yLabel: "Group",
        showOutliers: false,
        maxHeightCells: 8,
      }),
      { imageWidthCells: 28, fontFamily: "sans-serif" },
    );
    const layout = boxplotChartRenderer.getLayout(details, cells, 28);
    const svg = boxplotChartRenderer.renderSvg(details, theme, layout);
    const boxes = marks(svg, "rect").filter((mark) => mark["data-ts-key"]?.includes(":box-"));
    const lines = marks(svg, "line");

    expect(layout).toMatchObject({ widthPx: 252, heightPx: 144, heightCells: 8, compact: true });
    expect(layout.plotHeightPx / details.groups.length).toBeGreaterThanOrEqual(
      layout.fontSizePx * 1.05,
    );
    expect(boxes).toHaveLength(details.groups.length);
    expect(lines).toHaveLength(details.groups.length * 5);
    expect(rowLabels(svg, layout)).toHaveLength(details.groups.length);
    expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({ widthPx: 252, heightPx: 144 });
    expectTextMasksDoNotOverlap(svg);
  }, 15_000);

  test("waterfall N8 keeps bars, connectors, zero rules, legend meaning, and disjoint exact raster text", async () => {
    const details = waterfallChartRenderer.createDetails(
      waterfallChartRenderer.parseParameters({
        type: "waterfall",
        start: -5,
        deltas: [
          { label: "Recover", value: 5 },
          { label: "No change", value: 0 },
          { label: "Drop", value: -10 },
          { label: "Rebound", value: 20 },
          { label: "Fee", value: -3 },
          { label: "Bonus", value: 0 },
          { label: "Close", value: -7 },
          { label: "Correction", value: 2 },
        ],
        title: "Signed cash flow",
        xLabel: "Amount",
        yLabel: "Step",
        maxHeightCells: 8,
      }),
      { imageWidthCells: 28, fontFamily: "sans-serif" },
    );
    const layout = waterfallChartRenderer.getLayout(details, cells, 28);
    const svg = waterfallChartRenderer.renderSvg(details, theme, layout);
    const rows = getWaterfallRows(details);
    const bars = marks(svg, "rect").filter((mark) => mark["data-ts-key"]?.includes(":bar-"));
    const lines = marks(svg, "line");
    const legend = ["Increase (+)", "Decrease (−)", "Start / Total / Zero"].map((label) =>
      textTags(svg).find((tag) => tag.includes(`>${label}</text>`)),
    );

    expect(layout).toMatchObject({ widthPx: 252, heightPx: 144, heightCells: 8, compact: true });
    expect(layout.fontSizePx).toBe(8);
    expect(layout.plotHeightPx / rows.length).toBeGreaterThanOrEqual(layout.fontSizePx * 1.05);
    expect(bars).toHaveLength(rows.length);
    expect(lines.filter((line) => line["data-ts-key"]?.startsWith("connector-")).length).toBe(
      rows.length - 1,
    );
    expect(lines.filter((line) => line["data-ts-key"]?.startsWith("zero-bar-")).length).toBe(2);
    expect(rowLabels(svg, layout)).toHaveLength(rows.length);
    expect(legend.every((tag) => tag !== undefined)).toBe(true);
    expect(new Set(legend.map((tag) => tag?.match(/\by="([0-9.e+-]+)"/)?.[1])).size).toBe(1);
    expect(getPngDimensions(await rasterizeSvg(svg))).toEqual({ widthPx: 252, heightPx: 144 });
    expectTextMasksDoNotOverlap(svg);
  }, 15_000);
});
