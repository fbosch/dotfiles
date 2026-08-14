import { describe, expect, test } from "bun:test";
import {
  cycleSelection,
  getInitialSelection,
  resolveCommitTarget,
} from "../session-policy";

const windows = [
  { address: "0x1", workspace: "1" },
  { address: "0x2", workspace: "2" },
  { address: "0x3", workspace: "special:minimized" },
];

describe("getInitialSelection", () => {
  test.each(["next", "previous"] as const)(
    "selects the second recency-sorted window for %s",
    (direction) => {
      expect(
        getInitialSelection(windows, "0x3", "RECENCY", direction),
      ).toBe(1);
    },
  );

  test("moves forward from the active alphabetical window with wrapping", () => {
    expect(getInitialSelection(windows, "0x3", "ALPHABETICAL", "next")).toBe(0);
  });

  test("moves backward from the active alphabetical window with wrapping", () => {
    expect(
      getInitialSelection(windows, "0x1", "ALPHABETICAL", "previous"),
    ).toBe(2);
  });

  test("uses the existing next fallback when the active window is absent", () => {
    expect(getInitialSelection(windows, null, "ALPHABETICAL", "next")).toBe(1);
  });

  test("uses the existing previous fallback when the active window is absent", () => {
    expect(
      getInitialSelection(windows, null, "ALPHABETICAL", "previous"),
    ).toBe(1);
  });
});

describe("cycleSelection", () => {
  test("cycles forward and backward with wrapping", () => {
    expect(cycleSelection(2, 3, "next")).toBe(0);
    expect(cycleSelection(0, 3, "previous")).toBe(2);
  });

  test.each([0, 1])("does not cycle across %i windows", (windowCount) => {
    expect(cycleSelection(0, windowCount, "next")).toBe(0);
    expect(cycleSelection(0, windowCount, "previous")).toBe(0);
  });
});

describe("resolveCommitTarget", () => {
  test("does not resolve an invalid selection", () => {
    expect(resolveCommitTarget([], 0)).toBeNull();
    expect(resolveCommitTarget(windows, 4)).toBeNull();
  });

  test("resolves an ordinary window", () => {
    expect(resolveCommitTarget(windows, 0)).toEqual({
      address: "0x1",
      restoreMinimized: false,
    });
  });

  test("marks a minimized window for restoration", () => {
    expect(resolveCommitTarget(windows, 2)).toEqual({
      address: "0x3",
      restoreMinimized: true,
    });
  });
});
