import { expect, test } from "bun:test";
import { normalizeHashlineDiffDetails } from "../shared";

test.each([1, 5, 12])(
  "normalizes %i-character anchor gutters without changing source or metadata",
  (width) => {
    const anchor = "a".repeat(width);
    const details = {
      diff: [
        ` ${anchor}│const name = "æøå";`,
        `-${anchor}│old│literal`,
        `+${anchor}│new│literal`,
        `-${" ".repeat(width)}│unanchored deletion`,
        " ...",
      ].join("\n"),
      diffLineNumbers: [1, 2, 2, 3, undefined],
      classification: "applied",
    };
    const before = JSON.stringify(details);

    expect(normalizeHashlineDiffDetails(details)).toEqual({
      ...details,
      diff: ' const name = "æøå";\n-old│literal\n+new│literal\n-unanchored deletion\n ...',
    });
    expect(JSON.stringify(details)).toBe(before);
  },
);
