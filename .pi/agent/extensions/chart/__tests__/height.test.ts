import { describe, expect, test } from "bun:test";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
  chartDumbbellParameters,
  chartGanttParameters,
  chartHeatmapParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartNetworkParameters,
  chartPieParameters,
  chartScatterParameters,
  chartStackedBarParameters,
  chartTreemapParameters,
  chartTreeParameters,
  chartWaterfallParameters,
} from "../schemas";
import type { ChartDetails, ChartLayout } from "../types";
import { barChartRenderer } from "../types/bar";
import { bezierChartRenderer } from "../types/bezier";
import { boxplotChartRenderer } from "../types/boxplot";
import { dumbbellChartRenderer } from "../types/dumbbell";
import { ganttChartRenderer } from "../types/gantt";
import { heatmapChartRenderer } from "../types/heatmap";
import { histogramChartRenderer } from "../types/histogram";
import { lineChartRenderer } from "../types/line";
import { networkChartRenderer } from "../types/network";
import { pieChartRenderer } from "../types/pie";
import { scatterChartRenderer } from "../types/scatter";
import { stackedBarChartRenderer } from "../types/stacked-bar";
import { treeChartRenderer } from "../types/tree";
import { treemapChartRenderer } from "../types/treemap";
import { waterfallChartRenderer } from "../types/waterfall";

const cells = { widthPx: 9, heightPx: 18 };
const settings = { imageWidthCells: 60, fontFamily: "sans-serif" };
const requestedHeight = 8;

type HeightCase = {
  name: string;
  schema: TSchema;
  input: object;
  build: () => { details: ChartDetails; layout: ChartLayout };
  deserialize: (value: unknown) => ChartDetails | undefined;
};

const pieInput = {
  type: "pie" as const,
  data: [
    { label: "A", value: 1 },
    { label: "B", value: 2 },
  ],
};
const barInput = {
  type: "bar" as const,
  data: [
    { label: "A", value: -1 },
    { label: "B", value: 2 },
  ],
};
const lineInput = {
  type: "line" as const,
  xType: "numeric" as const,
  data: [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ],
};
const scatterInput = {
  type: "scatter" as const,
  data: [
    { x: 0, y: 1 },
    { x: 1, y: 2 },
  ],
};
const histogramInput = { type: "histogram" as const, data: [1, 2, 3] };
const bezierInput = {
  type: "bezier" as const,
  start: { x: 0, y: 0 },
  control1: { x: 1, y: 2 },
  control2: { x: 2, y: 2 },
  end: { x: 3, y: 0 },
};
const heatmapInput = { type: "heatmap" as const, rows: ["A"], columns: ["B"], data: [[1]] };
const boxplotInput = { type: "boxplot" as const, groups: [{ label: "A", values: [1, 2, 3] }] };
const waterfallInput = { type: "waterfall" as const, start: 0, deltas: [{ label: "A", value: 1 }] };
const dumbbellInput = {
  type: "dumbbell" as const,
  data: [{ label: "A", before: 1, after: 2 }],
};
const stackedBarInput = {
  type: "stacked_bar" as const,
  categories: ["A"],
  series: [{ name: "S", values: [1] }],
};
const treemapInput = { type: "treemap" as const, data: [{ label: "A", value: 1 }] };
const treeInput = { type: "tree" as const, data: [{ id: "root", parentId: null, label: "Root" }] };
const ganttInput = {
  type: "gantt" as const,
  tasks: [{ id: "task", label: "Task", start: 0, end: 1 }],
};
const networkInput = {
  type: "network" as const,
  nodes: [{ id: "root", label: "Root" }],
  edges: [],
};

