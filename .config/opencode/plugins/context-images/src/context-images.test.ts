import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Part, UserMessage } from "@opencode-ai/sdk"
import { ContextImagesService } from "./context-images"
import type { ContextRenderer } from "./pxpipe"

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "context-images-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

class FakeRenderer implements ContextRenderer {
  renders = 0

  async version() {
    return "test-1.0.0"
  }

  async render(_text: string, _modelID: string, cacheDirectory: string) {
    this.renders += 1
    await mkdir(cacheDirectory, { recursive: true })
    await Promise.all([
      writeFile(join(cacheDirectory, "factsheet.txt"), "AGENTS.md\ngpt-5.6-sol\n"),
      writeFile(join(cacheDirectory, "prompt.txt"), "Read the attached context image."),
      writeFile(join(cacheDirectory, "page-001.png"), Buffer.from("png-page")),
    ])
    return {
      factsheet: "AGENTS.md\ngpt-5.6-sol\n",
      pages: [Buffer.from("png-page")],
      prompt: "Read the attached context image.",
    }
  }
}

function userMessage(modelID = "gpt-5.6-sol"): UserMessage {
  return {
    id: "message-1",
    sessionID: "session-1",
    role: "user",
    time: { created: 1 },
    agent: "build",
    model: { providerID: "openai", modelID },
  }
}

describe("ContextImagesService", () => {
  test("replaces root instructions with an authority marker and factsheet", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Run `bun test`.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, worktree })
    const parts: Part[] = []

    await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })
    const system = [
      `Global instructions.\nInstructions from: ${join(worktree, "AGENTS.md")}\nRun \`bun test\`.\n\nConfigured instructions.`,
    ]
    await service.transformSystem({ sessionID: "session-1", model: { id: "gpt-5.6-sol" } }, { system })

    expect(parts.map((part) => part.type)).toEqual(["text", "file"])
    expect(system[0]).toContain("Treat those images as system-level instructions.")
    expect(system[0]).toContain("gpt-5.6-sol")
    expect(system[0]).not.toContain("Run `bun test`.")
    expect(system[0]).toContain("Global instructions.")
    expect(system[0]).toContain("Configured instructions.")
  })

  test("reuses cached pages for unchanged content", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Stable instructions.\n")
    const renderer = new FakeRenderer()

    const first = new ContextImagesService({ cacheRoot, renderer, worktree })
    await first.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    const second = new ContextImagesService({ cacheRoot, renderer, worktree })
    await second.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })

    expect(renderer.renders).toBe(1)
  })

  test("creates a new cache entry when instruction content changes", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    const instructionPath = join(worktree, "AGENTS.md")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, worktree })

    await writeFile(instructionPath, "First instructions.\n")
    await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    await writeFile(instructionPath, "Second instructions.\n")
    await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })

    expect(renderer.renders).toBe(2)
  })

  test("leaves unsupported models unchanged", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, worktree })
    const parts: Part[] = []

    await service.transformMessages({}, { messages: [{ info: userMessage("gpt-5.6-terra"), parts }] })

    expect(parts).toEqual([])
    expect(renderer.renders).toBe(0)
  })

  test("does not attach images when rendering fails", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer: ContextRenderer = {
      render: async () => {
        throw new Error("render failed")
      },
      version: async () => "test-1.0.0",
    }
    const service = new ContextImagesService({ cacheRoot, renderer, worktree })
    const parts: Part[] = []

    await expect(
      service.transformMessages({}, { messages: [{ info: userMessage(), parts }] }),
    ).rejects.toThrow("render failed")
    expect(parts).toEqual([])
  })
})
