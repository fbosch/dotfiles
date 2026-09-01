const ESCAPE = String.fromCharCode(27);
const BELL = String.fromCharCode(7);
// Biome rejects control characters in regex literals, so build the ANSI matcher from code points.
const TERMINAL_SEQUENCE_PATTERN = new RegExp(
  `${ESCAPE}(?:\\][^${BELL}]*(?:${BELL}|${ESCAPE}\\\\)|\\[[0-?]*[ -/]*[@-~])`,
  "g",
);
const FOREGROUND_RESET_PATTERN = new RegExp(`${ESCAPE}\\[(?:0|39)?m`, "g");

export interface AnsiTextRange {
  start: number;
  end: number;
}

function plainTextBoundaries(text: string): { plain: string; boundaries: number[] } {
  let plain = "";
  let rawOffset = 0;
  const boundaries = [0];

  const appendPlain = (segment: string) => {
    for (const character of segment) {
      boundaries[plain.length] = rawOffset;
      plain += character;
      rawOffset += character.length;
      boundaries[plain.length] = rawOffset;
    }
  };

  for (const sequence of text.matchAll(TERMINAL_SEQUENCE_PATTERN)) {
    const sequenceStart = sequence.index ?? rawOffset;
    appendPlain(text.slice(rawOffset, sequenceStart));
    rawOffset = sequenceStart + sequence[0].length;
  }
  appendPlain(text.slice(rawOffset));

  return { plain, boundaries };
}

export function formatAnsiTextRanges<T extends AnsiTextRange>(
  text: string,
  findRanges: (plainText: string) => readonly T[],
  foregroundAnsi: (range: T) => string | undefined,
  restoreAnsi = "\u001b[39m",
): string {
  const { plain, boundaries } = plainTextBoundaries(text);
  let formatted = text;
  const ranges = findRanges(plain);

  for (const range of [...ranges].reverse()) {
    const color = foregroundAnsi(range);
    const rawStart = boundaries[range.start];
    const rawEnd = boundaries[range.end];
    if (color === undefined || rawStart === undefined || rawEnd === undefined) continue;

    const rangeText = text
      .slice(rawStart, rawEnd)
      .replace(FOREGROUND_RESET_PATTERN, (reset) => `${reset}${color}`);
    formatted =
      formatted.slice(0, rawStart) + color + rangeText + restoreAnsi + formatted.slice(rawEnd);
  }

  return formatted;
}
