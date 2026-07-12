export type ContextHealth = "green" | "yellow" | "red"

const greenContextFraction = 0.25
const greenTokenCap = 100_000
const yellowContextFraction = 0.5
const yellowTokenCap = 256_000

export function contextHealth(used: number, contextLimit: number | undefined): ContextHealth {
  const greenLimit = contextThreshold(contextLimit, greenContextFraction, greenTokenCap)
  if (used <= greenLimit) {
    return "green"
  }

  const yellowLimit = contextThreshold(contextLimit, yellowContextFraction, yellowTokenCap)
  if (used <= yellowLimit) {
    return "yellow"
  }

  return "red"
}

function contextThreshold(contextLimit: number | undefined, fraction: number, cap: number): number {
  if (contextLimit !== undefined && contextLimit > 0) {
    return Math.min(contextLimit * fraction, cap)
  }

  return cap
}
