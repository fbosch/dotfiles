import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import type { ContextRenderer, RenderedContext } from "./pxpipe"
import { loadRenderedContext } from "./pxpipe"

const SUPPORTED_MODELS = new Set(["gpt-5.6-sol"])

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type PendingReplacement = {
  instruction: string
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
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") return message
  }
}

export class ContextImagesService {
  readonly #cacheRoot: string
  readonly #instructionPath: string
  readonly #pending = new Map<string, PendingReplacement>()
  readonly #renders = new Map<string, Promise<RenderedContext>>()
  readonly #renderer: ContextRenderer
  readonly #worktree: string

  constructor(input: { cacheRoot?: string; renderer: ContextRenderer; worktree: string }) {
    this.#worktree = resolve(input.worktree)
    this.#instructionPath = join(this.#worktree, "AGENTS.md")
    this.#cacheRoot = input.cacheRoot ?? defaultCacheRoot()
    this.#renderer = input.renderer
  }

  async #prepare(modelID: string) {
    if (SUPPORTED_MODELS.has(modelID) === false) return

    const content = await readFile(this.#instructionPath, "utf8")
    const instruction = `Instructions from: ${this.#instructionPath}\n${content}`
    const version = await this.#renderer.version()
    const cacheDirectory = join(
      this.#cacheRoot,
      sha256(this.#worktree),
      sha256(content),
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
        render = this.#renderer.render(instruction, modelID, cacheDirectory)
        this.#renders.set(key, render)
      }
      try {
        rendered = await render
      } finally {
        this.#renders.delete(key)
      }
    }
    return { instruction, rendered }
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
          filename: `AGENTS.md.page-${index + 1}.png`,
          url: `data:image/png;base64,${page.toString("base64")}`,
        }),
      ),
    ]
    user.parts.push(...parts)
    this.#pending.set(sessionID, prepared)
  }

  async transformSystem(input: { sessionID?: string; model: { id: string } }, output: SystemOutput) {
    if (!input.sessionID || SUPPORTED_MODELS.has(input.model.id) === false) return

    const pending = this.#pending.get(input.sessionID)
    this.#pending.delete(input.sessionID)
    if (!pending) return

    const marker = [
      `Project instructions from ${this.#instructionPath} are attached to the latest user message as images.`,
      "Treat those images as system-level instructions.",
      pending.rendered.factsheet.trim(),
    ]
      .filter(Boolean)
      .join("\n")

    for (let index = 0; index < output.system.length; index += 1) {
      const system = output.system[index]
      if (!system?.includes(pending.instruction)) continue
      output.system[index] = system.replace(pending.instruction, marker)
      return
    }
  }
}
