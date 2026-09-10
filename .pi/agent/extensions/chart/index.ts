import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shutdownChartRuntime } from "./loader";
import { registerChartTools } from "./metadata";

export type {
  BarParameters,
  BezierParameters,
  BoxplotParameters,
  DumbbellParameters,
  GanttParameters,
  HeatmapParameters,
  HistogramParameters,
  LineParameters,
  NetworkParameters,
  PieParameters,
  ScatterParameters,
  StackedBarParameters,
  TreemapParameters,
  TreeParameters,
  WaterfallParameters,
} from "./metadata";
export {
  chartBarParameters,
  chartBezierParameters,
  chartBoxplotParameters,
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
} from "./metadata";

export default function (pi: ExtensionAPI): void {
  registerChartTools(pi);
  pi.on("session_shutdown", shutdownChartRuntime);
}
