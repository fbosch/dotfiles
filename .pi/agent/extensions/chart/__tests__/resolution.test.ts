import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type CellDimensions,
  getPngDimensions,
  Image,
  setCapabilities,
  setCellDimensions,
} from "@earendil-works/pi-tui";
import { ChartComponent, rasterizeSvg, renderChartSvg } from "../types";
import { pieChartRenderer } from "../types/pie";

const theme = {
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => "\u001b[38;2;102;165;173m",
} as unknown as Theme;
const details = {
  rows: [
    { label: "Åben", value: 3 },
    { label: "Lukket", value: 1 },
  ],
  imageWidthCells: 60,
  fontSize: 18,
};

function placement(lines: string[]): { columns: number; rows: number } {
  const first = lines[0] ?? "";
  return {
    columns: Number(/(?:^|,)c=(\d+)/.exec(first)?.[1]),
    rows: Number(/(?:^|,)r=(\d+)/.exec(first)?.[1]),
  };
}

describe("TUI chart raster resolution", () => {
  test.each([
    [{ widthPx: 16, heightPx: 38 }, 62],
    [{ widthPx: 16, heightPx: 38 }, 61],
    [{ widthPx: 16, heightPx: 38 }, 30],
    [{ widthPx: 9, heightPx: 18 }, 61],
  ] satisfies [CellDimensions, number][])(
    "preserves full PNG resolution without changing logical fonts or Kitty placement (%j, width %i)",
    async (cells, width) => {
      setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
      setCellDimensions(cells);
      try {
        let svg = "";
        let png = "";
        let redraw!: () => void;
        const ready = new Promise<void>((resolve) => {
          redraw = resolve;
        });
        const component = new ChartComponent(
          details,
          theme,
          redraw,
          pieChartRenderer,
          async (source, signal, requestedOptions) => {
            svg = source;
            png = await rasterizeSvg(source, signal, requestedOptions);
            return png;
          },
        );
        expect(component.render(width)).toEqual([]);
        await ready;
        const columns = Math.min(details.imageWidthCells, width - 2);
        const layout = pieChartRenderer.getLayout(details, cells, columns);
        const full = await rasterizeSvg(svg);
        const fullDimensions = getPngDimensions(full);
        expect(fullDimensions).toEqual({
          widthPx: layout.widthPx,
          heightPx: layout.heightCells * cells.heightPx,
        });
        expect(getPngDimensions(png)).toEqual({
          widthPx: layout.widthPx,
          heightPx: layout.heightCells * cells.heightPx,
        });
        // Keep the original viewBox/body (including density-scaled fonts); only pad the viewport.
        const logicalSvg = pieChartRenderer.renderSvg(details, theme, layout);
        expect(svg.slice(svg.indexOf(">") + 1)).toBe(logicalSvg.slice(logicalSvg.indexOf(">") + 1));
        expect(svg).toContain(`viewBox="0 0 ${layout.widthPx} ${layout.heightPx}"`);
        const baseline = new Image(
          full,
          "image/png",
          { fallbackColor: (text) => text },
          {
            maxWidthCells: columns,
            maxHeightCells: layout.heightCells,
          },
        ).render(width);
        const rendered = component.render(width);
        expect(placement(rendered)).toEqual(placement(baseline));
        expect(placement(rendered)).toEqual({ columns, rows: layout.heightCells });
        expect(rendered).toHaveLength(layout.heightCells);
      } finally {
        setCellDimensions({ widthPx: 9, heightPx: 18 });
      }
    },
  );

  test("leaves print SVG rasterization at full resolution", async () => {
    const layout = pieChartRenderer.getLayout(details, undefined, details.imageWidthCells);
    const png = await rasterizeSvg(renderChartSvg(pieChartRenderer, details, theme));
    expect(getPngDimensions(png)).toEqual({ widthPx: layout.widthPx, heightPx: layout.heightPx });
  });
});
