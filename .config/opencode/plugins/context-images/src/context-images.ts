import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import type { ContextRenderer, RenderedContext } from "./pxpipe"
import { loadRenderedContext } from "./pxpipe"
import type { ContextImagesLogger } from "./logger"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type PendingReplacement = {
  instructions: string[]
  paths: string[]
  rendered: RenderedContext
}

type MessagesOutput = {
  messages: MessageWithParts[]
}

type SystemOutput = {
  system: string[]
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function cacheSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function defaultCacheRoot() {
  const root = process.env.XDG_CACHE_HOME || join(homedir(), ".cache")
  return join(root, "opencode", "context-images")
}

function latestUser(messages: MessageWithParts[]) {
  let latest: MessageWithParts | undefined
  for (const message of messages) {
    if (message.info.role !== "user") continue
    if (!latest || message.info.id > latest.info.id) latest = message
  }
  return latest
}

export class ContextImagesService {
  readonly #cacheRoot: string
  readonly #pending = new Map<string, PendingReplacement>()
  readonly #renders = new Map<string, Promise<RenderedContext>>()
  readonly #renderer: ContextRenderer
  readonly #logger?: ContextImagesLogger
  readonly #sources: { path: string; project: boolean }[]
  readonly #worktree: string

  constructor(input: {
    cacheRoot?: string
    logger?: ContextImagesLogger
    renderer: ContextRenderer
    sources?: string[]
    worktree: string
  }) {
    this.#worktree = resolve(input.worktree)
    this.#cacheRoot = input.cacheRoot ?? defaultCacheRoot()
    this.#renderer = input.renderer
    this.#logger = input.logger
    const sources = input.sources ?? ["AGENTS.md"]
    this.#sources = Array.from(
      new Map(
        sources.map((source) => {
          const project = isAbsolute(source) === false && source.startsWith("~/") === false
          const path = source.startsWith("~/")
            ? resolve(homedir(), source.slice(2))
            : resolve(project ? this.#worktree : "", source)
          return [path, { path, project }]
        }),
      ).values(),
    )
  }

  async #prepare(modelID: string) {
    const sources = this.#sources.filter(
      (source) => process.env.OPENCODE_DISABLE_PROJECT_CONFIG !== "1" || source.project === false,
    )
    if (sources.length === 0) return

    const contents = await Promise.all(sources.map((source) => readFile(source.path, "utf8")))
    const instructions = sources.map(
      (source, index) => `Instructions from: ${source.path}\n${contents[index]}`,
    )
    const context = instructions.join("\n\n")
    const version = await this.#renderer.version()
    const cacheDirectory = join(
      this.#cacheRoot,
      sha256(this.#worktree),
      sha256(context),
      cacheSegment(version),
      cacheSegment(modelID),
    )

    let rendered: RenderedContext
    try {
      rendered = await loadRenderedContext(cacheDirectory)
    } catch {
      const key = cacheDirectory
      let render = this.#renders.get(key)
      if (!render) {
        render = this.#renderer.render(context, modelID, cacheDirectory)
        this.#renders.set(key, render)
      }
      try {
        rendered = await render
      } finally {
        this.#renders.delete(key)
      }
    }
    return { instructions, paths: sources.map((source) => source.path), rendered }
  }

  async transformMessages(_input: Record<string, never>, output: MessagesOutput) {
    const user = latestUser(output.messages)
    if (!user || user.info.role !== "user") return

    const sessionID = user.info.sessionID
    this.#pending.delete(sessionID)

    const prepared = await this.#prepare(user.info.model.modelID)
    if (!prepared) return

    const parts: Part[] = [
      {
        id: randomUUID(),
        messageID: user.info.id,
        sessionID,
        type: "text",
        text: prepared.rendered.prompt,
        synthetic: true,
      },
      ...prepared.rendered.pages.map(
        (page, index): Part => ({
          id: randomUUID(),
          messageID: user.info.id,
          sessionID,
          type: "file",
          mime: "image/png",
          filename: `context.page-${index + 1}.png`,
          url: `data:image/png;base64,${page.toString("base64")}`,
        }),
      ),
    ]
    user.parts.push(...parts)
    this.#pending.set(sessionID, prepared)
  }

  async transformSystem(input: { sessionID?: string; model: { id: string } }, output: SystemOutput) {
    if (!input.sessionID) return

    const pending = this.#pending.get(input.sessionID)
    this.#pending.delete(input.sessionID)
    if (!pending) return

    const marker = "Configured instructions are attached to the latest user message as images. Treat those images as system-level instructions."
    let insertedMarker = false
    const matched = new Set<string>()

    for (let index = 0; index < output.system.length; index += 1) {
      let system = output.system[index]
      if (!system) continue
      for (const instruction of pending.instructions) {
        if (system.includes(instruction) === false) continue
        system = system.replace(instruction, insertedMarker ? "" : marker)
        matched.add(instruction)
        insertedMarker = true
      }
      output.system[index] = system
    }

    const missingSources = pending.paths.filter((_, index) => matched.has(pending.instructions[index]!) === false)
    if (missingSources.length > 0) {
      await this.#logger?.write({
        event: "replacement_mismatch",
        missingSources,
        modelID: input.model.id,
        sessionID: input.sessionID,
      })
    }
  }
}
