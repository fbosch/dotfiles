import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JsonlLogger } from "./logger"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe("JsonlLogger", () => {
  test("appends structured events without context contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "context-images-logger-test-"))
    temporaryDirectories.push(directory)
    const file = join(directory, "nested", "events.jsonl")
    const logger = new JsonlLogger(file)

    await logger.write({ event: "transform_failed", message: "pxpipe unavailable" })

    const event = JSON.parse((await readFile(file, "utf8")).trim())
    expect(event).toMatchObject({ event: "transform_failed", message: "pxpipe unavailable" })
    expect(event.timestamp).toBeString()
  })
})
