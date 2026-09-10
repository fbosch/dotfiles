import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { LazyChartComponent } from "./lazy";
import { type ChartTypeId, loadChartRuntime, loadChartType } from "./loader";
import {
  type BarParameters,
  type BezierParameters,
  type BoxplotParameters,
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
  chartDumbbellParameters,
  chartHeatmapParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
  chartStackedBarParameters,
  chartTreemapParameters,
  chartWaterfallParameters,
  type DumbbellParameters,
  type HeatmapParameters,
  type HistogramParameters,
  hasBoundedTreemapHierarchy,
  type LineParameters,
  type PieParameters,
  type ScatterParameters,
  type StackedBarParameters,
  type TreemapParameters,
  type WaterfallParameters,
} from "./schemas";
import type { BarChartDetails, BarChartInput } from "./types/bar";
import type { BezierChartDetails, BezierChartInput } from "./types/bezier";
import type { BoxplotChartDetails, BoxplotChartInput } from "./types/boxplot";
import type { DumbbellChartDetails, DumbbellChartInput } from "./types/dumbbell";
import type { HeatmapChartDetails, HeatmapChartInput } from "./types/heatmap";
import type { HistogramChartDetails, HistogramChartInput } from "./types/histogram";
import type { LineChartDetails, LineChartInput } from "./types/line";
import type { PieChartDetails, PieChartInput } from "./types/pie";
import type { ScatterChartDetails, ScatterChartInput } from "./types/scatter";
import type { StackedBarChartDetails, StackedBarChartInput } from "./types/stacked-bar";
import type { TreemapChartDetails, TreemapChartInput } from "./types/treemap";
import type { WaterfallChartDetails, WaterfallChartInput } from "./types/waterfall";

export type {
  BarParameters,
  BezierParameters,
  BoxplotParameters,
  DumbbellParameters,
  HeatmapParameters,
  HistogramParameters,
  LineParameters,
  PieParameters,
  ScatterParameters,
  StackedBarParameters,
  TreemapParameters,
  WaterfallParameters,
} from "./schemas";
export {
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
  chartDumbbellParameters,
  chartHeatmapParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
  chartStackedBarParameters,
  chartTreemapParameters,
  chartWaterfallParameters,
} from "./schemas";

function renderChartCall() {
  // Keep the self-shell empty until the async chart result has a stable height.
  return new Text("", 0, 0);
}

function replayChartType(fallback: ChartTypeId, details: unknown): ChartTypeId {
  if (!isRecord(details) || typeof details.type !== "string") return fallback;
  return details.type === "pie" ||
    details.type === "bar" ||
    details.type === "line" ||
    details.type === "scatter" ||
    details.type === "histogram" ||
    details.type === "bezier" ||
    details.type === "heatmap" ||
    details.type === "boxplot" ||
    details.type === "waterfall" ||
    details.type === "dumbbell" ||
    details.type === "stacked_bar" ||
    details.type === "treemap"
    ? details.type
    : fallback;
}

