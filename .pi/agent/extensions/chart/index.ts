import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shutdownChartRuntime } from "./loader";
import { registerChartTools } from "./metadata";

export type {
  BarParameters,
  BezierParameters,
  BoxplotParameters,
  HeatmapParameters,
  HistogramParameters,
  LineParameters,
  PieParameters,
  ScatterParameters,
} from "./metadata";
export {
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
  chartHeatmapParameters,
  chartHistogramParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
} from "./metadata";

export default function (pi: ExtensionAPI): void {
  registerChartTools(pi);
  pi.on("session_shutdown", shutdownChartRuntime);
}
