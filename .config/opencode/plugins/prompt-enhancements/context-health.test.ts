import { expect, test } from "bun:test"
import { contextHealth } from "./context-health"

test("uses model-relative thresholds for a 128k context window", () => {
  expect(contextHealth(32_000, 128_000)).toBe("green")
  expect(contextHealth(32_001, 128_000)).toBe("yellow")
  expect(contextHealth(64_001, 128_000)).toBe("red")
})

test("caps thresholds for million-token context windows", () => {
  expect(contextHealth(100_000, 1_000_000)).toBe("green")
  expect(contextHealth(100_001, 1_000_000)).toBe("yellow")
  expect(contextHealth(256_001, 1_000_000)).toBe("red")
})

test("uses absolute guards when the model context limit is unavailable", () => {
  expect(contextHealth(100_000, undefined)).toBe("green")
  expect(contextHealth(100_001, undefined)).toBe("yellow")
  expect(contextHealth(256_001, undefined)).toBe("red")
  expect(contextHealth(100_001, 0)).toBe("yellow")
})
