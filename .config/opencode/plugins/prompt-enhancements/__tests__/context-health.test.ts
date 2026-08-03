import { expect, test } from "bun:test"
import { contextHealth, nativeUsagePercent } from "../context-health"

test("uses green, yellow, and red context health thresholds", () => {
  expect(contextHealth(25)).toBe("green")
  expect(contextHealth(26)).toBe("yellow")
  expect(contextHealth(50)).toBe("yellow")
  expect(contextHealth(51)).toBe("red")
})

test("reads native context usage labels", () => {
  expect(nativeUsagePercent("83.5K (17%)")).toBe(17)
  expect(nativeUsagePercent("83.5K (17%) · $0.24")).toBe(17)
  expect(nativeUsagePercent("ctrl+p commands")).toBeUndefined()
})
