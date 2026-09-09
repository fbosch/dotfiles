import {
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  ChartComponent,
  type ChartSettings,
  rasterizeSvg,
  renderChartSvg,
  resolveChartSettings,
} from "./types";
import {
  type BarChartDetails,
  type BarChartInput,
  barChartRenderer,
  barChartVariant,
} from "./types/bar";
import {
  type LineChartDetails,
  type LineChartInput,
  lineChartRenderer,
  lineChartVariant,
} from "./types/line";
import {
  type PieChartDetails,
  type PieChartInput,
  pieChartRenderer,
  pieChartVariant,
} from "./types/pie";
import {
  type ScatterChartDetails,
  type ScatterChartInput,
  scatterChartRenderer,
  scatterChartVariant,
} from "./types/scatter";

export const chartPieParameters = Type.Object(
  {
    data: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: 22 }),
          value: Type.Number({ minimum: 0, maximum: 1_000_000_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 12 },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  },
  { additionalProperties: false },
);
export const chartBarParameters = Type.Object(
  {
    data: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: 22 }),
          value: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 12 },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  },
  { additionalProperties: false },
);

/** Provider-compatible: xType is explicit and runtime validation correlates it with each row's x value. */
export const chartScatterParameters = Type.Object(
  {
    data: Type.Array(
      Type.Object(
        {
          x: Type.Number(),
          y: Type.Number(),
          label: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 200 },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    yLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  },
  { additionalProperties: false },
);

export const chartLineParameters = Type.Object(
  {
    xType: Type.Union([Type.Literal("numeric"), Type.Literal("temporal")]),
    data: Type.Array(
      Type.Object(
        {
          x: Type.Union([Type.Number(), Type.String()]),
          y: Type.Union([Type.Number(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: 200 },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    yLabel: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
    markers: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type PieParameters = Static<typeof chartPieParameters>;
type BarParameters = Static<typeof chartBarParameters>;
type LineParameters = Static<typeof chartLineParameters>;
type ScatterParameters = Static<typeof chartScatterParameters>;
type ChartReplayDetails =
  | PieChartDetails
  | BarChartDetails
  | LineChartDetails
  | ScatterChartDetails;

function createSettings(cwd: string, trusted: boolean): ChartSettings {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: trusted });
  return {
    imageWidthCells: settings.getImageWidthCells(),
    ...resolveChartSettings(settings.getGlobalSettings(), settings.getProjectSettings()),
  };
}

function deserializeDetails(value: unknown): ChartReplayDetails | undefined {
  return (
    scatterChartRenderer.deserializeDetails(value) ??
    lineChartRenderer.deserializeDetails(value) ??
    barChartRenderer.deserializeDetails(value) ??
    pieChartRenderer.deserializeDetails(value)
  );
}

function createChartComponent(
  details: ChartReplayDetails,
  theme: Theme,
  invalidate: () => void,
):
  | ChartComponent<PieChartDetails, ReturnType<typeof pieChartRenderer.getLayout>>
  | ChartComponent<BarChartDetails, ReturnType<typeof barChartRenderer.getLayout>>
  | ChartComponent<LineChartDetails, ReturnType<typeof lineChartRenderer.getLayout>>
  | ChartComponent<ScatterChartDetails, ReturnType<typeof scatterChartRenderer.getLayout>> {
  if (details.type === "scatter")
    return new ChartComponent(details, theme, invalidate, scatterChartRenderer);
  if (details.type === "line")
    return new ChartComponent(details, theme, invalidate, lineChartRenderer);
  if (details.type === "bar")
    return new ChartComponent(details, theme, invalidate, barChartRenderer);
  // Persisted pie charts predate the internal type discriminator.
  return new ChartComponent(details, theme, invalidate, pieChartRenderer);
}

function renderResult(
  result: { content: Array<{ type: string; text?: string }>; details?: unknown },
  theme: Theme,
  context: { lastComponent?: unknown; invalidate: () => void },
) {
  const details = deserializeDetails(result.details);
  if (details === undefined) {
    const text = result.content.find((content) => content.type === "text");
    return new Text(text?.type === "text" ? (text.text ?? "") : "", 0, 0);
  }
  const previous = context.lastComponent;
  const renderer =
    details.type === "scatter"
      ? scatterChartRenderer
      : details.type === "line"
        ? lineChartRenderer
        : details.type === "bar"
          ? barChartRenderer
          : pieChartRenderer;
  if (previous instanceof ChartComponent && previous.matches(renderer)) {
    previous.update(theme);
    return previous;
  }
  return createChartComponent(details, theme, context.invalidate);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof chartPieParameters, PieChartDetails>({
    name: "chart_pie",
    label: "Chart pie",
    description: "Render a compact pie chart from labeled nonnegative values.",
    promptSnippet: "Render compact pie charts",
    parameters: chartPieParameters,
    async execute(_toolCallId, parameters: PieParameters, signal, _onUpdate, ctx) {
      const input: PieChartInput = { ...parameters, type: "pie" };
      if (!Value.Check(pieChartVariant, input)) throw new Error("invalid pie chart parameters");
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = pieChartRenderer.createDetails(
        pieChartRenderer.parseParameters(input),
        settings,
      );
      const text = pieChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await rasterizeSvg(
        renderChartSvg(pieChartRenderer, details, ctx.ui.theme),
        signal,
        {
          fontFamily: settings.fontFamily,
        },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold(pieChartRenderer.getCallHeader({ ...args, type: "pie" }))),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      return renderResult(result, theme, context);
    },
  });

  pi.registerTool<typeof chartBarParameters, BarChartDetails>({
    name: "chart_bar",
    label: "Chart bar",
    description: "Render a compact horizontal bar chart from labeled signed values.",
    promptSnippet: "Render compact horizontal bar charts",
    parameters: chartBarParameters,
    async execute(_toolCallId, parameters: BarParameters, signal, _onUpdate, ctx) {
      const input: BarChartInput = { ...parameters, type: "bar" };
      if (!Value.Check(barChartVariant, input)) throw new Error("invalid bar chart parameters");
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = barChartRenderer.createDetails(
        barChartRenderer.parseParameters(input),
        settings,
      );
      const text = barChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await rasterizeSvg(
        renderChartSvg(barChartRenderer, details, ctx.ui.theme),
        signal,
        {
          fontFamily: settings.fontFamily,
        },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold(barChartRenderer.getCallHeader({ ...args, type: "bar" }))),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      return renderResult(result, theme, context);
    },
  });

  pi.registerTool<typeof chartScatterParameters, ScatterChartDetails>({
    name: "chart_scatter",
    label: "Chart scatter",
    description:
      "Render a single-series scatter chart with fixed-size dots and optional point labels.",
    promptSnippet: "Render single-series scatter charts",
    parameters: chartScatterParameters,
    async execute(_toolCallId, parameters: ScatterParameters, signal, _onUpdate, ctx) {
      const input: ScatterChartInput = { ...parameters, type: "scatter" };
      if (!Value.Check(scatterChartVariant, input))
        throw new Error("invalid scatter chart parameters");
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = scatterChartRenderer.createDetails(
        scatterChartRenderer.parseParameters(input),
        settings,
      );
      const text = scatterChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await rasterizeSvg(
        renderChartSvg(scatterChartRenderer, details, ctx.ui.theme),
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
    renderCall(args, theme) {
      const input = { ...args, type: "scatter" as const };
      return new Text(
        theme.fg(
          "toolTitle",
          theme.bold(
            Value.Check(scatterChartVariant, input)
              ? scatterChartRenderer.getCallHeader(input)
              : "chart_scatter",
          ),
        ),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      return renderResult(result, theme, context);
    },
  });

  pi.registerTool<typeof chartLineParameters, LineChartDetails>({
    name: "chart_line",
    label: "Chart line",
    description:
      "Render a single-series numeric or temporal line chart with optional gaps and markers.",
    promptSnippet: "Render single-series line charts",
    parameters: chartLineParameters,
    async execute(_toolCallId, parameters: LineParameters, signal, _onUpdate, ctx) {
      const input = { ...parameters, type: "line" as const };
      if (!Value.Check(lineChartVariant, input)) throw new Error("invalid line chart parameters");
      const lineInput: LineChartInput = input;
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      const details = lineChartRenderer.createDetails(
        lineChartRenderer.parseParameters(lineInput),
        settings,
      );
      const text = lineChartRenderer.getSummary(details);
      if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
      const png = await rasterizeSvg(
        renderChartSvg(lineChartRenderer, details, ctx.ui.theme),
        signal,
        {
          fontFamily: settings.fontFamily,
        },
      );
      return {
        content: [
          { type: "text" as const, text },
          { type: "image" as const, data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderCall(args, theme) {
      const input = { ...args, type: "line" as const };
      return new Text(
        theme.fg(
          "toolTitle",
          theme.bold(
            Value.Check(lineChartVariant, input)
              ? lineChartRenderer.getCallHeader(input)
              : "chart_line",
          ),
        ),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      return renderResult(result, theme, context);
    },
  });
}
