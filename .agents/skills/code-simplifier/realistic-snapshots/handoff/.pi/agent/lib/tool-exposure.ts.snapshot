import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export const PROGRAMMATIC_READ_ONLY = {
  programmatic: "read-only" as const,
};

// shortcut: Import Pi's AgentToolError once local development types move to patched Pi 0.85.1.
export function agentToolError(
  message: string,
  result: AgentToolResult<unknown>,
): Error & { result: AgentToolResult<unknown> } {
  return Object.assign(new Error(message), {
    name: "AgentToolError",
    result,
  });
}
