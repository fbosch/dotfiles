import { type Static, Type } from "typebox";

export const MAX_SLICES = 12;
export const MAX_BARS = 12;
export const MAX_ROWS = 200;
export const MAX_LABEL_LENGTH = 22;
export const MAX_POINT_LABEL_LENGTH = 40;
export const MAX_TITLE_LENGTH = 80;
export const MAX_AXIS_LABEL_LENGTH = 40;

export const numericFormat = Type.Union(
  [Type.Literal("number"), Type.Literal("percent")],
  { description: '"number" preserves the current numeric labels; "percent" formats fractional values as percentages.' },
);
export type NumericFormat = Static<typeof numericFormat>;

const chartTitle = Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH }));
const axisLabels = {
  xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
  yLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
} as const;

export const MIN_CHART_HEIGHT_CELLS = 8;
export const MAX_REQUESTED_CHART_HEIGHT_CELLS = 64;
const chartHeightOptions = {
  maxHeightCells: Type.Optional(
    Type.Integer({
      minimum: MIN_CHART_HEIGHT_CELLS,
      maximum: MAX_REQUESTED_CHART_HEIGHT_CELLS,
      description:
        "Maximum rendered height in terminal cells; omitted keeps the renderer's existing default sizing.",
    }),
  ),
} as const;

const pieData = Type.Array(
  Type.Object(
    {
      label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      value: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
    },
    { additionalProperties: false },
  ),
  { minItems: 2, maxItems: MAX_SLICES },
);

const barData = Type.Array(
  Type.Object(
    {
      label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      value: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
    },
    { additionalProperties: false },
  ),
  { minItems: 2, maxItems: MAX_BARS },
);

const numericLineData = Type.Array(
  Type.Object(
    { x: Type.Number(), y: Type.Union([Type.Number(), Type.Null()]) },
    { additionalProperties: false },
  ),
  { minItems: 2, maxItems: MAX_ROWS },
);

const temporalLineData = Type.Array(
  Type.Object(
    { x: Type.String(), y: Type.Union([Type.Number(), Type.Null()]) },
    { additionalProperties: false },
  ),
  { minItems: 2, maxItems: MAX_ROWS },
);

const scatterData = Type.Array(
  Type.Object(
    {
      x: Type.Number(),
      y: Type.Number(),
      label: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_POINT_LABEL_LENGTH })),
    },
    { additionalProperties: false },
  ),
  { minItems: 2, maxItems: MAX_ROWS },
);

const lineOptions = {
  title: chartTitle,
  ...axisLabels,
  markers: Type.Optional(Type.Boolean()),
  ...chartHeightOptions,
} as const;

const numericLineFormatOptions = {
  xFormat: Type.Optional(numericFormat),
  yFormat: Type.Optional(numericFormat),
} as const;

const temporalLineFormatOptions = {
  yFormat: Type.Optional(numericFormat),
} as const;

/** Public provider schemas intentionally omit the internal chart discriminator. */
export const chartPieParameters = Type.Object(
  { data: pieData, title: chartTitle, ...chartHeightOptions },
  { additionalProperties: false },
);

export const chartBarParameters = Type.Object(
  {
    data: barData,
    title: chartTitle,
    valueFormat: Type.Optional(numericFormat),
    ...chartHeightOptions,
  },
  { additionalProperties: false },
);

export const chartScatterParameters = Type.Object(
  {
    data: scatterData,
    title: chartTitle,
    ...axisLabels,
    xFormat: Type.Optional(numericFormat),
    yFormat: Type.Optional(numericFormat),
    ...chartHeightOptions,
  },
  { additionalProperties: false },
);

export const chartLineParameters = Type.Union([
  Type.Object(
    {
      xType: Type.Literal("numeric"),
      data: numericLineData,
      ...lineOptions,
      ...numericLineFormatOptions,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      xType: Type.Literal("temporal"),
      data: temporalLineData,
      ...lineOptions,
      ...temporalLineFormatOptions,
    },
    { additionalProperties: false },
  ),
]);

export const numericLineChartVariant = Type.Object(
  {
    type: Type.Literal("line"),
    xType: Type.Literal("numeric"),
    data: numericLineData,
    ...lineOptions,
    ...numericLineFormatOptions,
  },
  { additionalProperties: false },
);

export const temporalLineChartVariant = Type.Object(
  {
    type: Type.Literal("line"),
    xType: Type.Literal("temporal"),
    data: temporalLineData,
    ...lineOptions,
    ...temporalLineFormatOptions,
  },
  { additionalProperties: false },
);

