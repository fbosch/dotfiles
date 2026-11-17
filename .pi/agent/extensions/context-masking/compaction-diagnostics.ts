export function compactionFailureDetail(phase: string, error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Request failed";
  // Provider errors can echo credentials; never persist complete responses or request packets.
  const safe = message
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <REDACTED>")
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "<REDACTED>")
    .replace(/((?:api[_-]?key|authorization|token|password)["']?\s*[:=]\s*["']?)[^\s"',;&}]+/giu, "$1<REDACTED>")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 500);
  return `${phase}: ${safe || "Request failed"}`;
}
