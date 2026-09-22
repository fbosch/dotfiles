import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export const MAX_ROUTING_POLICY_BYTES = 16 * 1024;

export interface RoutingPolicy {
  readonly body: string;
}

export interface RoutingPolicyResult {
  readonly policy?: RoutingPolicy;
  readonly failure?: "routing-policy-unavailable";
}

export function readGlobalRoutingPolicy(agentDir = getAgentDir()): RoutingPolicyResult {
  const path = join(agentDir, "instructions", "orchestration.md");

  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_ROUTING_POLICY_BYTES) {
      return { failure: "routing-policy-unavailable" };
    }
    const content = readFileSync(path, "utf8");
    if (Buffer.byteLength(content, "utf8") > MAX_ROUTING_POLICY_BYTES) {
      return { failure: "routing-policy-unavailable" };
    }
    const body = parseFrontmatter(content).body.trim();
    if (body.length === 0) return { failure: "routing-policy-unavailable" };
    return { policy: { body } };
  } catch {
    return { failure: "routing-policy-unavailable" };
  }
}
