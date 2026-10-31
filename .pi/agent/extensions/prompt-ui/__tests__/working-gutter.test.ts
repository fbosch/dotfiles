import { expect, test } from "bun:test";
import { gutterFade, WORKING_SWEEP_FRAMES, workingGutterStrength } from "../working-gutter";

test.each([4, 11, 30])("moves the brightest point downward through a %i-row rail", (lastRow) => {
  let previous = 0;
  const visited = new Set<number>();
  for (let frame = 0; frame < WORKING_SWEEP_FRAMES; frame++) {
    const strengths = Array.from({ length: lastRow + 1 }, (_, row) =>
      workingGutterStrength(row, lastRow, frame / WORKING_SWEEP_FRAMES),
    );
    const peak = strengths.indexOf(Math.max(...strengths));
    expect(peak).toBeGreaterThanOrEqual(previous);
    visited.add(peak);
    previous = peak;
    for (const strength of strengths) {
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(strength).toBeLessThanOrEqual(1);
    }
  }
  expect(visited.has(0)).toBe(true);
  expect(visited.has(lastRow)).toBe(true);
});

test.each([4, 11, 30])("fades out between sweeps across a %i-row rail", (lastRow) => {
  for (const position of [0, 1]) {
    for (let row = 0; row <= lastRow; row++) {
      expect(workingGutterStrength(row, lastRow, position)).toBeLessThan(0.012);
    }
  }
});

test("keeps a soft trail above the head and a tighter leading edge below it", () => {
  const lastRow = 20;
  const headRadius = 2.4;
  const tailRadius = 5;
  const center = lastRow / 2 + 1.5 * (tailRadius - headRadius);
  expect(workingGutterStrength(center, lastRow, 0.5)).toBeCloseTo(1);
  expect(workingGutterStrength(center - 2, lastRow, 0.5)).toBeGreaterThan(
    workingGutterStrength(center + 2, lastRow, 0.5),
  );
});

test("eases fades at both endpoints and clamps elapsed time", () => {
  expect(gutterFade(-100, 400)).toBe(1);
  expect(gutterFade(0, 400)).toBe(1);
  expect(gutterFade(200, 400)).toBe(0.5);
  expect(gutterFade(400, 400)).toBe(0);
  expect(gutterFade(600, 400)).toBe(0);
  expect(1 - gutterFade(40, 400)).toBeLessThan(0.1);
  expect(gutterFade(360, 400)).toBeLessThan(0.1);
});

test("travels faster through the middle than at the entrance", () => {
  const peak = (position: number) => {
    const strengths = Array.from({ length: 101 }, (_, row) =>
      workingGutterStrength(row, 100, position),
    );
    return strengths.indexOf(Math.max(...strengths));
  };
  const enteringDistance = peak(0.3) - peak(0.2);
  const middleDistance = peak(0.55) - peak(0.45);
  expect(middleDistance).toBeGreaterThan(enteringDistance * 1.5);
});
