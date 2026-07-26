export type ContextHealth = "green" | "yellow" | "red"

export function contextHealth(percent: number): ContextHealth {
  if (percent <= 25) {
    return "green"
  }

  if (percent <= 50) {
    return "yellow"
  }

  return "red"
}

export function nativeUsagePercent(text: string): number | undefined {
  const match = /^(?:\d[\d,.]*)(?:[KM])?\s*\((\d+)%\)(?:\s+·\s+\$[\d,.]+)?$/i.exec(text)
  if (match === null) {
    return undefined
  }

  const percent = Number(match[1])
  return Number.isFinite(percent) ? percent : undefined
}
