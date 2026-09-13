import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
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

type AlphaRaster = {
  width: number;
  height: number;
  hasVisiblePixel(left: number, top: number, right: number, bottom: number): boolean;
};

function decodeAlphaRaster(png: string): AlphaRaster {
  const bytes = Buffer.from(png, "base64");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  const decoded = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const alpha = new Uint8Array(width * height);
  let sourceOffset = 0;
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[sourceOffset] ?? 0;
    sourceOffset += 1;
    const filtered = decoded.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? (row[x - 4] ?? 0) : 0;
      const above = previous[x] ?? 0;
      const upperLeft = x >= 4 ? (previous[x - 4] ?? 0) : 0;
      const value = filtered[x] ?? 0;
      row[x] =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 0xff
            : filter === 2
              ? (value + above) & 0xff
              : filter === 3
                ? (value + Math.floor((left + above) / 2)) & 0xff
                : (() => {
                    const estimate = left + above - upperLeft;
                    const distanceLeft = Math.abs(estimate - left);
                    const distanceAbove = Math.abs(estimate - above);
                    const distanceUpperLeft = Math.abs(estimate - upperLeft);
                    const predictor =
                      distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft
                        ? left
                        : distanceAbove <= distanceUpperLeft
                          ? above
                          : upperLeft;
                    return (value + predictor) & 0xff;
                  })();
    }
    for (let x = 0; x < width; x += 1) alpha[y * width + x] = row[x * 4 + 3] ?? 0;
    previous = row;
  }

  return {
    width,
    height,
    hasVisiblePixel(left, top, right, bottom) {
      const boundedLeft = Math.max(0, Math.floor(left));
      const boundedTop = Math.max(0, Math.floor(top));
      const boundedRight = Math.min(width, Math.ceil(right));
      const boundedBottom = Math.min(height, Math.ceil(bottom));
      for (let y = boundedTop; y < boundedBottom; y += 1) {
        for (let x = boundedLeft; x < boundedRight; x += 1) {
          if ((alpha[y * width + x] ?? 0) > 0) return true;
        }
      }
      return false;
    },
  };
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

const duplicateCoordinateGraph: ScatterChartInput = {
  type: "scatter",
  data: [
    { x: 12, y: 48, label: "Alpha" },
    { x: 12, y: 48, label: "Bravo" },
    { x: 12, y: 48, label: "Charlie" },
    { x: 12, y: 48, label: "Delta" },
    { x: 12, y: 48, label: "Echo" },
    { x: 12, y: 48, label: "Foxtrot" },
    { x: 12, y: 48, label: "Golf" },
    { x: 12, y: 48, label: "Hotel" },
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
  });

  test("keeps every duplicate-coordinate label distinct through geometry and rasterization", async () => {
    const chart = details(duplicateCoordinateGraph);
    const layout = scatterChartRenderer.getLayout(chart, undefined, 28);
    const svg = renderScatterChartSvg(chart, theme, layout, chart.fontFamily);
    for (const label of duplicateCoordinateGraph.data
      .map((point) => point.label)
      .filter((value): value is string => value !== undefined)) {
      expect(svg).toContain(label);
    }

    const png = await rasterizeSvg(
      svg,
      undefined,
      chart.fontFamily === undefined ? {} : { fontFamily: chart.fontFamily },
    );
    expect(getPngDimensions(png)).toEqual({ widthPx: layout.widthPx, heightPx: layout.heightPx });
  });

  test("keeps coincident pair names in compact grouped callouts", () => {
    const chart = details({
      type: "scatter",
      maxHeightCells: 8,
      title: "Duplicate coordinates",
      xLabel: "X",
      yLabel: "Y",
      data: [
        { x: 0, y: 0, label: "Origin one" },
        { x: 0, y: 0, label: "Origin two" },
        { x: 1, y: 1, label: "Diagonal one" },
        { x: 1, y: 1, label: "Diagonal two" },
        { x: 2, y: 0, label: "Low" },
        { x: 2, y: 2, label: "High" },
        { x: 1, y: 0, label: "Middle" },
        { x: 0, y: 2, label: "Upper" },
      ],
    });
    const layout = scatterChartRenderer.getLayout(chart, { widthPx: 9, heightPx: 18 }, 28);
    const svg = renderScatterChartSvg(chart, theme, layout, chart.fontFamily);

    expect(layout).toMatchObject({ widthPx: 252, heightPx: 144, heightCells: 8 });
    expect(svg).toContain(">Origin one</tspan>");
    expect(svg).toContain(">Origin two</tspan>");
    expect(svg).toContain(">Diagonal one</tspan>");
    expect(svg).toContain(">Diagonal two</tspan>");
    expect(svg).not.toContain(">2 points</tspan>");
    expect(svg.match(/<text data-point-multiplicity="2"/g)).toHaveLength(2);
  });

  test("keeps eight coincident labels visible in compact rasterized callouts", async () => {
    const chart = details({
      ...duplicateCoordinateGraph,
      title: "Eight coincident points",
      xLabel: "X label",
      yLabel: "Y label",
      maxHeightCells: 8,
    });
    const layout = scatterChartRenderer.getLayout(chart, { widthPx: 9, heightPx: 18 }, 28);
    const svg = renderScatterChartSvg(chart, theme, layout, chart.fontFamily);

    expect(layout).toMatchObject({ widthPx: 252, heightPx: 144, heightCells: 8 });
    const labels = [
      ...svg.matchAll(
        /<text data-point-label="(\d+)" x="([\d.]+)" y="([\d.]+)"[^>]*>[\s\S]*?<\/text>/g,
      ),
    ];
    expect(labels).toHaveLength(8);
    expect(labels.map((match) => Number(match[1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(labels.map((match) => Number(match[2]))).toEqual([
      94, 206.52, 94, 206.52, 94, 206.52, 94, 206.52,
    ]);
    expect(labels.map((match) => Number(match[3]))).toEqual([
      46.4, 46.4, 57.4, 57.4, 68.4, 68.4, 79.4, 79.4,
    ]);
    for (const label of duplicateCoordinateGraph.data
      .map((point) => point.label)
      .filter((value): value is string => value !== undefined)) {
      expect(svg).toContain(`>${label}</tspan>`);
    }

    const dotPositions = [...svg.matchAll(/<circle[^>]* cx="([\d.]+)" cy="([\d.]+)" r="4"/g)].map(
      (match) => `${match[1]},${match[2]}`,
    );
    expect(dotPositions).toHaveLength(8);
    expect(new Set(dotPositions)).toEqual(new Set(["73.5,20.5"]));

    const png = await rasterizeSvg(
      svg,
      undefined,
      chart.fontFamily === undefined ? {} : { fontFamily: chart.fontFamily },
    );
    const raster = decodeAlphaRaster(png);
    expect({ widthPx: raster.width, heightPx: raster.height }).toEqual({
      widthPx: 252,
      heightPx: 144,
    });
    for (const [index, match] of labels.entries()) {
      const x = Number(match[2]);
      const y = Number(match[3]);
      expect(raster.hasVisiblePixel(x, y - 7, x + 40, y - 1)).toBe(true);
      expect(index).toBeLessThan(8);
    }
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
