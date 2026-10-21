import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentCheckpointTool } from "./checkpoint";

export default function subagentCheckpointExtension(pi: ExtensionAPI): void {
  registerSubagentCheckpointTool(pi);
}
