import { stripTerminalSequences } from "@earendil-works/pi-tui";

const WHITESPACE = /\s+/gu;

export function sanitizeHeaderField(value: string, maxCodePoints = 96): string {
  const withoutControls = [...stripTerminalSequences(value)]
    .map((character) => (isUnsafeControl(character.codePointAt(0) ?? 0) ? " " : character))
    .join("");
  const cleaned = withoutControls.replace(WHITESPACE, " ").trim();
  const codePoints = [...cleaned];
  if (codePoints.length <= maxCodePoints) return cleaned;
  return `${codePoints.slice(0, Math.max(0, maxCodePoints - 1)).join("")}…`;
}

function isUnsafeControl(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}
