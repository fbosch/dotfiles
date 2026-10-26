import { expect, test } from "bun:test";
import { coherentEvidence } from "../coherent-evidence";

test("splits repeated trace framing around an approval record and reconstructs exact source", () => {
  const input = "TRACE: read\nTRACE: read\nFINAL APPROVED\nTRACE: read\nTRACE: read\n";
  const spans = coherentEvidence(input);
  expect(spans.map((span) => span.text).join("")).toBe(input);
  expect(spans.map(({ text, startLine, endLine }) => [text, startLine, endLine])).toEqual([
    ["TRACE: read\nTRACE: read\n", 1, 2],
    ["FINAL APPROVED\n", 3, 3],
    ["TRACE: read\nTRACE: read\n", 4, 5],
  ]);
});

test("keeps prose, arbitrary text, and adjacent multiline conditions atomic", () => {
  for (const input of [
    "A general paragraph.\nAnother sentence.\n",
    "TRACE: one\nTRACE: two\nrequires approval\nonly if all conditions hold\n",
    "when x is true\nand y is false\nthen retain it",
  ]) expect(coherentEvidence(input).map((span) => span.text).join("")).toBe(input),
    expect(coherentEvidence(input)).toHaveLength(1);
});

test("keeps fenced code and JSON documents atomic", () => {
  for (const input of [
    "```text\nTRACE: a\nTRACE: b\nTRACE: c\nTRACE: d\n```\n",
    "{\n  \"events\": [\"TRACE: a\", \"TRACE: b\", \"TRACE: c\", \"TRACE: d\"]\n}\n",
  ]) expect(coherentEvidence(input)).toHaveLength(1);
});

test("preserves CRLF, Danish letters, and final newline exactly", () => {
  const input = "INFO: æøå\r\n".repeat(4) + "\nAPPROVED: ja\r\n";
  const spans = coherentEvidence(input);
  expect(spans.map((span) => span.text).join("")).toBe(input);
  expect(spans[0]?.text).toBe("INFO: æøå\r\n".repeat(4));
  expect(spans.at(-1)?.text).toBe("\nAPPROVED: ja\r\n");
  expect(spans.at(-1)?.startLine).toBe(5);
});

test("returns whole input when splitting would exceed 32 spans", () => {
  const input = Array.from({ length: 35 }, (_, i) => i % 2 ? "APPROVED\n" : "INFO: event\n").join("");
  expect(coherentEvidence(input)).toEqual([{ text: input, startLine: 1, endLine: 35 }]);
});
