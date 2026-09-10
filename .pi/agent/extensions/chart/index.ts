import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shutdownChartRuntime } from "./loader";
import { registerChartTools } from "./metadata";

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
  WaterfallParameters,
} from "./metadata";
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
  chartWaterfallParameters,
} from "./metadata";

export default function (pi: ExtensionAPI): void {
  registerChartTools(pi);
  pi.on("session_shutdown", shutdownChartRuntime);
}
