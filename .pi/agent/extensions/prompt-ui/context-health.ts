export type ContextHealthColor = "success" | "warning" | "error";
export type ContextIndicatorColor = ContextHealthColor | "muted";

export interface ContextIndicator {
  text: string;
  color: ContextIndicatorColor;
}

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function contextHealthColor(percent: number): ContextHealthColor {
  // Keep these bands aligned with OpenCode's prompt context indicator.
  if (percent <= 25) return "success";
  if (percent <= 50) return "warning";
  return "error";
}

export function contextIndicator(
  tokens: number | null | undefined,
  percent: number | null | undefined,
): ContextIndicator {
  if (tokens === null || tokens === undefined || percent === null || percent === undefined) {
    return { text: "?", color: "muted" };
  }

  const roundedPercent = Math.round(percent);
  return {
    text: `${compactTokenFormatter.format(tokens)} (${roundedPercent}%)`,
    color: contextHealthColor(roundedPercent),
  };
}
