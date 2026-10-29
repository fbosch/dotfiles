import { Buffer } from "node:buffer";
import type { TranscriptEntry, TranscriptPage } from "./owner";

// Leave headroom for tool-result formatting below the 256 KB single-original archive limit.
export const MAX_TRANSCRIPT_PAGE_BYTES = 48_000;
const MAX_TRANSCRIPT_PAGE_ENTRIES = 500;

function splitsSurrogate(text: string, offset: number): boolean {
  const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

export function transcriptPage(
  transcript: readonly TranscriptEntry[],
  offset = 0,
  limit = 100,
  textOffset = 0,
): TranscriptPage {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("transcript offset must be a non-negative safe integer");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRANSCRIPT_PAGE_ENTRIES)
    throw new Error(`transcript limit must be between 1 and ${MAX_TRANSCRIPT_PAGE_ENTRIES}`);
  const first = transcript[offset];
  if (!Number.isSafeInteger(textOffset) || textOffset < 0 ||
      (textOffset > 0 && (!first || textOffset > first.text.length || splitsSurrogate(first.text, textOffset))))
    throw new Error("transcript textOffset must be a valid UTF-16 text boundary in the selected entry");

  const entries: TranscriptEntry[] = [];
  const page = (nextOffset: number, nextTextOffset = 0): TranscriptPage => ({
    entries,
    offset,
    ...(textOffset ? { textOffset } : {}),
    ...(nextOffset < transcript.length ? { nextOffset } : {}),
    ...(nextTextOffset ? { nextTextOffset } : {}),
  });
  const fits = (value: TranscriptPage) => Buffer.byteLength(JSON.stringify(value)) <= MAX_TRANSCRIPT_PAGE_BYTES;
  let index = offset;
  for (; index < transcript.length && entries.length < limit; index++) {
    const entry = transcript[index]!;
    const start = index === offset ? textOffset : 0;
    // No UTF-16 code unit can serialize to less than one byte.
    if (entry.text.length - start <= MAX_TRANSCRIPT_PAGE_BYTES) {
      entries.push({ ...entry, text: entry.text.slice(start) });
      if (fits(page(index + 1))) continue;
      entries.pop();
    }
    if (entries.length) break;

    let low = start, high = Math.min(entry.text.length, start + MAX_TRANSCRIPT_PAGE_BYTES);
    while (low < high) {
      const end = Math.ceil((low + high) / 2);
      entries[0] = { ...entry, text: entry.text.slice(start, end) };
      if (fits(page(index, end))) low = end;
      else high = end - 1;
    }
    if (splitsSurrogate(entry.text, low)) low--;
    if (low === start) throw new Error("transcript entry metadata exceeds the page byte limit");
    entries[0] = { ...entry, text: entry.text.slice(start, low) };
    return freezePage(page(index, low));
  }
  return freezePage(page(index));
}

function freezePage(page: TranscriptPage): TranscriptPage {
  for (const entry of page.entries) Object.freeze(entry);
  Object.freeze(page.entries);
  return Object.freeze(page);
}
