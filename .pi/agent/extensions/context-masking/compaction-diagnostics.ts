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

export function isClassifierContentFilterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.length > 8_192) return false;
  const match = /^System One API error \(403\):\s*(\{[\s\S]*\})\s*$/u.exec(message.trim());
  if (!match?.[1]) return false;
  let body: unknown;
  try { body = JSON.parse(match[1]); } catch { return false; }
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const detail = body.error;
  return typeof detail === "object" && detail !== null &&
    "code" in detail && detail.code === 403 &&
    "message" in detail && typeof detail.message === "string" &&
    detail.message.startsWith("Request blocked by content filter:");
}
