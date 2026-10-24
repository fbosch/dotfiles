import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { LazyChartComponent } from "./lazy";
import { loadChartRuntime } from "./loader";
import {
  type ChartDescriptor,
  type ChartTypeId,
  chartRegistry,
  chartTypeIds,
  isChartTypeId,
} from "./registry";
import {
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
  chartDonutParameters,
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
  hasBoundedTreemapHierarchy,
  type LineParameters,
} from "./schemas";
import type { ChartDetails } from "./types";
import type { LineChartInput } from "./types/line";

type ChartToolSpec<TParams extends TSchema> = {
  readonly label: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly parameters: TParams;
  /** Rejects input before the chart module loads, for checks the schema cannot express. */
  readonly preflight?: (parameters: unknown) => boolean;
  readonly toInput?: (parameters: Static<TParams>) => unknown;
};

function renderChartCall() {
  // Keep the self-shell empty until the async chart result has a stable height.
  return new Text("", 0, 0);
}

function replayChartType(fallback: ChartTypeId, details: unknown): ChartTypeId {
  if (!isRecord(details) || !isChartTypeId(details.type)) return fallback;
  return details.type;
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

function assertParameters(schema: TSchema, parameters: unknown, name: string): void {
  if (isRecord(parameters) && "type" in parameters) {
    const { type: _type, ...withoutType } = parameters;
    if (!Value.Check(schema, withoutType)) {
      throw new Error(`invalid ${name} chart parameters`);
    }
    return;
  }
  if (!Value.Check(schema, parameters)) {
    throw new Error(`invalid ${name} chart parameters`);
  }
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

// Registration closures keep each tool's concrete parameter and details types, which a union of tools loses.
const deferredRegistrations = new Map<ChartTypeId, (pi: ExtensionAPI) => void>();

function defineChartTool<TParams extends TSchema, TDetails extends ChartDetails>(
  type: ChartTypeId,
  descriptor: ChartDescriptor<TDetails>,
  spec: ChartToolSpec<TParams>,
): ToolDefinition<TParams, TDetails> {
  const name = type.replaceAll("_", " ");
  const tool: ToolDefinition<TParams, TDetails> = {
    name: `chart_${type}`,
    label: spec.label,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    parameters: spec.parameters,
    async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (spec.preflight?.(parameters) === false) {
        throw new Error(`invalid ${name} chart parameters`);
      }
      assertParameters(spec.parameters, parameters, name);
      const [runtime] = await Promise.all([loadChartRuntime(), descriptor.load()]);
      signal?.throwIfAborted();
      const input = spec.toInput?.(parameters) ?? { ...parameters, type };
      const chart = await descriptor.prepare(input, () =>
        runtime.createChartSettings(ctx.cwd, ctx.isProjectTrusted()),
      );
      if (chart === undefined) throw new Error(`invalid ${name} chart parameters`);
      const text = chart.summary;
      if (ctx.mode === "tui")
        return { content: [{ type: "text" as const, text }], details: chart.details };
      const png = await runtime.rasterizeSvg(chart.renderSvg(runtime, ctx.ui.theme), signal, {
        fontFamily: chart.settings.fontFamily,
      });
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details: chart.details,
      };
    },
    renderShell: "self",
    renderCall: renderChartCall,
    renderResult(result, _options, theme, context) {
      return renderChartResult(type, result, theme, context);
    },
  };
  deferredRegistrations.set(type, (pi) => pi.registerTool({ ...tool, exposure: "deferred" }));
  return tool;
}

