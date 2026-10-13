import { expect, test } from "bun:test";
import { getSandboxLaunchMode, sandboxLaunchIndicator } from "../sandbox-mode";

test.each([
  ["/native/nono/capabilities.json", "nono"],
  [undefined, "direct"],
  ["", "direct"],
] as const)("uses nono capability marker %s to report %s", (value, expected) => {
  expect(getSandboxLaunchMode({ NONO_CAP_FILE: value })).toBe(expected);
});

test("ignores custom launch markers when displaying nono metadata", () => {
  expect(
    getSandboxLaunchMode({ PI_SANDBOX_MODE: "direct", NONO_CAP_FILE: "/native/nono.json" }),
  ).toBe("nono");
  expect(getSandboxLaunchMode({ PI_SANDBOX_MODE: "nono" })).toBe("direct");
});

test("reads metadata without opening or validating the capability file", () => {
  expect(getSandboxLaunchMode({ NONO_CAP_FILE: "/missing/nono.json" })).toBe("nono");
});

test("shares lock styling for nono and direct modes", () => {
  expect(sandboxLaunchIndicator("nono")).toEqual({ color: "success", icon: "" });
  expect(sandboxLaunchIndicator("direct")).toEqual({ color: "warning", icon: "" });
});
