export interface EvidenceSpan {
  text: string;
  startLine: number;
  endLine: number;
}

const LOG_PREFIX = /^\s*(?:\[[^\]\r\n]+\]\s*)?(?:trace|debug|info|warn|warning|error)\b(?:\s*[:\]-])?/i;
const MAX_SPANS = 32;

/**
 * Keep extracted blocks intact unless plain text has strongly repeated log framing.
 * shortcut: support conventional line-prefixed logs only; expand when real output
 * formats require additional framing or structured-document parsing.
 */
export function coherentEvidence(text: string): EvidenceSpan[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  if (!lines.length) return [{ text, startLine: 1, endLine: 1 }];

  // Structured formats and fenced code are deliberately treated as opaque.
  const body = lines.map((line) => line.replace(/\r?\n$/, ""));
  const trimmed = text.trimStart();
  if (/```|~~~/.test(trimmed) || /^[{[]/.test(trimmed)) return whole(text, lines.length);

  const isLog = body.map((line) => LOG_PREFIX.test(line));
  const count = new Map<string, number>();
  for (let i = 0; i < body.length; i++) {
    if (!isLog[i]) continue;
    const framing = body[i]?.match(LOG_PREFIX)?.[0]?.toLowerCase();
    const normalized = body[i]?.replace(LOG_PREFIX, "").trim();
    if (framing && normalized) {
      const key = `${framing}\u0000${normalized}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  if (![...count.values()].some((n) => n >= 4)) return whole(text, lines.length);

  const spans: EvidenceSpan[] = [];
  let start = 0;
  let current: boolean | undefined;
  const add = (from: number, to: number) => {
    if (from >= to) return;
    spans.push({ text: lines.slice(from, to).join(""), startLine: from + 1, endLine: to });
  };
  for (let i = 0; i < lines.length; i++) {
    const kind = isLog[i] ?? false;
    if (current === undefined) current = kind;
    else if (kind !== current) {
      add(start, i);
      start = i;
      current = kind;
    }
  }
  add(start, lines.length);
  return spans.length > MAX_SPANS ? whole(text, lines.length) : spans;
}

function whole(text: string, lineCount: number): EvidenceSpan[] {
  return [{ text, startLine: 1, endLine: lineCount }];
}
