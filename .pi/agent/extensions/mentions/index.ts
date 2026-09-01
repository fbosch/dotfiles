import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentMentions from "./agent-mentions";
import projectReferences from "./project-references";

export default function mentions(pi: ExtensionAPI): void {
  agentMentions(pi);
  projectReferences(pi);
}
