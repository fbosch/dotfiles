import type { Fixture } from "./fixtures";

function counters(missing: number, count = 600): string {
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1 >= missing ? i + 2 : i + 1;
    return `${`scan ${n}: routine scan continues`.padEnd(71, " ")}\n`;
  }).join("");
}

export const SEARCH_FIXTURES: Fixture[] = [
  {
    id: "counter-presence",
    question:
      "Does the capture contain scan counter 257, and does it contain scan counter 387? Inspect the actual capture rather than inferring from boundary counters. Return JSON keys scan257 and scan387, both booleans.",
    output: counters(257),
    exitCode: 0,
    expected: { scan257: false, scan387: true },
    previewExpected: true,
    unmarkedEvidence: true,
  },
  {
    id: "counter-absence",
    question:
      "Does the capture contain scan counter 287, and does it contain scan counter 299? Inspect the actual capture rather than inferring from boundary counters. Return JSON keys scan287 and scan299, both booleans.",
    output: counters(287),
    exitCode: 0,
    expected: { scan287: false, scan299: true },
    previewExpected: true,
    unmarkedEvidence: true,
  },
];
