import { expect, test } from "bun:test";
import { MAX_TRANSCRIPT_PAGE_BYTES, transcriptPage } from "../transcript-page";
import type { TranscriptEntry } from "../owner";

const entry = (text: string): TranscriptEntry => ({ role: "tool", text, timestamp: 1 });

test("transcript pagination respects both byte and entry bounds", () => {
  const transcript = Array.from({ length: 5 }, (_, i) => entry(String(i).repeat(20_000)));
  const page = transcriptPage(transcript, 0, 5);
  expect(page.entries).toEqual(transcript.slice(0, 2));
  expect(page.nextOffset).toBe(2);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_TRANSCRIPT_PAGE_BYTES);
  expect(transcriptPage(transcript, 2, 1)).toEqual({ entries: transcript.slice(2, 3), offset: 2, nextOffset: 3 });
  expect(transcriptPage(transcript, 4)).toEqual({ entries: transcript.slice(4), offset: 4 });
  expect(Object.isFrozen(page)).toBe(true);
  expect(Object.isFrozen(page.entries)).toBe(true);
  expect(Object.isFrozen(page.entries[0])).toBe(true);
});

test.each([
  ["unicode", "æøå😀"],
  ["JSON escapes", '"\\\n\t\u0000'],
  ["surrogate boundaries", "😀".repeat(24_000)],
])(
  "oversized text preserves %s across continuation pages",
  (_label, value) => {
    const original = value.repeat(value.length > 100 ? 2 : 30_000);
    const transcript = [entry(original), entry("")];
    let offset = 0, textOffset = 0, recovered = "", pages = 0;
    while (true) {
      const page = transcriptPage(transcript, offset, 500, textOffset);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(MAX_TRANSCRIPT_PAGE_BYTES);
      expect(page.textOffset ?? 0).toBe(textOffset);
      for (const item of page.entries) {
        expect(Buffer.from(item.text).toString("utf8")).toBe(item.text);
        recovered += item.text;
      }
      expect(++pages).toBeLessThan(100);
      if (page.nextOffset === undefined) break;
      expect(page.nextOffset > offset || (page.nextTextOffset ?? 0) > textOffset).toBe(true);
      offset = page.nextOffset;
      textOffset = page.nextTextOffset ?? 0;
    }
    expect(recovered).toBe(original);
    expect(transcript[0]?.text).toBe(original);
  },
);

test("empty pages and end-of-entry cursors terminate", () => {
  expect(transcriptPage([])).toEqual({ entries: [], offset: 0 });
  expect(transcriptPage([entry("")])).toEqual({ entries: [entry("")], offset: 0 });
  expect(transcriptPage([entry("abc")], 0, 1, 3)).toEqual({
    entries: [entry("")], offset: 0, textOffset: 3,
  });
  expect(transcriptPage([entry("abc")], 10)).toEqual({ entries: [], offset: 10 });
});

test("transcript cursors reject invalid indices and split surrogate pairs", () => {
  const transcript = [entry("😀abc")];
  for (const offset of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => transcriptPage(transcript, offset)).toThrow("offset");
  for (const limit of [0, 501, 1.5])
    expect(() => transcriptPage(transcript, 0, limit)).toThrow("limit");
  for (const textOffset of [-1, 0.5, 1, 6, NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => transcriptPage(transcript, 0, 1, textOffset)).toThrow("textOffset");
  expect(() => transcriptPage([], 0, 1, 1)).toThrow("textOffset");
});
