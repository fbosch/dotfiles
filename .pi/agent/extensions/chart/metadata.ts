import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { LazyChartComponent } from "./lazy";
import { type ChartTypeId, loadChartRuntime, loadChartType } from "./loader";
import {
  type BarParameters,
  type BezierParameters,
  chartBarParameters,
  chartBezierParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
  type HistogramParameters,
  type LineParameters,
  type PieParameters,
  type ScatterParameters,
} from "./schemas";
import type { BarChartDetails, BarChartInput } from "./types/bar";
import type { BezierChartDetails, BezierChartInput } from "./types/bezier";
import type { HistogramChartDetails, HistogramChartInput } from "./types/histogram";
import type { LineChartDetails, LineChartInput } from "./types/line";
import type { PieChartDetails, PieChartInput } from "./types/pie";
import type { ScatterChartDetails, ScatterChartInput } from "./types/scatter";

export type {
  BarParameters,
  BezierParameters,
  HistogramParameters,
  LineParameters,
  PieParameters,
  ScatterParameters,
} from "./schemas";
export {
  chartBarParameters,
  chartBezierParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
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
    details.type === "bezier"
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

export function registerChartTools(pi: ExtensionAPI): void {
  pi.registerTool(createPieChartTool());
  pi.registerTool(createBarChartTool());
  pi.registerTool(createScatterChartTool());
  pi.registerTool(createLineChartTool());
  pi.registerTool(createHistogramChartTool());
  pi.registerTool(createBezierChartTool());
}