export const lineChartVariant = Type.Union([numericLineChartVariant, temporalLineChartVariant]);

export const pieChartVariant = Type.Object(
  { type: Type.Literal("pie"), data: pieData, title: chartTitle, ...chartHeightOptions },
  { additionalProperties: false },
);

export const barChartVariant = Type.Object(
  {
    type: Type.Literal("bar"),
    data: barData,
    title: chartTitle,
    valueFormat: Type.Optional(numericFormat),
    ...chartHeightOptions,
  },
  { additionalProperties: false },
);

export const scatterChartVariant = Type.Object(
  {
    type: Type.Literal("scatter"),
    data: scatterData,
    title: chartTitle,
    ...axisLabels,
    xFormat: Type.Optional(numericFormat),
    yFormat: Type.Optional(numericFormat),
    ...chartHeightOptions,
  },
  { additionalProperties: false },
);

export type PieParameters = Static<typeof chartPieParameters>;
export type BarParameters = Static<typeof chartBarParameters>;
export type LineParameters = Static<typeof chartLineParameters>;
export type ScatterParameters = Static<typeof chartScatterParameters>;

export type PieChartInput = Static<typeof pieChartVariant>;
export type BarChartInput = Static<typeof barChartVariant>;
export type NumericLineChartInput = Static<typeof numericLineChartVariant>;
export type TemporalLineChartInput = Static<typeof temporalLineChartVariant>;
export type LineChartInput = Static<typeof lineChartVariant>;
export type ScatterChartInput = Static<typeof scatterChartVariant>;

export const MAX_HISTOGRAM_SAMPLES = 200;
export const MAX_HISTOGRAM_BINS = 50;
const histogramOptions = {
  data: Type.Array(Type.Number(), { minItems: 1, maxItems: MAX_HISTOGRAM_SAMPLES }),
  bins: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_HISTOGRAM_BINS,
      description:
        "Equal-width bin count; defaults to ceil(sqrt(sample count)). Constant samples use one bin.",
    }),
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartHistogramParameters = Type.Object(histogramOptions, {
  additionalProperties: false,
});
export const histogramChartVariant = Type.Object(
  { type: Type.Literal("histogram"), ...histogramOptions },
  { additionalProperties: false },
);
export type HistogramParameters = Static<typeof chartHistogramParameters>;
export type HistogramChartInput = Static<typeof histogramChartVariant>;

