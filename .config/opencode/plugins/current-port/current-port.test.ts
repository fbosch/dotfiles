import { expect, test } from "bun:test"
import { promptStatusLabel } from "./status-label"

test("renders the selected OpenAI profile beside the server port", () => {
  expect(promptStatusLabel(":4096", "jpb")).toBe("jpb:4096")
  expect(promptStatusLabel(":4096", undefined)).toBe(":4096")
  expect(promptStatusLabel("", "default")).toBe("default")
})