function renderChartResult(
  type: ChartTypeId,
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  theme: Theme,
  context: { lastComponent?: unknown; invalidate: () => void },
): Component {
  if (result.details === undefined || result.details === null) {
    const text = result.content.find((content) => content.type === "text")?.text ?? "";
    return new Text(text, 0, 0);
  }
  const replayType = replayChartType(type, result.details);
  const previous = context.lastComponent;
  if (previous instanceof LazyChartComponent && previous.matches(replayType, result.details)) {
    previous.update(result.details, theme);
    return previous;
  }
  const fallbackText = result.content.find((content) => content.type === "text")?.text;
  return new LazyChartComponent({
    type: replayType,
    details: result.details,
    theme,
    requestRender: context.invalidate,
    ...(fallbackText === undefined ? {} : { fallbackText }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function withoutDiscriminator(value: unknown): unknown {
  if (!isRecord(value) || !("type" in value)) return value;
  const { type: _type, ...parameters } = value;
  return parameters;
}

function assertParameters(schema: TSchema, parameters: unknown, name: string): void {
  if (!Value.Check(schema, withoutDiscriminator(parameters))) {
    throw new Error(`invalid ${name} chart parameters`);
  }
}

export function createPieChartTool(): ToolDefinition<typeof chartPieParameters, PieChartDetails> {
  return {
    name: "chart_pie",
    label: "Chart pie",
    description: "Render a compact pie chart from labeled nonnegative values.",
    promptSnippet: "Render compact pie charts",
    parameters: chartPieParameters,
    async execute(_toolCallId, parameters: PieParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      assertParameters(chartPieParameters, parameters, "pie");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("pie")]);
      signal?.throwIfAborted();
      const input: PieChartInput = { ...parameters, type: "pie" };
      if (!Value.Check(module.pieChartVariant, input))
        throw new Error("invalid pie chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.pieChartRenderer.createDetails(
        module.pieChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.pieChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.pieChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("pie", result, theme, context);
    },
  };
}

export function createBarChartTool(): ToolDefinition<typeof chartBarParameters, BarChartDetails> {
  return {
    name: "chart_bar",
    label: "Chart bar",
    description: "Render a compact horizontal bar chart from labeled signed values.",
    promptSnippet: "Render compact horizontal bar charts",
    parameters: chartBarParameters,
    async execute(_toolCallId, parameters: BarParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      assertParameters(chartBarParameters, parameters, "bar");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("bar")]);
      signal?.throwIfAborted();
      const input: BarChartInput = { ...parameters, type: "bar" };
      if (!Value.Check(module.barChartVariant, input))
        throw new Error("invalid bar chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.barChartRenderer.createDetails(
        module.barChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.barChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.barChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("bar", result, theme, context);
    },
  };
}

function normalizeLineInput(parameters: LineParameters): LineChartInput {
  if (parameters.xType === "numeric") {
    const { data: rows, xType: _xType, ...options } = parameters;
    const data = rows.map((row) => {
      if (typeof row.x !== "number") throw new Error("invalid line chart parameters");
      return { x: row.x, y: row.y };
    });
    return { ...options, type: "line", xType: "numeric", data };
  }

  const { data: rows, xType: _xType, ...options } = parameters;
  const data = rows.map((row) => {
    if (typeof row.x !== "string") throw new Error("invalid line chart parameters");
    return { x: row.x, y: row.y };
  });
  return { ...options, type: "line", xType: "temporal", data };
}

export function createLineChartTool(): ToolDefinition<
  typeof chartLineParameters,
  LineChartDetails
> {
  return {
    name: "chart_line",
    label: "Chart line",
    description:
      "Render a single-series numeric or temporal line chart with optional gaps and markers.",
    promptSnippet: "Render single-series line charts",
    parameters: chartLineParameters,
    async execute(_toolCallId, parameters: LineParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      assertParameters(chartLineParameters, parameters, "line");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("line")]);
      signal?.throwIfAborted();
      const input = normalizeLineInput(parameters);
      if (!Value.Check(module.lineChartVariant, input))
        throw new Error("invalid line chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.lineChartRenderer.createDetails(
        module.lineChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.lineChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.lineChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("line", result, theme, context);
    },
  };
}

export function createScatterChartTool(): ToolDefinition<
  typeof chartScatterParameters,
  ScatterChartDetails
> {
  return {
    name: "chart_scatter",
    label: "Chart scatter",
    description:
      "Render a single-series scatter chart with fixed-size dots and optional point labels.",
    promptSnippet: "Render single-series scatter charts",
    parameters: chartScatterParameters,
    async execute(_toolCallId, parameters: ScatterParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      assertParameters(chartScatterParameters, parameters, "scatter");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("scatter")]);
      signal?.throwIfAborted();
      const input: ScatterChartInput = { ...parameters, type: "scatter" };
      if (!Value.Check(module.scatterChartVariant, input))
        throw new Error("invalid scatter chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.scatterChartRenderer.createDetails(
        module.scatterChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.scatterChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.scatterChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("scatter", result, theme, context);
    },
  };
}

export function createHistogramChartTool(): ToolDefinition<
  typeof chartHistogramParameters,
  HistogramChartDetails
> {
  return {
    name: "chart_histogram",
    label: "Chart histogram",
    description:
      "Render a count histogram from 1-200 finite numeric samples with automatic equal-width bins or an optional bin count (1-50). Optional title, xLabel, and yLabel (default Count).",
    promptSnippet: "Render count histograms from numeric samples",
    parameters: chartHistogramParameters,
    async execute(_toolCallId, parameters: HistogramParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartHistogramParameters, parameters))
        throw new Error("invalid histogram chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("histogram")]);
      signal?.throwIfAborted();
      const input: HistogramChartInput = { ...parameters, type: "histogram" };
      if (!Value.Check(module.histogramChartVariant, input))
        throw new Error("invalid histogram chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.histogramChartRenderer.createDetails(
        module.histogramChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.histogramChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.histogramChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("histogram", result, theme, context);
    },
  };
}

export function createBezierChartTool(): ToolDefinition<
  typeof chartBezierParameters,
  BezierChartDetails
