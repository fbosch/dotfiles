import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shutdownChartRuntime } from "./loader";
import { registerChartTools } from "./metadata";
import { registerChartGuidance } from "./prompt";

export default function (pi: ExtensionAPI): void {
  registerChartTools(pi);
  registerChartGuidance(pi);
  pi.on("session_shutdown", shutdownChartRuntime);
}
