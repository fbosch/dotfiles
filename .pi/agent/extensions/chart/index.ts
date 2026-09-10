import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerChartTools } from "./metadata";

export type {
  BarParameters,
  LineParameters,
  PieParameters,
  ScatterParameters,
} from "./metadata";
export {
  chartBarParameters,
  chartLineParameters,
  chartPieParameters,
  chartScatterParameters,
} from "./metadata";

export default function (pi: ExtensionAPI): void {
  registerChartTools(pi);
}