> {
  return {
    name: "chart_bezier",
    label: "Chart bezier",
    description:
      "Render one exact cubic Bezier segment from start, control1, control2, and end x/y points (finite, ±1,000,000,000). Equal X/Y pixels per unit. Optional showControls (default false), title, xLabel, and yLabel. No sample interpolation.",
    promptSnippet: "Render exact cubic Bezier curves",
    parameters: chartBezierParameters,
    async execute(_toolCallId, parameters: BezierParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartBezierParameters, parameters))
        throw new Error("invalid bezier chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("bezier")]);
      signal?.throwIfAborted();
      const input: BezierChartInput = { ...parameters, type: "bezier" };
      if (!Value.Check(module.bezierChartVariant, input))
        throw new Error("invalid bezier chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.bezierChartRenderer.createDetails(
        module.bezierChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.bezierChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.bezierChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("bezier", result, theme, context);
    },
  };
}

export function createHeatmapChartTool(): ToolDefinition<
  typeof chartHeatmapParameters,
  HeatmapChartDetails
> {
  return {
    name: "chart_heatmap",
    label: "Chart heatmap",
    description:
      "Render a labeled heatmap: rows and columns each contain 1-12 unique nonblank labels (1-22 characters, trimmed). Data is a matching rectangular number|null matrix (at most 144 cells), finite values ±1,000,000,000; null means missing, not zero. Optional colorScale sequential (default) or diverging (symmetric about zero), showValues (default false, at most 36 cells), title (1-80 characters). Includes a color legend and exact text summary.",
    promptSnippet: "Render labeled matrix heatmaps with explicit missing cells",
    parameters: chartHeatmapParameters,
    async execute(_toolCallId, parameters: HeatmapParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartHeatmapParameters, parameters))
        throw new Error("invalid heatmap chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("heatmap")]);
      signal?.throwIfAborted();
      const input: HeatmapChartInput = { ...parameters, type: "heatmap" };
      if (!Value.Check(module.heatmapChartVariant, input))
        throw new Error("invalid heatmap chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.heatmapChartRenderer.createDetails(
        module.heatmapChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.heatmapChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.heatmapChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("heatmap", result, theme, context);
    },
  };
}

export function createBoxplotChartTool(): ToolDefinition<
  typeof chartBoxplotParameters,
  BoxplotChartDetails
> {
  return {
    name: "chart_boxplot",
    label: "Chart box plot",
    description:
      "Render horizontal box plots from groups of raw samples: 1-12 groups with unique trimmed nonblank labels (1-22 characters), each with 1-200 finite values within ±1,000,000,000. Type-7 quartiles, actual-sample whiskers within 1.5×IQR fences. Optional showOutliers (default true; hidden outliers retain the domain), title (1-80), xLabel and yLabel (1-40).",
    promptSnippet: "Render box plots comparing sample distributions",
    parameters: chartBoxplotParameters,
    async execute(_toolCallId, parameters: BoxplotParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartBoxplotParameters, parameters))
        throw new Error("invalid boxplot chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("boxplot")]);
      signal?.throwIfAborted();
      const input: BoxplotChartInput = { ...parameters, type: "boxplot" };
      if (!Value.Check(module.boxplotChartVariant, input))
        throw new Error("invalid boxplot chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.boxplotChartRenderer.createDetails(
        module.boxplotChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.boxplotChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.boxplotChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("boxplot", result, theme, context);
    },
  };
}

export function createWaterfallChartTool(): ToolDefinition<
  typeof chartWaterfallParameters,
  WaterfallChartDetails
> {
  return {
    name: "chart_waterfall",
    label: "Chart waterfall",
    description:
      "Render a horizontal waterfall from start and 1-12 ordered deltas {label, value}. Labels are trimmed, nonblank, 1-22 characters. Start, signed deltas, and every running total must be finite within ±1,000,000,000. Final total is calculated. Blue increase and orange decrease bars with connectors and a semantic legend. Optional title (1-80), xLabel and yLabel (1-40).",
    promptSnippet: "Render cumulative changes as waterfall charts",
    parameters: chartWaterfallParameters,
    async execute(_toolCallId, parameters: WaterfallParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartWaterfallParameters, parameters))
        throw new Error("invalid waterfall chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("waterfall")]);
      signal?.throwIfAborted();
      const input: WaterfallChartInput = { ...parameters, type: "waterfall" };
      if (!Value.Check(module.waterfallChartVariant, input))
        throw new Error("invalid waterfall chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.waterfallChartRenderer.createDetails(
        module.waterfallChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.waterfallChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.waterfallChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("waterfall", result, theme, context);
    },
  };
}

export function createDumbbellChartTool(): ToolDefinition<
  typeof chartDumbbellParameters,
  DumbbellChartDetails
