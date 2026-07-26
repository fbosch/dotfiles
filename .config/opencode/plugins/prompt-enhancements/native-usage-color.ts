import { contextHealth, nativeUsagePercent } from "./context-health"

const usageColors = {
  green: "#98c379",
  yellow: "#e5c07b",
  red: "#e06c75",
}

export type Renderable = {
  fg?: string
  plainText?: unknown
  getChildren?(): Renderable[]
}

export function colorNativeUsage(renderable: Renderable) {
  if (typeof renderable.plainText === "string") {
    const percent = nativeUsagePercent(renderable.plainText)
    if (percent !== undefined) {
      renderable.fg = usageColors[contextHealth(percent)]
    }
  }

  for (const child of renderable.getChildren?.() ?? []) {
    colorNativeUsage(child)
  }
}
