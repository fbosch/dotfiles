export type SandboxLaunchMode = "nono" | "direct";

// Display-only nono metadata, not independently verified kernel confinement.
export function getSandboxLaunchMode(
  environment: NodeJS.ProcessEnv = process.env,
): SandboxLaunchMode {
  return environment.NONO_CAP_FILE ? "nono" : "direct";
}

export function sandboxLaunchIndicator(mode: SandboxLaunchMode): {
  readonly color: "success" | "warning";
  readonly icon: string;
} {
  return mode === "nono" ? { color: "success", icon: "" } : { color: "warning", icon: "" };
}
