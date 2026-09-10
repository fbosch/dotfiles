import { describe, expect, test } from "bun:test";
import { Value } from "typebox/value";
import {
  type BarChartInput,
  type BoxplotChartInput,
  chartBarParameters,
  chartBoxplotParameters,
  chartDumbbellParameters,
  chartHeatmapParameters,
  chartLineParameters,
  chartScatterParameters,
  chartWaterfallParameters,
  type DumbbellChartInput,
  type HeatmapChartInput,
  type WaterfallChartInput,
} from "../schemas";
import { barChartRenderer, renderBarChartSvg } from "../types/bar";
import {
  boxplotChartRenderer,
  renderBoxplotChartSvg,
  validateBoxplotChartInput,
} from "../types/boxplot";
import {
  dumbbellChartRenderer,
  renderDumbbellChartSvg,
  validateDumbbellChartInput,
} from "../types/dumbbell";
import {
  heatmapChartRenderer,
  renderHeatmapChartSvg,
  validateHeatmapChartInput,
} from "../types/heatmap";
import { lineChartRenderer, renderLineChartSvg, validateLineChartInput } from "../types/line";
import {
  renderScatterChartSvg,
  scatterChartRenderer,
  validateScatterChartInput,
} from "../types/scatter";
import {
  renderWaterfallChartSvg,
  validateWaterfallChartInput,
  waterfallChartRenderer,
} from "../types/waterfall";

const theme = { getFgAnsi: () => "\u001b[38;2;187;187;187m" };
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };

