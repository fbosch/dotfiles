import { nonoCapabilityFile } from "./nono-capabilities";

export type SandboxLaunchMode = "nono" | "direct";

// Display-only: the marker is cheap to read on every render and says how Pi was launched.
// Use readNonoCapabilities when grants must be trusted for a decision.
export function getSandboxLaunchMode(
  environment: NodeJS.ProcessEnv = process.env,
): SandboxLaunchMode {
  return nonoCapabilityFile(environment) ? "nono" : "direct";
}

export function sandboxLaunchIndicator(mode: SandboxLaunchMode): {
  readonly color: "success" | "warning";
  readonly icon: string;
} {
  return mode === "nono" ? { color: "success", icon: "" } : { color: "warning", icon: "" };
}