const chartTools = {
  pie: defineChartTool("pie", chartRegistry.pie, {
    label: "Chart pie",
    description: "Render a compact pie chart from labeled nonnegative values.",
    promptSnippet: "Render compact pie charts",
    parameters: chartPieParameters,
  }),
  donut: defineChartTool("donut", chartRegistry.donut, {
    label: "Chart donut",
    description: "Render a compact donut chart from labeled nonnegative values.",
    promptSnippet: "Render compact donut charts",
    parameters: chartDonutParameters,
  }),
  bar: defineChartTool("bar", chartRegistry.bar, {
    label: "Chart bar",
    description: "Render a compact horizontal bar chart from labeled signed values.",
    promptSnippet: "Render compact horizontal bar charts",
    parameters: chartBarParameters,
  }),
  line: defineChartTool("line", chartRegistry.line, {
    label: "Chart line",
    description:
      "Render a single-series numeric or temporal line chart with optional gaps and markers.",
    promptSnippet: "Render single-series line charts",
    parameters: chartLineParameters,
    toInput: normalizeLineInput,
  }),
  scatter: defineChartTool("scatter", chartRegistry.scatter, {
    label: "Chart scatter",
    description:
      "Render a single-series scatter chart with fixed-size dots and optional point labels.",
    promptSnippet: "Render single-series scatter charts",
    parameters: chartScatterParameters,
  }),
  histogram: defineChartTool("histogram", chartRegistry.histogram, {
    label: "Chart histogram",
    description:
      "Render a count histogram from 1-200 finite numeric samples with automatic equal-width bins or an optional bin count (1-50). Optional title, xLabel, and yLabel (default Count).",
    promptSnippet: "Render count histograms from numeric samples",
    parameters: chartHistogramParameters,
  }),
  bezier: defineChartTool("bezier", chartRegistry.bezier, {
    label: "Chart bezier",
    description:
      "Render one exact cubic Bezier segment from start, control1, control2, and end x/y points (finite, ±1,000,000,000). Equal X/Y pixels per unit. Optional showControls (default false), title, xLabel, and yLabel. No sample interpolation.",
    promptSnippet: "Render exact cubic Bezier curves",
    parameters: chartBezierParameters,
  }),
  heatmap: defineChartTool("heatmap", chartRegistry.heatmap, {
    label: "Chart heatmap",
    description:
      "Render a labeled heatmap: rows and columns each contain 1-12 unique nonblank labels (1-22 characters, trimmed). Data is a matching rectangular number|null matrix (at most 144 cells), finite values ±1,000,000,000; null means missing, not zero. Optional colorScale sequential (default) or diverging (symmetric about zero), showValues (default false, at most 36 cells), title (1-80 characters). For readable output, prefer modest row/column counts and bounded value ranges; normalize or summarize extreme dynamic ranges. Includes a color legend and exact text summary.",
    promptSnippet: "Render labeled matrix heatmaps with explicit missing cells",
    parameters: chartHeatmapParameters,
  }),
  boxplot: defineChartTool("boxplot", chartRegistry.boxplot, {
    label: "Chart box plot",
    description:
      "Render horizontal box plots from groups of raw samples: 1-12 groups with unique trimmed nonblank labels (1-22 characters), each with 1-200 finite values within ±1,000,000,000. Type-7 quartiles, actual-sample whiskers within 1.5×IQR fences. Optional showOutliers (default true; hidden outliers retain the domain), title (1-80), xLabel and yLabel (1-40).",
    promptSnippet: "Render box plots comparing sample distributions",
    parameters: chartBoxplotParameters,
  }),
  waterfall: defineChartTool("waterfall", chartRegistry.waterfall, {
    label: "Chart waterfall",
    description:
      "Render a horizontal waterfall from start and 1-12 ordered deltas {label, value}. Labels are trimmed, nonblank, 1-22 characters. Start, signed deltas, and every running total must be finite within ±1,000,000,000. Final total is calculated. Blue increase and orange decrease bars with connectors and a semantic legend. Optional title (1-80), xLabel and yLabel (1-40).",
    promptSnippet: "Render cumulative changes as waterfall charts",
    parameters: chartWaterfallParameters,
  }),
  dumbbell: defineChartTool("dumbbell", chartRegistry.dumbbell, {
    label: "Chart dumbbell",
    description:
      "Render independent horizontal paired dots from data: 1-12 {label, before, after} rows. Unique trimmed nonblank labels (1-22 characters); finite coordinates ±1,000,000,000. Optional beforeLabel/afterLabel (1-22, defaults Before/After), showDifferences (default false; signed after - before, not percent), title (1-80), xLabel/yLabel (1-40). Blue Before ring and orange After dot, with a legend; colors identify series, not good/bad. Exact values remain in the text summary.",
    promptSnippet: "Render paired values as dumbbell charts",
    parameters: chartDumbbellParameters,
  }),
  stacked_bar: defineChartTool("stacked_bar", chartRegistry.stacked_bar, {
    label: "Chart stacked bar",
    description:
      "Render horizontal stacked bars for nonnegative composition: 1-12 unique trimmed categories and 1-6 uniquely named series {name, values}, each aligned with categories. Labels are 1-22 characters; values are finite 0..1,000,000,000 and category totals must be finite. Signed changes belong in chart_waterfall. Optional normalize (default false) displays 100% per nonzero category; zero totals stay zero. Includes every series in the legend and exact raw values/totals in the summary. Optional title (1-80), xLabel/yLabel (1-40); all text trimmed and nonblank.",
    promptSnippet: "Render nonnegative compositions as stacked bar charts",
    parameters: chartStackedBarParameters,
  }),
  treemap: defineChartTool("treemap", chartRegistry.treemap, {
    label: "Chart treemap",
    description:
      "Render hierarchical bundle, directory, or module sizes as area-proportional treemap tiles. Data is 1-6 top-level nodes, at most 64 nodes total and 4 levels. Each node has label (1-22 characters, trimmed and unique among siblings) and exactly one of finite nonnegative value or nonempty children. Parents aggregate children without double-counting; aggregate totals must be finite and at least one leaf positive. Top-level colors, fitted hierarchical labels and sizes, exact summary including hidden/zero leaves. For readable output, use short labels and balanced values; extreme value skew makes small tiles disappear. Optional title (1-80) and unit (1-22), trimmed and nonblank.",
    promptSnippet: "Render hierarchical sizes as treemaps",
    parameters: chartTreemapParameters,
    preflight: hasBoundedTreemapHierarchy,
  }),
  gantt: defineChartTool("gantt", chartRegistry.gantt, {
    label: "Chart Gantt",
    description:
      "Render a deterministic task timeline from 1-64 ordered tasks. Tasks have finite start/end values, optional groups and progress, optional dependencies, and named milestones. Uses TanStack interval marks with dependency overlays. For readable output, prefer about 16 tasks and modest milestone counts, especially with maxHeightCells. Optional title and xLabel.",
    promptSnippet: "Render deterministic Gantt task timelines",
    parameters: chartGanttParameters,
  }),
  network: defineChartTool("network", chartRegistry.network, {
    label: "Chart network",
    description:
      "Render a deterministic layered directed network or call graph from 1-64 nodes and up to 128 edges. Nodes have unique trimmed ids and labels, optional groups; edges reference node ids and may have labels. Multiple parents, disconnected nodes, cycles, self-loops, and duplicate display labels are supported. For readable output, prefer about 12 nodes and 25 edges or fewer; dense reciprocal or self-loop graphs can overlap, so use short labels or split the graph. Optional title and maxHeightCells (8-64 terminal cells); omitted maxHeightCells preserves the natural network height.",
    promptSnippet: "Render layered network and call-graph charts",
    parameters: chartNetworkParameters,
  }),
  tree: defineChartTool("tree", chartRegistry.tree, {
    label: "Chart tree",
    description:
      "Render a left-to-right tidy hierarchy tree from 1-64 flat parent-reference nodes. Each node has a unique trimmed id, optional parentId, and trimmed label. The data must form one connected acyclic hierarchy with exactly one root. For readable output, prefer about 32 nodes or fewer and split broad or deep hierarchies; use short labels. Optional title (1-80 characters).",
    promptSnippet: "Render tidy hierarchy trees from parent-reference nodes",
    parameters: chartTreeParameters,
  }),
} satisfies Record<ChartTypeId, unknown>;

type ChartTools = typeof chartTools;

export function createChartTool<K extends ChartTypeId>(type: K): ChartTools[K] {
  return chartTools[type];
}

export function registerChartTools(pi: ExtensionAPI): void {
  for (const type of chartTypeIds) {
    const register = deferredRegistrations.get(type);
    if (register === undefined) throw new Error(`chart tool ${type} was not defined`);
    register(pi);
  }
}
