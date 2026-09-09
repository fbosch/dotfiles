import { StringEnum } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  getAgentDir,
  SettingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { match } from "ts-pattern";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
  ChartComponent,
  type ChartSettings,
  rasterizeSvg,
  renderChartSvg,
  resolveChartFontFamily,
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

const MAX_ROWS = 200;
const MAX_LABEL_LENGTH = 22;
const MAX_TITLE_LENGTH = 80;
const MAX_AXIS_LABEL_LENGTH = 40;

/** Provider-compatible object schema; each discriminated variant is checked again at the chart boundary. */
export const chartParameters = Type.Object(
  {
    type: StringEnum(["pie", "bar", "line"] as const),
    data: Type.Array(
      Type.Union([
        Type.Object(
          {
            label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
            value: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
          },
          { additionalProperties: false },
        ),
        Type.Object(
          { x: Type.Number(), y: Type.Union([Type.Number(), Type.Null()]) },
          { additionalProperties: false },
        ),
        Type.Object(
          { x: Type.String(), y: Type.Union([Type.Number(), Type.Null()]) },
          { additionalProperties: false },
        ),
      ]),
      { minItems: 2, maxItems: MAX_ROWS },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH })),
    xType: Type.Optional(StringEnum(["numeric", "temporal"] as const)),
    xLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
    yLabel: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_AXIS_LABEL_LENGTH })),
    markers: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type ChartParameters = Static<typeof chartParameters>;
type ChartReplayDetails = PieChartDetails | BarChartDetails | LineChartDetails;

function createSettings(cwd: string, trusted: boolean): ChartSettings {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: trusted });
  return {
    imageWidthCells: settings.getImageWidthCells(),
    fontFamily: resolveChartFontFamily(settings.getGlobalSettings(), settings.getProjectSettings()),
  };
}

function isPieChartInput(value: unknown): value is PieChartInput {
  return Value.Check(pieChartVariant, value);
}

function isBarChartInput(value: unknown): value is BarChartInput {
  return Value.Check(barChartVariant, value);
}

function isLineChartInput(value: unknown): value is LineChartInput {
  return Value.Check(lineChartVariant, value);
}

function getCallHeader(parameters: ChartParameters): string {
  return match(parameters)
    .with({ type: "pie" }, (input) => {
      if (!isPieChartInput(input)) throw new Error("invalid pie chart parameters");
      return pieChartRenderer.getCallHeader(input);
    })
    .with({ type: "bar" }, (input) => {
      if (!isBarChartInput(input)) throw new Error("invalid bar chart parameters");
      return barChartRenderer.getCallHeader(input);
    })
    .with({ type: "line" }, (input) => {
      if (!isLineChartInput(input)) throw new Error("invalid line chart parameters");
      return lineChartRenderer.getCallHeader(input);
    })
    .exhaustive();
}

function deserializeDetails(value: unknown): ChartReplayDetails | undefined {
  return (
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
  | ChartComponent<LineChartDetails, ReturnType<typeof lineChartRenderer.getLayout>> {
  if (details.type === "line")
    return new ChartComponent(details, theme, invalidate, lineChartRenderer);
  if (details.type === "bar")
    return new ChartComponent(details, theme, invalidate, barChartRenderer);
  // Persisted pie charts predate the type discriminator.
  return new ChartComponent(details, theme, invalidate, pieChartRenderer);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof chartParameters, ChartReplayDetails>({
    name: "chart",
    label: "Chart",
    description: "Render a compact pie, horizontal bar, or single-series line chart.",
    promptSnippet: "Render compact pie, horizontal bar, or single-series line charts",
    parameters: chartParameters,
    async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      return match(parameters)
        .with({ type: "pie" }, async (input) => {
          if (!isPieChartInput(input)) throw new Error("invalid pie chart parameters");
          const data = pieChartRenderer.parseParameters(input);
          const details = pieChartRenderer.createDetails(data, settings);
          const text = pieChartRenderer.getSummary(details);
          if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
          const png = await rasterizeSvg(
            renderChartSvg(pieChartRenderer, details, ctx.ui.theme),
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
        })
        .with({ type: "bar" }, async (input) => {
          if (!isBarChartInput(input)) throw new Error("invalid bar chart parameters");
          const data = barChartRenderer.parseParameters(input);
          const details = barChartRenderer.createDetails(data, settings);
          const text = barChartRenderer.getSummary(details);
          if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
          const png = await rasterizeSvg(
            renderChartSvg(barChartRenderer, details, ctx.ui.theme),
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
        })
        .with({ type: "line" }, async (input) => {
          if (!isLineChartInput(input)) throw new Error("invalid line chart parameters");
          const data = lineChartRenderer.parseParameters(input);
          const details = lineChartRenderer.createDetails(data, settings);
          const text = lineChartRenderer.getSummary(details);
          if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
          const png = await rasterizeSvg(
            renderChartSvg(lineChartRenderer, details, ctx.ui.theme),
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
        })
        .exhaustive();
    },
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold(getCallHeader(args))), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const details = deserializeDetails(result.details);
      if (details === undefined) {
        const text = result.content.find((content) => content.type === "text");
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const previous = context.lastComponent;
      const renderer = match(details)
        .with({ type: "line" }, () => lineChartRenderer)
        .with({ type: "bar" }, () => barChartRenderer)
        .otherwise(() => pieChartRenderer);
      if (previous instanceof ChartComponent && previous.matches(renderer)) {
        previous.update(theme);
        return previous;
      }
      return createChartComponent(details, theme, context.invalidate);
    },
  });
}
