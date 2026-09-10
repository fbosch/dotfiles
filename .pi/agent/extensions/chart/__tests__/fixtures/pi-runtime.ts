import assert from "node:assert/strict";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { getPngDimensions, setCapabilities, setCellDimensions } from "@earendil-works/pi-tui";
import chartExtension from "../../index";
import { loadChartRuntime, loadChartType } from "../../loader";
import type { ChartDetails, ChartLayout, ChartRenderer } from "../../types";
import { measureRedraw } from "./redraw";

export default function (pi: ExtensionAPI): void {
  chartExtension(pi);
  pi.registerCommand("chart-runtime-reload", {
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.on("session_start", async (event, ctx) => {
    try {
      const runtime = await loadChartRuntime();
      const cells = { widthPx: 16, heightPx: 38 };
      setCellDimensions(cells);
      setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
      async function check<T extends ChartDetails, L extends ChartLayout>(
        renderer: ChartRenderer<T, L>,
        details: T,
        theme: Theme,
      ): Promise<void> {
        const svg = runtime.renderChartSvg(renderer, details, theme);
        // Await the raw boundary too: ChartComponent deliberately catches raster failures.
        assert.ok(getPngDimensions(await runtime.rasterizeSvg(svg)));
        let redraw!: () => void;
        const ready = new Promise<void>((resolve) => {
          redraw = resolve;
        });
        const layout = renderer.getLayout(details, cells, details.imageWidthCells);
        let pngDimensions: ReturnType<typeof getPngDimensions> | undefined;
        const component = new runtime.ChartComponent(
          details,
          theme,
          redraw,
          renderer,
          async (source, signal, options) => {
            const png = await runtime.rasterizeSvg(source, signal, options);
            pngDimensions = getPngDimensions(png);
            return png;
          },
        );
        component.render(80);
        await ready;
        const lines = component.render(80).join("\n");
        assert.deepEqual(pngDimensions, {
          widthPx: layout.widthPx,
          heightPx: layout.heightCells * cells.heightPx,
        });
        assert.equal(Number(/(?:^|,)c=(\d+)/.exec(lines)?.[1]), details.imageWidthCells);
        assert.equal(Number(/(?:^|,)r=(\d+)/.exec(lines)?.[1]), layout.heightCells);
        assert.ok(!lines.includes(renderer.unavailableText), lines);
        for (const fullscreen of [false, true]) {
          const measurement = measureRedraw(component, fullscreen);
          console.log(
            "CHART_REDRAW",
            event.reason,
            renderer.renderingText,
            JSON.stringify(measurement),
          );
          assert.equal(measurement.initialTransmissions, 1);
          assert.equal(measurement.transmissions, 0, "input redraw retransmitted an unchanged PNG");
        }
      }
      const settings = { imageWidthCells: 60, fontFamily: "Zenbones Brainy", fontSize: 14 };
      const data = {
        rows: [
          { label: "A", value: 2 },
          { label: "B", value: 1 },
        ],
      };
      const { pieChartRenderer: pie } = await loadChartType("pie");
      const { barChartRenderer: bar } = await loadChartType("bar");
      await check(pie, pie.createDetails(data, settings), ctx.ui.theme);
      await check(bar, bar.createDetails(data, settings), ctx.ui.theme);
      const { histogramChartRenderer: histogram } = await loadChartType("histogram");
      assert.ok(pi.getActiveTools().includes("chart_histogram"));
      assert.ok(pi.getAllTools().some((tool) => tool.name === "chart_histogram"));
      await check(
        histogram,
        histogram.createDetails(
          histogram.parseParameters({
            type: "histogram",
            data: [-2, -1, 0, 0, 2],
            bins: 4,
            title: "Samples",
            xLabel: "Value",
          }),
          settings,
        ),
        ctx.ui.theme,
      );
      console.log(`CHART_RUNTIME_OK ${event.reason} ${process.execPath}`);
      if (event.reason === "reload") {
        runtime.shutdownRasterizer();
        process.exit(0);
      }
    } catch (error) {
      console.error("CHART_RUNTIME_ERROR", error);
      process.exit(1);
    }
  });
}
