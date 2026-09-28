import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentCheckpointTool } from "./checkpoint";
import { registerSubagentRoutingHook } from "./subagent-routing-hook";

export default function recommendAgentExtension(pi: ExtensionAPI): void {
  registerSubagentRoutingHook(pi);
  registerSubagentCheckpointTool(pi);
}