> {
  return {
    name: "chart_dumbbell",
    label: "Chart dumbbell",
    description:
      "Render independent horizontal paired dots from data: 1-12 {label, before, after} rows. Unique trimmed nonblank labels (1-22 characters); finite coordinates ±1,000,000,000. Optional beforeLabel/afterLabel (1-22, defaults Before/After), showDifferences (default false; signed after - before, not percent), title (1-80), xLabel/yLabel (1-40). Blue Before ring and orange After dot, with a legend; colors identify series, not good/bad. Exact values remain in the text summary.",
    promptSnippet: "Render paired values as dumbbell charts",
    parameters: chartDumbbellParameters,
    async execute(_toolCallId, parameters: DumbbellParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartDumbbellParameters, parameters))
        throw new Error("invalid dumbbell chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("dumbbell")]);
      signal?.throwIfAborted();
      const input: DumbbellChartInput = { ...parameters, type: "dumbbell" };
      if (!Value.Check(module.dumbbellChartVariant, input))
        throw new Error("invalid dumbbell chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.dumbbellChartRenderer.createDetails(
        module.dumbbellChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.dumbbellChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.dumbbellChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("dumbbell", result, theme, context);
    },
  };
}

export function createStackedBarChartTool(): ToolDefinition<
  typeof chartStackedBarParameters,
  StackedBarChartDetails
> {
  return {
    name: "chart_stacked_bar",
    label: "Chart stacked bar",
    description:
      "Render horizontal stacked bars for nonnegative composition: 1-12 unique trimmed categories and 1-6 uniquely named series {name, values}, each aligned with categories. Labels are 1-22 characters; values are finite 0..1,000,000,000 and category totals must be finite. Signed changes belong in chart_waterfall. Optional normalize (default false) displays 100% per nonzero category; zero totals stay zero. Includes every series in the legend and exact raw values/totals in the summary. Optional title (1-80), xLabel/yLabel (1-40); all text trimmed and nonblank.",
    promptSnippet: "Render nonnegative compositions as stacked bar charts",
    parameters: chartStackedBarParameters,
    async execute(_toolCallId, parameters: StackedBarParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (!Value.Check(chartStackedBarParameters, parameters))
        throw new Error("invalid stacked bar chart parameters");
      const [runtime, module] = await Promise.all([
        loadChartRuntime(),
        loadChartType("stacked_bar"),
      ]);
      signal?.throwIfAborted();
      const input: StackedBarChartInput = { ...parameters, type: "stacked_bar" };
      if (!Value.Check(module.stackedBarChartVariant, input))
        throw new Error("invalid stacked bar chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.stackedBarChartRenderer.createDetails(
        module.stackedBarChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.stackedBarChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.stackedBarChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("stacked_bar", result, theme, context);
    },
  };
}

export function createTreemapChartTool(): ToolDefinition<
  typeof chartTreemapParameters,
  TreemapChartDetails
> {
  return {
    name: "chart_treemap",
    label: "Chart treemap",
    description:
      "Render hierarchical bundle, directory, or module sizes as area-proportional treemap tiles. Data is 1-6 top-level nodes, at most 64 nodes total and 4 levels. Each node has label (1-22 characters, trimmed and unique among siblings) and exactly one of finite nonnegative value or nonempty children. Parents aggregate children without double-counting; aggregate totals must be finite and at least one leaf positive. Top-level colors, fitted hierarchical labels and sizes, exact summary including hidden/zero leaves. Optional title (1-80) and unit (1-22), trimmed and nonblank.",
    promptSnippet: "Render hierarchical sizes as treemaps",
    parameters: chartTreemapParameters,
    async execute(_toolCallId, parameters: TreemapParameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (
        !hasBoundedTreemapHierarchy(parameters) ||
        !Value.Check(chartTreemapParameters, parameters)
      )
        throw new Error("invalid treemap chart parameters");
      const [runtime, module] = await Promise.all([loadChartRuntime(), loadChartType("treemap")]);
      signal?.throwIfAborted();
      const input: TreemapChartInput = { ...parameters, type: "treemap" };
      if (!Value.Check(module.treemapChartVariant, input))
        throw new Error("invalid treemap chart parameters");
      const settings = runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = module.treemapChartRenderer.createDetails(
        module.treemapChartRenderer.parseParameters(input),
        settings,
      );
      const text = module.treemapChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await runtime.rasterizeSvg(
        runtime.renderChartSvg(module.treemapChartRenderer, details, ctx.ui.theme),
        signal,
        { fontFamily: settings.fontFamily },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult("treemap", result, theme, context);
    },
  };
}

export function registerChartTools(pi: ExtensionAPI): void {
  pi.registerTool(createPieChartTool());
  pi.registerTool(createBarChartTool());
  pi.registerTool(createScatterChartTool());
  pi.registerTool(createLineChartTool());
  pi.registerTool(createHistogramChartTool());
  pi.registerTool(createBezierChartTool());
  pi.registerTool(createHeatmapChartTool());
  pi.registerTool(createBoxplotChartTool());
  pi.registerTool(createWaterfallChartTool());
  pi.registerTool(createDumbbellChartTool());
  pi.registerTool(createStackedBarChartTool());
  pi.registerTool(createTreemapChartTool());
}
