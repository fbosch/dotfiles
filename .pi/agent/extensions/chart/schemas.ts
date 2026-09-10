import { type Static, Type } from "typebox";

const MAX_SLICES = 12;
const MAX_BARS = 12;
const MAX_ROWS = 200;
const MAX_LABEL_LENGTH = 22;
const MAX_POINT_LABEL_LENGTH = 40;
const MAX_TITLE_LENGTH = 80;
const MAX_AXIS_LABEL_LENGTH = 40;

const chartTitle = Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH }));
const axisLabels = {
  xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
  yLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
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

const mixedLineData = Type.Array(
  Type.Object(
    { x: Type.Union([Type.Number(), Type.String()]), y: Type.Union([Type.Number(), Type.Null()]) },
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
} as const;

/** Public provider schemas intentionally omit the internal chart discriminator. */
export const chartPieParameters = Type.Object(
  { data: pieData, title: chartTitle },
  { additionalProperties: false },
);

export const chartBarParameters = Type.Object(
  { data: barData, title: chartTitle },
  { additionalProperties: false },
);

export const chartScatterParameters = Type.Object(
  { data: scatterData, title: chartTitle, ...axisLabels },
  { additionalProperties: false },
);

export const chartLineParameters = Type.Object(
  {
    xType: Type.Union([Type.Literal("numeric"), Type.Literal("temporal")]),
    data: mixedLineData,
    ...lineOptions,
  },
  { additionalProperties: false },
);

export const numericLineChartVariant = Type.Object(
  {
    type: Type.Literal("line"),
    xType: Type.Literal("numeric"),
    data: numericLineData,
    ...lineOptions,
  },
  { additionalProperties: false },
);

export const temporalLineChartVariant = Type.Object(
  {
    type: Type.Literal("line"),
    xType: Type.Literal("temporal"),
    data: temporalLineData,
    ...lineOptions,
  },
  { additionalProperties: false },
);

export const lineChartVariant = Type.Union([numericLineChartVariant, temporalLineChartVariant]);

export const pieChartVariant = Type.Object(
  { type: Type.Literal("pie"), data: pieData, title: chartTitle },
  { additionalProperties: false },
);

export const barChartVariant = Type.Object(
  { type: Type.Literal("bar"), data: barData, title: chartTitle },
  { additionalProperties: false },
);

export const scatterChartVariant = Type.Object(
  { type: Type.Literal("scatter"), data: scatterData, title: chartTitle, ...axisLabels },
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
};
export const chartBezierParameters = Type.Object(bezierOptions, { additionalProperties: false });
export const bezierChartVariant = Type.Object(
  { type: Type.Literal("bezier"), ...bezierOptions },
  { additionalProperties: false },
);
export type BezierParameters = Static<typeof chartBezierParameters>;
export type BezierChartInput = Static<typeof bezierChartVariant>;