const heightCases: HeightCase[] = [
  {
    name: "pie",
    schema: chartPieParameters,
    input: pieInput,
    build: () => {
      const data = pieChartRenderer.parseParameters({
        ...pieInput,
        maxHeightCells: requestedHeight,
      });
      const details = pieChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: pieChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: pieChartRenderer.deserializeDetails,
  },
  {
    name: "bar",
    schema: chartBarParameters,
    input: barInput,
    build: () => {
      const data = barChartRenderer.parseParameters({
        ...barInput,
        maxHeightCells: requestedHeight,
      });
      const details = barChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: barChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: barChartRenderer.deserializeDetails,
  },
  {
    name: "line",
    schema: chartLineParameters,
    input: lineInput,
    build: () => {
      const data = lineChartRenderer.parseParameters({
        ...lineInput,
        maxHeightCells: requestedHeight,
      });
      const details = lineChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: lineChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: lineChartRenderer.deserializeDetails,
  },
  {
    name: "scatter",
    schema: chartScatterParameters,
    input: scatterInput,
    build: () => {
      const data = scatterChartRenderer.parseParameters({
        ...scatterInput,
        maxHeightCells: requestedHeight,
      });
      const details = scatterChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: scatterChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: scatterChartRenderer.deserializeDetails,
  },
  {
    name: "histogram",
    schema: chartHistogramParameters,
    input: histogramInput,
    build: () => {
      const data = histogramChartRenderer.parseParameters({
        ...histogramInput,
        maxHeightCells: requestedHeight,
      });
      const details = histogramChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: histogramChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: histogramChartRenderer.deserializeDetails,
  },
  {
    name: "bezier",
    schema: chartBezierParameters,
    input: bezierInput,
    build: () => {
      const data = bezierChartRenderer.parseParameters({
        ...bezierInput,
        maxHeightCells: requestedHeight,
      });
      const details = bezierChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: bezierChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: bezierChartRenderer.deserializeDetails,
  },
  {
    name: "heatmap",
    schema: chartHeatmapParameters,
    input: heatmapInput,
    build: () => {
      const data = heatmapChartRenderer.parseParameters({
        ...heatmapInput,
        maxHeightCells: requestedHeight,
      });
      const details = heatmapChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: heatmapChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: heatmapChartRenderer.deserializeDetails,
  },
  {
    name: "boxplot",
    schema: chartBoxplotParameters,
    input: boxplotInput,
    build: () => {
      const data = boxplotChartRenderer.parseParameters({
        ...boxplotInput,
        maxHeightCells: requestedHeight,
      });
      const details = boxplotChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: boxplotChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: boxplotChartRenderer.deserializeDetails,
  },
  {
    name: "waterfall",
    schema: chartWaterfallParameters,
    input: waterfallInput,
    build: () => {
      const data = waterfallChartRenderer.parseParameters({
        ...waterfallInput,
        maxHeightCells: requestedHeight,
      });
      const details = waterfallChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: waterfallChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: waterfallChartRenderer.deserializeDetails,
  },
  {
    name: "dumbbell",
    schema: chartDumbbellParameters,
    input: dumbbellInput,
    build: () => {
      const data = dumbbellChartRenderer.parseParameters({
        ...dumbbellInput,
        maxHeightCells: requestedHeight,
      });
      const details = dumbbellChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: dumbbellChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: dumbbellChartRenderer.deserializeDetails,
  },
  {
    name: "stacked bar",
    schema: chartStackedBarParameters,
    input: stackedBarInput,
    build: () => {
      const data = stackedBarChartRenderer.parseParameters({
        ...stackedBarInput,
        maxHeightCells: requestedHeight,
      });
      const details = stackedBarChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: stackedBarChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: stackedBarChartRenderer.deserializeDetails,
  },
  {
    name: "treemap",
    schema: chartTreemapParameters,
    input: treemapInput,
    build: () => {
      const data = treemapChartRenderer.parseParameters({
        ...treemapInput,
        maxHeightCells: requestedHeight,
      });
      const details = treemapChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: treemapChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: treemapChartRenderer.deserializeDetails,
  },
  {
    name: "tree",
    schema: chartTreeParameters,
    input: treeInput,
    build: () => {
      const data = treeChartRenderer.parseParameters({
        ...treeInput,
        maxHeightCells: requestedHeight,
      });
      const details = treeChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: treeChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: treeChartRenderer.deserializeDetails,
  },
  {
    name: "gantt",
    schema: chartGanttParameters,
    input: ganttInput,
    build: () => {
      const data = ganttChartRenderer.parseParameters({
        ...ganttInput,
        maxHeightCells: requestedHeight,
      });
      const details = ganttChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: ganttChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: ganttChartRenderer.deserializeDetails,
  },
  {
    name: "network",
    schema: chartNetworkParameters,
    input: networkInput,
    build: () => {
      const data = networkChartRenderer.parseParameters({
        ...networkInput,
        maxHeightCells: requestedHeight,
      });
      const details = networkChartRenderer.createDetails(data, settings);
      return {
        details,
        layout: networkChartRenderer.getLayout(details, cells, settings.imageWidthCells),
      };
    },
    deserialize: networkChartRenderer.deserializeDetails,
  },
];

function withoutType(input: object): object {
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "type"));
}

describe("chart height option", () => {
  test("uses one bounded option in every public chart schema", () => {
    for (const chart of heightCases) {
      expect(Value.Check(chart.schema, { ...withoutType(chart.input), maxHeightCells: 8 })).toBe(
        true,
      );
      expect(Value.Check(chart.schema, { ...withoutType(chart.input), maxHeightCells: 64 })).toBe(
        true,
      );
      expect(Value.Check(chart.schema, { ...withoutType(chart.input), maxHeightCells: 7 })).toBe(
        false,
      );
      expect(Value.Check(chart.schema, { ...withoutType(chart.input), maxHeightCells: 65 })).toBe(
        false,
      );
      expect(Value.Check(chart.schema, { ...withoutType(chart.input), maxHeightCells: 8.5 })).toBe(
        false,
      );
    }
  });

  test("preserves the option through details and caps every rendered layout", () => {
    for (const chart of heightCases) {
      const { details, layout } = chart.build();
      expect(details.maxHeightCells, chart.name).toBe(requestedHeight);
      expect(layout.heightCells, chart.name).toBeLessThanOrEqual(requestedHeight);
      expect(layout.heightPx, chart.name).toBeLessThanOrEqual(requestedHeight * cells.heightPx);
    }
  });

  test("preserves valid replay values and rejects invalid replay values", () => {
    for (const chart of heightCases) {
      const { details } = chart.build();
      expect(
        chart.deserialize({ ...details, maxHeightCells: 64 })?.maxHeightCells,
        chart.name,
      ).toBe(64);
      expect(chart.deserialize({ ...details, maxHeightCells: 7 }), chart.name).toBeUndefined();
      expect(chart.deserialize({ ...details, maxHeightCells: 65 }), chart.name).toBeUndefined();
    }
  });
});
