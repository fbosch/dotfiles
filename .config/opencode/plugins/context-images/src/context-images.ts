import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve, sep } from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import type { ContextRenderer, RenderedContext } from "./pxpipe"
import { loadRenderedContext } from "./pxpipe"
import type { ContextImagesLogger } from "./logger"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type PendingReplacement = {
  attachmentIDs: string[]
  instructions: string[]
  modelID: string
  parts: Part[]
  paths: string[]
  rendered: RenderedContext
}

type PreparedContext = Omit<PendingReplacement, "attachmentIDs" | "parts">

type InstructionSource = {
  content: string
  path: string
  project: boolean
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

function projectConfigDisabled() {
  return ["1", "true"].includes((process.env.OPENCODE_DISABLE_PROJECT_CONFIG ?? "").toLowerCase())
}

function claudePromptDisabled() {
  return [process.env.OPENCODE_DISABLE_CLAUDE_CODE, process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT].some((value) =>
    ["1", "true"].includes((value ?? "").toLowerCase()),
  )
}

function supportsImageInput(model: { capabilities?: { input?: { image?: boolean } } }) {
  return model.capabilities?.input?.image !== false
}

function replaceSystemInstructions(system: string[], instructions: string[], marker: string) {
  const replaced = [...system]
  let insertedMarker = false
  for (let index = 0; index < replaced.length; index += 1) {
    let value = replaced[index]
    if (!value) continue
    for (const instruction of instructions) {
      if (value.includes(instruction) === false) continue
      value = value.replace(instruction, insertedMarker ? "" : marker)
      insertedMarker = true
    }
    replaced[index] = value
  }
  return replaced
}

function discardAttachments(pending: PendingReplacement) {
  const attachmentIDs = new Set(pending.attachmentIDs)
  pending.parts.splice(0, pending.parts.length, ...pending.parts.filter((part) => attachmentIDs.has(part.id) === false))
}

function compactFactsheet(factsheet: string) {
  const marker = "within the imaged content: "
  const markerIndex = factsheet.indexOf(marker)
  if (factsheet.startsWith("[Exact identifiers") === false || markerIndex < 0 || factsheet.trimEnd().endsWith("]") === false) {
    return factsheet.trim()
  }
  return factsheet
    .slice(markerIndex + marker.length, factsheet.trimEnd().length - 1)
    .replace(/ \u00d7\d+/g, "")
}

function buildPrompt(rendered: RenderedContext) {
  const pageCount = rendered.pages.length
  const lastPage = `page-${String(pageCount).padStart(3, "0")}.png`
  const readPages = pageCount === 1 ? "Read page-001.png." : `Read page-001.png through ${lastPage} in order.`
  const dropped = rendered.prompt.match(/Note: (\d+) identifier\(s\) were extracted but not captured/)
  const warning = dropped
    ? `The index omitted ${dropped[1]} extracted strings; transcribe unlisted exact values carefully.`
    : undefined
  return [
    `${readPages} Use the index to copy exact strings; derive all rules and meaning from ${pageCount === 1 ? "the image" : "the images"}.`,
    warning,
    "",
    "Exact strings:",
    compactFactsheet(rendered.factsheet) || "(none)",
  ]
    .filter((line) => line !== undefined)
    .join("\n")
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
  readonly #compacting = new Set<string>()
  readonly #directory: string
  readonly #explicitSources?: { path: string; project: boolean }[]
  readonly #pending = new Map<string, PendingReplacement>()
  readonly #renders = new Map<string, Promise<RenderedContext>>()
  readonly #renderer: ContextRenderer
  readonly #logger?: ContextImagesLogger
  readonly #worktree: string
  #configuredInstructions: string[] = []

  constructor(input: {
    cacheRoot?: string
    directory?: string
    logger?: ContextImagesLogger
    renderer: ContextRenderer
    sources?: string[]
    worktree: string
  }) {
    this.#worktree = resolve(input.worktree)
    this.#directory = resolve(input.directory ?? input.worktree)
    this.#cacheRoot = input.cacheRoot ?? defaultCacheRoot()
    this.#renderer = input.renderer
    this.#logger = input.logger
    if (input.sources) this.#explicitSources = this.#resolveSources(input.sources)
  }

  setConfiguredInstructions(instructions: string[]) {
    this.#configuredInstructions = instructions
  }

  markCompacting(sessionID: string) {
    this.#compacting.add(sessionID)
  }

  #resolveSources(sources: string[]) {
    return Array.from(
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

  async #loadSources(sources: { path: string; project: boolean }[]) {
    const loaded = await Promise.all(
      sources.map(async (source): Promise<InstructionSource | undefined> => {
        try {
          return { ...source, content: await readFile(source.path, "utf8") }
        } catch {
          return
        }
      }),
    )
    return loaded.filter((source): source is InstructionSource => source !== undefined)
  }

  #projectCandidates(filename: string) {
    const paths: string[] = []
    let directory = this.#directory
    if (directory !== this.#worktree && directory.startsWith(this.#worktree + sep) === false) return paths
    while (true) {
      paths.push(join(directory, filename))
      if (directory === this.#worktree) break
      const parent = resolve(directory, "..")
      if (parent === directory || directory.startsWith(this.#worktree + sep) === false) break
      directory = parent
    }
    return paths
  }

  async #discoverSources() {
    if (this.#explicitSources) {
      const sources = this.#explicitSources.filter(
        (source) => projectConfigDisabled() === false || source.project === false,
      )
      return await this.#loadSources(sources)
    }

    const configRoot = process.env.OPENCODE_CONFIG_DIR
      ? resolve(process.env.OPENCODE_CONFIG_DIR)
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
    const sources: InstructionSource[] = []
    const globalAgents = await this.#loadSources([{ path: join(configRoot, "AGENTS.md"), project: false }])
    sources.push(...globalAgents)
    if (globalAgents.length === 0 && claudePromptDisabled() === false) {
      sources.push(...(await this.#loadSources([{ path: join(homedir(), ".claude", "CLAUDE.md"), project: false }])))
    }

    if (projectConfigDisabled() === false) {
      const projectFiles = ["AGENTS.md", ...(claudePromptDisabled() ? [] : ["CLAUDE.md"]), "CONTEXT.md"]
      for (const filename of projectFiles) {
        const project = await this.#loadSources(
          this.#projectCandidates(filename).map((path) => ({ path, project: true })),
        )
        if (project.length > 0) {
          sources.push(...project)
          break
        }
      }
    }

    const configured = this.#configuredInstructions
      .filter((source) => source.startsWith("http://") === false && source.startsWith("https://") === false)
      .flatMap((source) => {
        if (source.startsWith("~/")) return [{ path: resolve(homedir(), source.slice(2)), project: false }]
        if (isAbsolute(source)) return [{ path: resolve(source), project: false }]
        if (projectConfigDisabled()) return []
        return [{ path: resolve(this.#directory, source), project: true }]
      })
    sources.push(...(await this.#loadSources(configured)))

    return Array.from(new Map(sources.map((source) => [source.path, source])).values())
  }

  async #prepareSources(sources: InstructionSource[], modelID: string): Promise<PreparedContext | undefined> {
    if (sources.length === 0) return

    const instructions = sources.map((source) => `Instructions from: ${source.path}\n${source.content}`)
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
    return {
      instructions,
      modelID,
      paths: sources.map((source) => source.path),
      rendered: { ...rendered, prompt: buildPrompt(rendered) },
    }
  }

  async #prepare(modelID: string) {
    return await this.#prepareSources(await this.#discoverSources(), modelID)
  }

  async transformMessages(_input: Record<string, never>, output: MessagesOutput) {
    const user = latestUser(output.messages)
    if (!user || user.info.role !== "user") return

    const sessionID = user.info.sessionID
    this.#pending.delete(sessionID)
    if (this.#compacting.delete(sessionID)) return

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
    this.#pending.set(sessionID, {
      ...prepared,
      attachmentIDs: parts.map((part) => part.id),
      parts: user.parts,
    })
  }

  async transformSystem(
    input: { sessionID?: string; model: { id: string; capabilities?: { input?: { image?: boolean } } } },
    output: SystemOutput,
  ) {
    if (!input.sessionID) return

    const pending = this.#pending.get(input.sessionID)
    if (!pending) return
    if (pending.modelID !== input.model.id) return
    if (supportsImageInput(input.model) === false) {
      this.#pending.delete(input.sessionID)
      discardAttachments(pending)
      return
    }

    const marker = "The latest user message contains a context package that replaces the configured system instructions."
    const matchCounts = pending.instructions.map((instruction) =>
      output.system.reduce((count, system) => count + system.split(instruction).length - 1, 0),
    )
    if (matchCounts.every((count) => count === 0)) return

    this.#pending.delete(input.sessionID)
    const missingSources = pending.paths.filter((_, index) => matchCounts[index] !== 1)
    if (missingSources.length > 0) {
      await this.#logger?.write({
        event: "replacement_mismatch",
        missingSources,
        modelID: input.model.id,
        sessionID: input.sessionID,
      })
      discardAttachments(pending)
      return
    }

    output.system.splice(0, output.system.length, ...replaceSystemInstructions(output.system, pending.instructions, marker))
  }
}
