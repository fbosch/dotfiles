export type ContextHealthColor = "success" | "warning" | "error";

export function contextHealthColor(percent: number): ContextHealthColor {
  // Keep these bands aligned with OpenCode's prompt context indicator.
  if (percent <= 25) return "success";
  if (percent <= 50) return "warning";
  return "error";
}
