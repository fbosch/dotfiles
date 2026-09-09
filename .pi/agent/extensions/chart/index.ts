import { type ExtensionAPI, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  ChartComponent,
  type ChartSettings,
  rasterizeSvg,
  renderChartSvg,
  resolveChartFontFamily,
} from "./types";
import { type PieChartDetails, pieChartRenderer, type pieChartVariant } from "./types/pie";

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof pieChartVariant, PieChartDetails>({
    name: "chart",
    label: "Chart",
    description: "Render a compact pie chart from labeled nonnegative values.",
    promptSnippet: "Render simple pie charts from labeled values",
    parameters: pieChartRenderer.parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const data = pieChartRenderer.parseParameters(params);
      const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
        projectTrusted: ctx.isProjectTrusted(),
      });
      const chartSettings: ChartSettings = {
        imageWidthCells: settings.getImageWidthCells(),
        fontFamily: resolveChartFontFamily(
          settings.getGlobalSettings(),
          settings.getProjectSettings(),
        ),
      };
      const details = pieChartRenderer.createDetails(data, chartSettings);
      const text = pieChartRenderer.getSummary(details);
      if (ctx.mode === "tui") {
        // Pi 0.85.1 always appends content images after renderResult; details retain replay data instead.
        return { content: [{ type: "text", text }], details };
      }

      const png = await rasterizeSvg(
        renderChartSvg(pieChartRenderer, details, ctx.ui.theme),
        signal,
      );
      return {
        content: [
          { type: "text", text },
          { type: "image", data: png, mimeType: "image/png" },
        ],
        details,
      };
    },
    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold(pieChartRenderer.getCallHeader(args))),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = pieChartRenderer.deserializeDetails(result.details);
      if (details === undefined) {
        const text = result.content.find((content) => content.type === "text");
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      const previous = context.lastComponent;
      if (previous instanceof ChartComponent && previous.matches(pieChartRenderer)) {
        previous.update(theme);
        return previous;
      }
      return new ChartComponent(details, theme, context.invalidate, pieChartRenderer);
    },
  });
}