const bezierPoint = Type.Object(
  {
    x: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
    y: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
  },
  { additionalProperties: false },
);
const bezierOptions = {
  start: bezierPoint,
  control1: bezierPoint,
  control2: bezierPoint,
  end: bezierPoint,
  showControls: Type.Optional(
    Type.Boolean({
      description: "Show control-point markers and connecting guides; defaults to false.",
    }),
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartBezierParameters = Type.Object(bezierOptions, { additionalProperties: false });
export const bezierChartVariant = Type.Object(
  { type: Type.Literal("bezier"), ...bezierOptions },
  { additionalProperties: false },
);
export type BezierParameters = Static<typeof chartBezierParameters>;
export type BezierChartInput = Static<typeof bezierChartVariant>;

export const MAX_HEATMAP_SIZE = 12;
export const MAX_HEATMAP_VALUE = 1_000_000_000;
export const MAX_HEATMAP_VALUE_CELLS = 36;
const heatmapLabels = Type.Array(
  Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
  { minItems: 1, maxItems: MAX_HEATMAP_SIZE, uniqueItems: true },
);
const heatmapOptions = {
  valueFormat: Type.Optional(numericFormat),
  rows: heatmapLabels,
  columns: heatmapLabels,
  data: Type.Array(
    Type.Array(
      Type.Union([
        Type.Number({ minimum: -MAX_HEATMAP_VALUE, maximum: MAX_HEATMAP_VALUE }),
        Type.Null(),
      ]),
      { minItems: 1, maxItems: MAX_HEATMAP_SIZE },
    ),
    { minItems: 1, maxItems: MAX_HEATMAP_SIZE },
  ),
  colorScale: Type.Optional(
    Type.Union([Type.Literal("sequential"), Type.Literal("diverging")], {
      description:
        "Sequential (default): observed min to max. Diverging: symmetric about zero. Null is missing, never zero.",
    }),
  ),
  showValues: Type.Optional(
    Type.Boolean({
      description:
        "Default false. Allowed for at most 36 cells; values are abbreviated and omitted when cells are too narrow.",
    }),
  ),
  title: chartTitle,
  ...chartHeightOptions,
};
export const chartHeatmapParameters = Type.Object(heatmapOptions, { additionalProperties: false });
export const heatmapChartVariant = Type.Object(
  { type: Type.Literal("heatmap"), ...heatmapOptions },
  { additionalProperties: false },
);
export type HeatmapParameters = Static<typeof chartHeatmapParameters>;
export type HeatmapChartInput = Static<typeof heatmapChartVariant>;

const boxplotOptions = {
  valueFormat: Type.Optional(numericFormat),
  groups: Type.Array(
    Type.Object(
      {
        label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
        values: Type.Array(Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }), {
          minItems: 1,
          maxItems: 200,
        }),
      },
      { additionalProperties: false },
    ),
    { minItems: 1, maxItems: 12 },
  ),
  showOutliers: Type.Optional(
    Type.Boolean({
      description:
        "Show outlier dots (default true). Hidden outliers still affect the axis domain.",
    }),
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartBoxplotParameters = Type.Object(boxplotOptions, { additionalProperties: false });
export const boxplotChartVariant = Type.Object(
  { type: Type.Literal("boxplot"), ...boxplotOptions },
  { additionalProperties: false },
);
export type BoxplotParameters = Static<typeof chartBoxplotParameters>;
export type BoxplotChartInput = Static<typeof boxplotChartVariant>;

export const MAX_WATERFALL_VALUE = 1_000_000_000;
const waterfallOptions = {
  valueFormat: Type.Optional(numericFormat),
  start: Type.Number({ minimum: -MAX_WATERFALL_VALUE, maximum: MAX_WATERFALL_VALUE }),
  deltas: Type.Array(
    Type.Object(
      {
        label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
        value: Type.Number({ minimum: -MAX_WATERFALL_VALUE, maximum: MAX_WATERFALL_VALUE }),
      },
      { additionalProperties: false },
    ),
    { minItems: 1, maxItems: 12 },
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartWaterfallParameters = Type.Object(waterfallOptions, {
  additionalProperties: false,
});
export const waterfallChartVariant = Type.Object(
  { type: Type.Literal("waterfall"), ...waterfallOptions },
  { additionalProperties: false },
);
export type WaterfallParameters = Static<typeof chartWaterfallParameters>;
export type WaterfallChartInput = Static<typeof waterfallChartVariant>;

const dumbbellOptions = {
  valueFormat: Type.Optional(numericFormat),
  data: Type.Array(
    Type.Object(
      {
        label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
        before: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
        after: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
      },
      { additionalProperties: false },
    ),
    { minItems: 1, maxItems: 12 },
  ),
  beforeLabel: Type.Optional(
    Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
  ),
  afterLabel: Type.Optional(
    Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
  ),
  showDifferences: Type.Optional(
    Type.Boolean({
      description: "Show signed after - before differences; valueFormat percent displays percentage-point changes; default false.",
    }),
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartDumbbellParameters = Type.Object(dumbbellOptions, {
  additionalProperties: false,
});
export const dumbbellChartVariant = Type.Object(
  { type: Type.Literal("dumbbell"), ...dumbbellOptions },
  { additionalProperties: false },
);
export type DumbbellParameters = Static<typeof chartDumbbellParameters>;
export type DumbbellChartInput = Static<typeof dumbbellChartVariant>;

const stackedBarOptions = {
  categories: Type.Array(
    Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
    {
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      description: "Unique nonblank category labels after trimming; displayed top to bottom.",
    },
  ),
  series: Type.Array(
    Type.Object(
      {
        name: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" }),
        values: Type.Array(Type.Number({ minimum: 0, maximum: 1_000_000_000 }), {
          minItems: 1,
          maxItems: 12,
          description:
            "Finite nonnegative composition values aligned with categories. Signed changes are not supported; use chart_waterfall for those.",
        }),
      },
      { additionalProperties: false },
    ),
    {
      minItems: 1,
      maxItems: 6,
      description: "Unique names after trimming; input order determines stack and legend order.",
    },
  ),
  normalize: Type.Optional(
    Type.Boolean({
      description:
        "Default false. True displays each nonzero category total as 100%; zero totals stay zero. Raw values and totals remain in the summary.",
    }),
  ),
  title: chartTitle,
  ...axisLabels,
  ...chartHeightOptions,
};
export const chartStackedBarParameters = Type.Object(stackedBarOptions, {
  additionalProperties: false,
});
export const stackedBarChartVariant = Type.Object(
  { type: Type.Literal("stacked_bar"), ...stackedBarOptions },
  { additionalProperties: false },
);
export type StackedBarParameters = Static<typeof chartStackedBarParameters>;
export type StackedBarChartInput = Static<typeof stackedBarChartVariant>;

export const MAX_TREEMAP_NODES = 64;
export const MAX_TREEMAP_DEPTH = 4;
const treemapLabel = Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" });
const treemapLeaf = Type.Object(
  { label: treemapLabel, value: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);
// Unroll the bounded hierarchy: provider schemas need no recursive references, and validation cannot recurse indefinitely.
const treemapLevel3 = Type.Union([
  treemapLeaf,
  Type.Object(
    {
      label: treemapLabel,
      children: Type.Array(treemapLeaf, { minItems: 1, maxItems: MAX_TREEMAP_NODES }),
    },
    { additionalProperties: false },
  ),
]);
const treemapLevel2 = Type.Union([
  treemapLeaf,
  Type.Object(
    {
      label: treemapLabel,
      children: Type.Array(treemapLevel3, { minItems: 1, maxItems: MAX_TREEMAP_NODES }),
    },
    { additionalProperties: false },
  ),
]);
const treemapLevel1 = Type.Union([
  treemapLeaf,
  Type.Object(
    {
      label: treemapLabel,
      children: Type.Array(treemapLevel2, { minItems: 1, maxItems: MAX_TREEMAP_NODES }),
    },
    { additionalProperties: false },
  ),
]);
const treemapOptions = {
  data: Type.Array(treemapLevel1, {
    minItems: 1,
    maxItems: 6,
    description:
      "1-6 top-level groups or leaves. At most 64 nodes total and 4 levels. Each node has label and exactly one of value or nonempty children. Sibling labels must be unique after trimming. Parents sum children; at least one leaf must be positive.",
  }),
  title: chartTitle,
  unit: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH, pattern: "\\S" })),
  ...chartHeightOptions,
};
export const chartTreemapParameters = Type.Object(treemapOptions, { additionalProperties: false });
export const treemapChartVariant = Type.Object(
  { type: Type.Literal("treemap"), ...treemapOptions },
  { additionalProperties: false },
);
export type TreemapParameters = Static<typeof chartTreemapParameters>;
export type TreemapChartInput = Static<typeof treemapChartVariant>;
export type TreemapNodeInput = TreemapParameters["data"][number];

/** Bound total traversal before TypeBox checks the nested shape, including persisted replay. */
export function hasBoundedTreemapHierarchy(input: unknown): boolean {
  if (
    typeof input !== "object" ||
    input === null ||
    !("data" in input) ||
    !Array.isArray(input.data)
  )
    return false;
  const pending: { nodes: unknown[]; depth: number }[] = [{ nodes: input.data, depth: 1 }];
  let count = 0;
  while (pending.length) {
    const level = pending.pop();
    if (!level || level.depth > MAX_TREEMAP_DEPTH) return false;
    count += level.nodes.length;
    if (count > MAX_TREEMAP_NODES) return false;
    for (const node of level.nodes) {
      if (
        typeof node === "object" &&
        node !== null &&
        "children" in node &&
        Array.isArray(node.children)
      )
        pending.push({ nodes: node.children, depth: level.depth + 1 });
    }
  }
  return true;
}

export const MAX_TREE_NODES = 64;
export const MAX_TREE_ID_LENGTH = 120;
export const MAX_TREE_LABEL_LENGTH = 40;
const treeId = Type.String({
  minLength: 1,
  maxLength: MAX_TREE_ID_LENGTH,
  pattern: "\\S",
});
const treeRow = Type.Object(
  {
    id: treeId,
    parentId: Type.Optional(Type.Union([treeId, Type.Null()])),
    label: Type.String({
      minLength: 1,
      maxLength: MAX_TREE_LABEL_LENGTH,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);
const treeOptions = {
  data: Type.Array(treeRow, {
    minItems: 1,
    maxItems: MAX_TREE_NODES,
    description:
      "Flat parent-reference rows. IDs must form one acyclic hierarchy with exactly one root.",
  }),
  title: chartTitle,
  ...chartHeightOptions,
};
export const chartTreeParameters = Type.Object(treeOptions, { additionalProperties: false });
export const treeChartVariant = Type.Object(
  { type: Type.Literal("tree"), ...treeOptions },
  { additionalProperties: false },
);
export type TreeParameters = Static<typeof chartTreeParameters>;
export type TreeChartInput = Static<typeof treeChartVariant>;

export const MAX_NETWORK_NODES = 64;
export const MAX_NETWORK_EDGES = 128;
export const MIN_NETWORK_HEIGHT_CELLS = MIN_CHART_HEIGHT_CELLS;
export const MAX_NETWORK_HEIGHT_CELLS = MAX_REQUESTED_CHART_HEIGHT_CELLS;
export const MAX_NETWORK_ID_LENGTH = 120;
export const MAX_NETWORK_LABEL_LENGTH = 40;
export const MAX_NETWORK_GROUP_LENGTH = 22;
export const MAX_NETWORK_EDGE_LABEL_LENGTH = 40;
const networkId = Type.String({
  minLength: 1,
  maxLength: MAX_NETWORK_ID_LENGTH,
  pattern: "\\S",
});
const networkNode = Type.Object(
  {
    id: networkId,
    label: Type.String({
      minLength: 1,
      maxLength: MAX_NETWORK_LABEL_LENGTH,
      pattern: "\\S",
    }),
    group: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: MAX_NETWORK_GROUP_LENGTH,
        pattern: "\\S",
      }),
    ),
  },
  { additionalProperties: false },
);
const networkEdge = Type.Object(
  {
    source: networkId,
    target: networkId,
    label: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: MAX_NETWORK_EDGE_LABEL_LENGTH,
        pattern: "\\S",
      }),
    ),
  },
  { additionalProperties: false },
);
const networkOptions = {
  nodes: Type.Array(networkNode, {
    minItems: 1,
    maxItems: MAX_NETWORK_NODES,
    description: "Declared graph nodes with stable IDs and display labels.",
  }),
  edges: Type.Array(networkEdge, {
    maxItems: MAX_NETWORK_EDGES,
    description: "Directed edges; source calls or depends on target.",
  }),
  title: chartTitle,
  ...chartHeightOptions,
};
export const chartNetworkParameters = Type.Object(networkOptions, { additionalProperties: false });
export const networkChartVariant = Type.Object(
  { type: Type.Literal("network"), ...networkOptions },
  { additionalProperties: false },
);
export type NetworkParameters = Static<typeof chartNetworkParameters>;
export type NetworkChartInput = Static<typeof networkChartVariant>;

export const MAX_GANTT_TASKS = 64;
export const MAX_GANTT_MILESTONES = 16;
export const MAX_GANTT_DEPENDENCIES = 8;
export const MAX_GANTT_ID_LENGTH = 120;
export const MAX_GANTT_LABEL_LENGTH = 40;
export const MAX_GANTT_GROUP_LENGTH = 22;
export const MAX_GANTT_TIME = 1_000_000_000;
const ganttId = Type.String({
  minLength: 1,
  maxLength: MAX_GANTT_ID_LENGTH,
  pattern: "\\S",
});
const ganttTime = Type.Number({ minimum: -MAX_GANTT_TIME, maximum: MAX_GANTT_TIME });
const ganttLabel = Type.String({
  minLength: 1,
  maxLength: MAX_GANTT_LABEL_LENGTH,
  pattern: "\\S",
});
const ganttGroup = Type.Optional(
  Type.String({
    minLength: 1,
    maxLength: MAX_GANTT_GROUP_LENGTH,
    pattern: "\\S",
  }),
);
const ganttTask = Type.Object(
  {
    id: ganttId,
    label: ganttLabel,
    start: ganttTime,
    end: ganttTime,
    group: ganttGroup,
    progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    dependencies: Type.Optional(
      Type.Array(ganttId, {
        maxItems: MAX_GANTT_DEPENDENCIES,
        description: "Task IDs that must complete before this task.",
      }),
    ),
  },
  { additionalProperties: false },
);
const ganttMilestone = Type.Object(
  {
    label: ganttLabel,
    at: ganttTime,
  },
  { additionalProperties: false },
);
const ganttOptions = {
  tasks: Type.Array(ganttTask, {
    minItems: 1,
    maxItems: MAX_GANTT_TASKS,
    description: "Ordered task intervals with optional progress and dependencies.",
  }),
  milestones: Type.Optional(
    Type.Array(ganttMilestone, {
      maxItems: MAX_GANTT_MILESTONES,
      description: "Named timeline milestones.",
    }),
  ),
  title: chartTitle,
  xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
  ...chartHeightOptions,
};
export const chartGanttParameters = Type.Object(ganttOptions, { additionalProperties: false });
export const ganttChartVariant = Type.Object(
  { type: Type.Literal("gantt"), ...ganttOptions },
  { additionalProperties: false },
);
export type GanttParameters = Static<typeof chartGanttParameters>;
export type GanttChartInput = Static<typeof ganttChartVariant>;
