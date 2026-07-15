import { describe, expect, test } from "bun:test"
import { parseImageReadResults } from "./plugin"

describe("parseImageReadResults", () => {
  test("accepts exact paths and basename selectors", () => {
    expect(parseImageReadResults({ imageReadResults: { paths: ["~/TONE.md"], filenames: ["TOC.md"] } })).toEqual({
      paths: ["~/TONE.md"],
      filenames: ["TOC.md"],
    })
  })

  test.each([
    [{ readResultSources: ["~/TONE.md"] }, 'option "readResultSources" was replaced'],
    [{ imageReadResults: [] }, 'option "imageReadResults" must be an object'],
    [{ imageReadResults: { regex: ["TOC"] } }, 'option "imageReadResults" only supports'],
    [{ imageReadResults: { paths: [""] } }, 'option "imageReadResults.paths" must be an array'],
    [{ imageReadResults: { filenames: ["docs/TOC.md"] } }, 'option "imageReadResults.filenames" must be an array'],
  ])("rejects invalid selector config", (options, message) => {
    expect(() => parseImageReadResults(options)).toThrow(message)
  })
})
