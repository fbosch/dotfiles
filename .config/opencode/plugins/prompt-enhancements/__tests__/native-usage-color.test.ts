import { expect, test } from "bun:test"
import { colorNativeUsage, type Renderable } from "../native-usage-color"

function renderable(plainText?: string, children: Renderable[] = []): Renderable {
  return { plainText, getChildren: () => children }
}

test("colors only the native context usage label", () => {
  const usage = renderable("83.5K (17%)")
  const commandHint = renderable("ctrl+p commands")
  const root = renderable(undefined, [commandHint, usage])

  colorNativeUsage(root)

  expect(usage.fg).toBe("#98c379")
  expect(commandHint.fg).toBeUndefined()
})

test("updates context colors at the configured thresholds", () => {
  const yellow = renderable("250K (50%)")
  const red = renderable("260K (51%)")

  colorNativeUsage(renderable(undefined, [yellow, red]))

  expect(yellow.fg).toBe("#e5c07b")
  expect(red.fg).toBe("#e06c75")
})
