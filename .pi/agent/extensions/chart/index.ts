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
import {
  ChartComponent,
  type ChartSettings,
  rasterizeSvg,
  renderChartSvg,
  resolveChartFontFamily,
} from "./types";
import { type BarChartDetails, barChartRenderer } from "./types/bar";
import { type PieChartDetails, pieChartRenderer } from "./types/pie";

const MAX_ROWS = 12;
const MAX_LABEL_LENGTH = 22;
const MAX_TITLE_LENGTH = 80;

/** Provider-compatible top-level object; variants remain validated at the chart boundary. */
export const chartParameters = Type.Object(
  {
    type: StringEnum(["pie", "bar"] as const),
    data: Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
          value: Type.Number({ minimum: -1_000_000_000, maximum: 1_000_000_000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 2, maxItems: MAX_ROWS },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH })),
  },
  { additionalProperties: false },
);

type ChartParameters = Static<typeof chartParameters>;
type ChartReplayDetails = PieChartDetails | BarChartDetails;

function createSettings(cwd: string, trusted: boolean): ChartSettings {
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: trusted });
  return {
    imageWidthCells: settings.getImageWidthCells(),
    fontFamily: resolveChartFontFamily(settings.getGlobalSettings(), settings.getProjectSettings()),
  };
}

function getCallHeader(parameters: ChartParameters): string {
  return match(parameters)
    .with({ type: "pie" }, (input) => pieChartRenderer.getCallHeader({ ...input, type: "pie" }))
    .with({ type: "bar" }, (input) => barChartRenderer.getCallHeader({ ...input, type: "bar" }))
    .exhaustive();
}

function deserializeDetails(value: unknown): ChartReplayDetails | undefined {
  return barChartRenderer.deserializeDetails(value) ?? pieChartRenderer.deserializeDetails(value);
}

function createChartComponent(
  details: ChartReplayDetails,
  theme: Theme,
  invalidate: () => void,
):
  | ChartComponent<PieChartDetails, ReturnType<typeof pieChartRenderer.getLayout>>
  | ChartComponent<BarChartDetails, ReturnType<typeof barChartRenderer.getLayout>> {
  if (details.type === "bar") {
    return new ChartComponent(details, theme, invalidate, barChartRenderer);
  }
  return new ChartComponent(details, theme, invalidate, pieChartRenderer);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof chartParameters, ChartReplayDetails>({
    name: "chart",
    label: "Chart",
    description: "Render a compact pie or horizontal bar chart from labeled values.",
    promptSnippet: "Render compact pie or horizontal bar charts from labeled values",
    parameters: chartParameters,
    async execute(_toolCallId, parameters, signal, _onUpdate, ctx) {
      const settings = createSettings(ctx.cwd, ctx.isProjectTrusted());
      return match(parameters)
        .with({ type: "pie" }, async (input) => {
          const data = pieChartRenderer.parseParameters({ ...input, type: "pie" });
          const details = pieChartRenderer.createDetails(data, settings);
          const text = pieChartRenderer.getSummary(details);
          if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
          const png = await rasterizeSvg(
            renderChartSvg(pieChartRenderer, details, ctx.ui.theme),
            signal,
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
          const data = barChartRenderer.parseParameters({ ...input, type: "bar" });
          const details = barChartRenderer.createDetails(data, settings);
          const text = barChartRenderer.getSummary(details);
          if (ctx.mode === "tui") return { content: [{ type: "text" as const, text }], details };
          const png = await rasterizeSvg(
            renderChartSvg(barChartRenderer, details, ctx.ui.theme),
            signal,
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
      if (details.type === "bar") {
        if (previous instanceof ChartComponent && previous.matches(barChartRenderer)) {
          previous.update(theme);
          return previous;
        }
      } else if (previous instanceof ChartComponent && previous.matches(pieChartRenderer)) {
        previous.update(theme);
        return previous;
      }
      return createChartComponent(details, theme, context.invalidate);
    },
  });
}
