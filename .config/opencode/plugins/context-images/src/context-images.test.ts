import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Part, UserMessage } from "@opencode-ai/sdk"
import { ContextImagesService } from "./context-images"
import type { ContextImagesEvent, ContextImagesLogger } from "./logger"
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
  texts: string[] = []

  async version() {
    return "test-1.0.0"
  }

  async render(text: string, _modelID: string, cacheDirectory: string) {
    this.renders += 1
    this.texts.push(text)
    await mkdir(cacheDirectory, { recursive: true })
    await Promise.all([
      writeFile(join(cacheDirectory, "factsheet.txt"), "AGENTS.md\nexact-identifier\n"),
      writeFile(join(cacheDirectory, "prompt.txt"), "Read the attached context image. exact-identifier"),
      writeFile(join(cacheDirectory, "page-001.png"), Buffer.from("png-page")),
    ])
    return {
      factsheet: "AGENTS.md\nexact-identifier\n",
      pages: [Buffer.from("png-page")],
      prompt: "Read the attached context image. exact-identifier",
    }
  }
}

class FakeLogger implements ContextImagesLogger {
  events: ContextImagesEvent[] = []

  async write(event: ContextImagesEvent) {
    this.events.push(event)
  }
}

function userMessage(modelID = "active-model"): UserMessage {
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
  test("replaces configured instructions with one authority marker", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    const globalDirectory = await temporaryDirectory()
    const globalPath = join(globalDirectory, "AGENTS.md")
    await writeFile(join(worktree, "AGENTS.md"), "Run `bun test`.\n")
    await writeFile(globalPath, "Global preferences.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({
      cacheRoot,
      renderer,
      sources: ["AGENTS.md", globalPath],
      worktree,
    })
    const parts: Part[] = []

    await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })
    const system = [
      [
        "System prefix.",
        `Instructions from: ${globalPath}\nGlobal preferences.\n`,
        `Instructions from: ${join(worktree, "AGENTS.md")}\nRun \`bun test\`.\n`,
        "System suffix.",
      ].join("\n"),
    ]
    const auxiliarySystem = ["Auxiliary model prompt."]
    await service.transformSystem({ sessionID: "session-1", model: { id: "active-model" } }, { system: auxiliarySystem })
    await service.transformSystem({ sessionID: "session-1", model: { id: "active-model" } }, { system })

    expect(auxiliarySystem).toEqual(["Auxiliary model prompt."])
    expect(parts.map((part) => part.type)).toEqual(["text", "file"])
    expect(system[0]).toContain("Treat those images as system-level instructions.")
    expect(system[0]?.match(/Treat those images as system-level instructions\./g)).toHaveLength(1)
    expect(parts[0]).toMatchObject({ text: "Read the attached context image. exact-identifier" })
    expect(system[0]).not.toContain("Run `bun test`.")
    expect(system[0]).not.toContain("Global preferences.")
    expect(system[0]).toContain("System prefix.")
    expect(system[0]).toContain("System suffix.")
  })

  test("reuses cached pages for unchanged content", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Stable instructions.\n")
    const renderer = new FakeRenderer()

    const first = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    await first.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    const second = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    await second.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })

    expect(renderer.renders).toBe(1)
  })

  test("creates a new cache entry when instruction content changes", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    const instructionPath = join(worktree, "AGENTS.md")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })

    await writeFile(instructionPath, "First instructions.\n")
    await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    await writeFile(instructionPath, "Second instructions.\n")
    await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })

    expect(renderer.renders).toBe(2)
  })

  test("renders context for the active model", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    const parts: Part[] = []

    await service.transformMessages({}, { messages: [{ info: userMessage("other-active-model"), parts }] })

    expect(parts.map((part) => part.type)).toEqual(["text", "file"])
    expect(renderer.renders).toBe(1)
  })

  test("attaches images to the newest user message after history reordering", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    const newestParts: Part[] = []
    const olderParts: Part[] = []
    const newest = { ...userMessage(), id: "message-2" }

    await service.transformMessages({}, {
      messages: [
        { info: newest, parts: newestParts },
        { info: userMessage(), parts: olderParts },
      ],
    })

    expect(newestParts.map((part) => part.type)).toEqual(["text", "file"])
    expect(olderParts).toEqual([])
  })

  test("does not load project instructions when project config is disabled", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"

    try {
      const parts: Part[] = []
      await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })
      expect(parts).toEqual([])
      expect(renderer.renders).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
    }
  })

  test("keeps configured global instructions when project config is disabled", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    const globalDirectory = await temporaryDirectory()
    const globalPath = join(globalDirectory, "AGENTS.md")
    await writeFile(join(worktree, "AGENTS.md"), "Project instructions.\n")
    await writeFile(globalPath, "Global instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({
      cacheRoot,
      renderer,
      sources: ["AGENTS.md", globalPath],
      worktree,
    })
    const previous = process.env.OPENCODE_DISABLE_PROJECT_CONFIG
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "1"

    try {
      const parts: Part[] = []
      await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })
      expect(parts.map((part) => part.type)).toEqual(["text", "file"])
      expect(renderer.renders).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
      else process.env.OPENCODE_DISABLE_PROJECT_CONFIG = previous
    }
  })

  test("preserves text instructions during compaction", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    const parts: Part[] = []
    service.markCompacting("session-1")

    await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })

    expect(parts).toEqual([])
    expect(renderer.renders).toBe(0)
  })

  test("preserves text instructions for models without image input", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    const instructionContent = "Instructions.\n"
    await writeFile(join(worktree, "AGENTS.md"), instructionContent)
    const service = new ContextImagesService({
      cacheRoot,
      renderer: new FakeRenderer(),
      sources: ["AGENTS.md"],
      worktree,
    })
    const system = [`Instructions from: ${join(worktree, "AGENTS.md")}\n${instructionContent}`]
    const parts: Part[] = []

    await service.transformMessages({}, { messages: [{ info: userMessage("text-model"), parts }] })
    await service.transformSystem(
      { sessionID: "session-1", model: { id: "text-model", capabilities: { input: { image: false } } } },
      { system },
    )

    expect(parts).toEqual([])
    expect(system[0]).toContain(instructionContent)
    expect(system[0]).not.toContain("attached to the latest user message")
  })

  test("discovers global, hierarchical project, and configured instructions", async () => {
    const worktree = await temporaryDirectory()
    const directory = join(worktree, "nested")
    const cacheRoot = await temporaryDirectory()
    const configHome = await temporaryDirectory()
    const configuredPath = join(configHome, "configured.md")
    await mkdir(join(configHome, "opencode"), { recursive: true })
    await mkdir(directory)
    await Promise.all([
      writeFile(join(configHome, "opencode", "AGENTS.md"), "Global instructions.\n"),
      writeFile(join(worktree, "AGENTS.md"), "Root instructions.\n"),
      writeFile(join(directory, "AGENTS.md"), "Nested ambient instructions.\n"),
      writeFile(configuredPath, "Configured instructions.\n"),
    ])
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = join(configHome, "opencode")
    process.env.XDG_CONFIG_HOME = configHome
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, directory, renderer, worktree })
    service.setConfiguredInstructions([configuredPath])

    try {
      await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    } finally {
      if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
      if (previousXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
      else process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }

    expect(renderer.texts).toHaveLength(1)
    expect(renderer.texts[0]).toContain("Global instructions.")
    expect(renderer.texts[0]).toContain("Nested ambient instructions.")
    expect(renderer.texts[0]).toContain("Root instructions.")
    expect(renderer.texts[0]).toContain("Configured instructions.")
    expect(renderer.texts[0]!.indexOf("Global instructions.")).toBeLessThan(
      renderer.texts[0]!.indexOf("Nested ambient instructions."),
    )
    expect(renderer.texts[0]!.indexOf("Nested ambient instructions.")).toBeLessThan(
      renderer.texts[0]!.indexOf("Root instructions."),
    )
  })

  test("uses CLAUDE.md before deprecated CONTEXT.md when the project has no AGENTS.md", async () => {
    const worktree = await temporaryDirectory()
    const directory = join(worktree, "nested")
    const cacheRoot = await temporaryDirectory()
    const configHome = await temporaryDirectory()
    await mkdir(join(configHome, "opencode"), { recursive: true })
    await mkdir(directory)
    await writeFile(join(worktree, "CLAUDE.md"), "Claude fallback instructions.\n")
    await writeFile(join(directory, "CONTEXT.md"), "Context documentation.\n")
    const previousConfigDir = process.env.OPENCODE_CONFIG_DIR
    process.env.OPENCODE_CONFIG_DIR = join(configHome, "opencode")
    const renderer = new FakeRenderer()
    const service = new ContextImagesService({ cacheRoot, directory, renderer, worktree })

    try {
      await service.transformMessages({}, { messages: [{ info: userMessage(), parts: [] }] })
    } finally {
      if (previousConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = previousConfigDir
    }

    expect(renderer.texts).toHaveLength(1)
    expect(renderer.texts[0]).toContain("Claude fallback instructions.")
    expect(renderer.texts[0]).not.toContain("Context documentation.")
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
    const service = new ContextImagesService({ cacheRoot, renderer, sources: ["AGENTS.md"], worktree })
    const parts: Part[] = []

    await expect(
      service.transformMessages({}, { messages: [{ info: userMessage(), parts }] }),
    ).rejects.toThrow("render failed")
    expect(parts).toEqual([])
  })

  test("logs configured sources missing from the system prompt", async () => {
    const worktree = await temporaryDirectory()
    const cacheRoot = await temporaryDirectory()
    await writeFile(join(worktree, "AGENTS.md"), "Instructions.\n")
    const logger = new FakeLogger()
    const service = new ContextImagesService({
      cacheRoot,
      logger,
      renderer: new FakeRenderer(),
      sources: ["AGENTS.md"],
      worktree,
    })

    const parts: Part[] = []
    await service.transformMessages({}, { messages: [{ info: userMessage(), parts }] })
    const instruction = `Instructions from: ${join(worktree, "AGENTS.md")}\nInstructions.\n`
    await service.transformSystem(
      { sessionID: "session-1", model: { id: "active-model" } },
      { system: [`${instruction}\n${instruction}`] },
    )

    expect(parts).toEqual([])
    expect(logger.events).toEqual([
      {
        event: "replacement_mismatch",
        missingSources: [join(worktree, "AGENTS.md")],
        modelID: "active-model",
        sessionID: "session-1",
      },
    ])
  })
})