describe("chart numeric formatting", () => {
  test("keeps defaults and bounds every public format option", () => {
    expect(
      Value.Check(chartBarParameters, {
        data: [
          { label: "A", value: 0.5 },
          { label: "B", value: 1 },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(chartBarParameters, {
        data: [
          { label: "A", value: 0.5 },
          { label: "B", value: 1 },
        ],
        valueFormat: "number",
      }),
    ).toBe(true);
    expect(
      Value.Check(chartBarParameters, {
        data: [
          { label: "A", value: 0.5 },
          { label: "B", value: 1 },
        ],
        valueFormat: "percent",
      }),
    ).toBe(true);
    for (const schema of [
      chartBoxplotParameters,
      chartWaterfallParameters,
      chartDumbbellParameters,
      chartHeatmapParameters,
    ]) {
      expect(Value.Check(schema, {})).toBe(false);
    }
    const numericLine = {
      xType: "numeric",
      data: [
        { x: 0, y: 0.5 },
        { x: 1, y: 1 },
      ],
      xFormat: "percent",
      yFormat: "number",
    } as const;
    expect(Value.Check(chartLineParameters, numericLine)).toBe(true);
    expect(Value.Check(chartLineParameters, { ...numericLine, xFormat: "other" })).toBe(false);
    const temporalLine = {
      xType: "temporal",
      data: [
        { x: "2024-01-01", y: 0.5 },
        { x: "2024-01-02", y: 1 },
      ],
      yFormat: "percent",
    } as const;
    expect(Value.Check(chartLineParameters, temporalLine)).toBe(true);
    expect(Value.Check(chartLineParameters, { ...temporalLine, xFormat: "percent" })).toBe(false);
    expect(
      Value.Check(chartScatterParameters, {
        data: [
          { x: 0.5, y: 0.25 },
          { x: 1, y: 1 },
        ],
        xFormat: "percent",
        yFormat: "percent",
      }),
    ).toBe(true);
  });

  test("formats numeric line and scatter axes as percentages", () => {
    const line = lineChartRenderer.createDetails(
      validateLineChartInput({
        type: "line",
        xType: "numeric",
        xFormat: "percent",
        yFormat: "percent",
        data: [
          { x: 0.25, y: 0.5 },
          { x: 1, y: 1 },
        ],
      }),
      settings,
    );
    const lineSvg = renderLineChartSvg(line, theme);
    expect(lineSvg).toContain(">40%<");
    expect(lineSvg).toContain(">50%<");
    const scatter = scatterChartRenderer.createDetails(
      validateScatterChartInput({
        type: "scatter",
        xFormat: "percent",
        yFormat: "percent",
        data: [
          { x: 0.25, y: 0.5 },
          { x: 1, y: 1 },
        ],
      }),
      settings,
    );
    const scatterSvg = renderScatterChartSvg(scatter, theme);
    expect(scatterSvg).toContain(">40%<");
    expect(scatterSvg).toContain(">50%<");
    expect(
      renderLineChartSvg(
        lineChartRenderer.createDetails(
          validateLineChartInput({
            type: "line",
            xType: "temporal",
            yFormat: "percent",
            data: [
              { x: "2024-01-01", y: 0.5 },
              { x: "2024-01-02", y: 1 },
            ],
          }),
          settings,
        ),
        theme,
      ),
    ).toContain(">50%<");
  });

  test("formats visible values and ticks while preserving raw summaries and replay", () => {
    const barInput: BarChartInput = {
      type: "bar",
      valueFormat: "percent",
      data: [
        { label: "A", value: 0.25 },
        { label: "B", value: 0.5 },
      ],
    };
    const bar = barChartRenderer.createDetails(
      barChartRenderer.parseParameters(barInput),
      settings,
    );
    expect(
      renderBarChartSvg(bar.rows, theme, undefined, undefined, undefined, bar.valueFormat),
    ).toContain("A: 25%");
    expect(barChartRenderer.deserializeDetails(JSON.parse(JSON.stringify(bar)))).toEqual(bar);

    const boxInput: BoxplotChartInput = {
      type: "boxplot",
      valueFormat: "percent",
      groups: [{ label: "A", values: [0.25, 0.5] }],
    };
    const box = boxplotChartRenderer.createDetails(validateBoxplotChartInput(boxInput), settings);
    expect(renderBoxplotChartSvg(box, theme)).toContain(">23.7%<");
    expect(boxplotChartRenderer.deserializeDetails(JSON.parse(JSON.stringify(box)))).toEqual(box);

    const waterfallInput: WaterfallChartInput = {
      type: "waterfall",
      valueFormat: "percent",
      start: 0.25,
      deltas: [{ label: "A", value: 0.5 }],
    };
    const waterfall = waterfallChartRenderer.createDetails(
      validateWaterfallChartInput(waterfallInput),
      settings,
    );
    expect(renderWaterfallChartSvg(waterfall, theme)).toContain(">37.5%<");
    expect(
      waterfallChartRenderer.deserializeDetails(JSON.parse(JSON.stringify(waterfall))),
    ).toEqual(waterfall);

    const dumbbellInput: DumbbellChartInput = {
      type: "dumbbell",
      valueFormat: "percent",
      showDifferences: true,
      data: [{ label: "A", before: 0.25, after: 0.5 }],
    };
    const dumbbell = dumbbellChartRenderer.createDetails(
      validateDumbbellChartInput(dumbbellInput),
      settings,
    );
    expect(renderDumbbellChartSvg(dumbbell, theme)).toContain("Δ +25%");
    expect(dumbbellChartRenderer.deserializeDetails(JSON.parse(JSON.stringify(dumbbell)))).toEqual(
      dumbbell,
    );

    const heatmapInput: HeatmapChartInput = {
      type: "heatmap",
      valueFormat: "percent",
      showValues: true,
      rows: ["A"],
      columns: ["X", "Y"],
      data: [[0.25, 0.5]],
    };
    const heatmap = heatmapChartRenderer.createDetails(
      validateHeatmapChartInput(heatmapInput),
      settings,
    );
    expect(renderHeatmapChartSvg(heatmap, theme)).toContain("25%");
    expect(heatmapChartRenderer.deserializeDetails(JSON.parse(JSON.stringify(heatmap)))).toEqual(
      heatmap,
    );
  });
});
