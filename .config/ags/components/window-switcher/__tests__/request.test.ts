import { describe, expect, test } from "bun:test";
import { parseWindowSwitcherRequest } from "../request";

describe("parseWindowSwitcherRequest", () => {
  test.each([
    { action: "show" },
    { action: "next", triggerModifier: "ALT" },
    { action: "prev" },
    { action: "commit" },
    { action: "hide" },
    { action: "set-mode", mode: "icons" },
    { action: "toggle-mode" },
    { action: "set-sort-mode", mode: "recency" },
    { action: "get-sort-mode" },
    { action: "get-mode" },
    { action: "get-visibility" },
  ])("accepts $action", (request) => {
    expect(parseWindowSwitcherRequest(request)).toEqual(request);
  });

  test.each([
    null,
    {},
    { action: "unknown" },
    { action: "next", triggerModifier: 1 },
    { action: "next", triggerModifier: "META" },
    { action: "set-mode", mode: false },
  ])("rejects malformed input", (request) => {
    expect(parseWindowSwitcherRequest(request)).toBeNull();
  });
});
