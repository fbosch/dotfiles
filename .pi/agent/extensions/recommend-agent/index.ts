import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentRoutingHook } from "./subagent-routing-hook";

export default function recommendAgentExtension(pi: ExtensionAPI): void {
  registerSubagentRoutingHook(pi);
}
