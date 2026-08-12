export function colorUsage(
  value: string,
  remainingPercent: number,
  colorEnabled: boolean,
  bold = false,
): string {
  if (!colorEnabled) {
    return value;
  }
  const weight = bold ? "1;" : "";
  return `\x1b[${weight}${usageSgr(remainingPercent)}m${value}\x1b[0m`;
}

function usageSgr(remainingPercent: number): string {
  if (remainingPercent >= 75) {
    return "32";
  }
  if (remainingPercent >= 50) {
    return "33";
  }
  if (remainingPercent >= 25) {
    return "93";
  }
  return "31";
}
