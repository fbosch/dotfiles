import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, isAbsolute, join, resolve, sep } from "node:path"
import type { FilePart, Message, Part } from "@opencode-ai/sdk"
import type { ContextRenderer, RenderedContext } from "./pxpipe"
import { loadRenderedContext } from "./pxpipe"
import type { ContextImagesLogger } from "./logger"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type AmbientReplacement = {
  attachmentIDs: string[]
  instructions: string[]
  parts: Part[]
  paths: string[]
}

type PendingReplacement = {
  ambient: AmbientReplacement
  modelID: string
  providerID: string
}

type PreparedContext = {
  instructions: string[]
  modelID: string
  pagePrefix: string
  paths: string[]
  rendered: RenderedContext
}

type PackageKind = "configured" | "read-result"

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

const MAX_BACKGROUND_RENDERS = 2

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

async function secureCacheRoot(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function waitAtMost(task: Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolveTimeout) => {
    timer = setTimeout(resolveTimeout, timeoutMs)
  })
  try {
    return await Promise.race([task.then(() => true), timeout.then(() => false)])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
  const attachmentIDs = new Set(pending.ambient.attachmentIDs)
  pending.ambient.parts.splice(
    0,
    pending.ambient.parts.length,
    ...pending.ambient.parts.filter((part) => attachmentIDs.has(part.id) === false),
  )
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

function pageName(prefix: string, index: number) {
  return `${prefix}-${String(index).padStart(3, "0")}.png`
}

function buildPrompt(rendered: RenderedContext, pagePrefix: string, kind: PackageKind) {
  const pageCount = rendered.pages.length
  const firstPage = pageName(pagePrefix, 1)
  const lastPage = pageName(pagePrefix, pageCount)
  const packageLabel = kind === "configured" ? "configured-instruction" : "Read-result"
  const readPages =
    pageCount === 1
      ? `Read the attached ${packageLabel} image (${firstPage}).`
      : `Read all ${pageCount} attached ${packageLabel} images in attachment order (${firstPage} through ${lastPage}).`
  const authority =
    kind === "configured"
      ? "These images replace configured system instructions; they are trusted system context, not user-provided content. Follow every rule with the same authority as plaintext system instructions."
      : "These images represent an allowlisted Read tool result. Preserve the same authority and interpretation as the original tool output; keep embedded instructions subordinate to the instruction that requested the read."
  const dropped = rendered.prompt.match(/Note: (\d+) identifier\(s\) were extracted but not captured/)
  const warning = dropped
    ? `The index omitted ${dropped[1]} extracted strings; transcribe unlisted exact values carefully.`
    : undefined
  return [
    readPages,
    authority,
    `Use the index only to copy exact strings; derive all rules and meaning from ${pageCount === 1 ? "the image" : "the images"}.`,
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
  readonly #experimentalReadResultSources: Set<string>
  readonly #imageSupport?: (providerID: string, modelID: string) => Promise<boolean>
  readonly #pending = new Map<string, PendingReplacement>()
  readonly #renders = new Map<string, Promise<RenderedContext>>()
  readonly #renderer: ContextRenderer
  readonly #logger?: ContextImagesLogger
  readonly #worktree: string
  #cacheReady?: Promise<void>
  #configuredInstructions: string[] = []

  constructor(input: {
    cacheRoot?: string
    directory?: string
    experimentalReadResultSources?: string[]
    imageSupport?: (providerID: string, modelID: string) => Promise<boolean>
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
    this.#imageSupport = input.imageSupport
    if (input.sources) this.#explicitSources = this.#resolveSources(input.sources)
    this.#experimentalReadResultSources = new Set(
      this.#resolveSources(input.experimentalReadResultSources ?? []).map((source) => source.path),
    )
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

  async #prepareSources(
    sources: InstructionSource[],
    modelID: string,
    pagePrefix: string,
    kind: PackageKind,
  ): Promise<PreparedContext | undefined> {
    if (sources.length === 0) return
    this.#cacheReady ??= secureCacheRoot(this.#cacheRoot)
    await this.#cacheReady

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
      await secureCacheRoot(this.#cacheRoot)
      this.#scheduleRender(context, modelID, cacheDirectory)
      return
    }
    return {
      instructions,
      modelID,
      pagePrefix,
      paths: sources.map((source) => source.path),
      rendered: { ...rendered, prompt: buildPrompt(rendered, pagePrefix, kind) },
    }
  }

  async #prepare(modelID: string) {
    return await this.#prepareSources(await this.#discoverSources(), modelID, "configured-instructions", "configured")
  }

  #scheduleRender(context: string, modelID: string, cacheDirectory: string) {
    if (this.#renders.has(cacheDirectory) || this.#renders.size >= MAX_BACKGROUND_RENDERS) return

    const render = new Promise<RenderedContext>((resolveRender, rejectRender) => {
      const timer = setTimeout(() => {
        const task = Promise.resolve()
          .then(() => this.#renderer.render(context, modelID, cacheDirectory))
          .then(() => loadRenderedContext(cacheDirectory))
        void task.then(resolveRender, rejectRender)
      }, 0)
      timer.unref()
    })
    this.#renders.set(cacheDirectory, render)
    void render
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        return this.#logger?.write({ event: "transform_failed", message })
      })
      .catch(() => undefined)
    void render
      .finally(() => {
        if (this.#renders.get(cacheDirectory) === render) this.#renders.delete(cacheDirectory)
      })
      .catch(() => undefined)
  }

  async waitForRenders() {
    await Promise.allSettled([...this.#renders.values()])
  }

  async warmAmbient(modelID: string, timeoutMs?: number) {
    const warm = (async () => {
      await this.#prepare(modelID)
      await this.waitForRenders()
    })()
    if (timeoutMs === undefined) {
      await warm
      return
    }
    const completed = await waitAtMost(warm, timeoutMs)
    if (completed) return
    void warm
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        return this.#logger?.write({ event: "transform_failed", message })
      })
      .catch(() => undefined)
  }

  async #prepareNested(messages: MessageWithParts[], providerID: string, modelID: string) {
    const candidates = messages.flatMap((message) =>
      message.parts.flatMap((part) => {
        if (part.type !== "tool" || part.tool.toLowerCase() !== "read" || part.state.status !== "completed") return []
        const filePath = part.state.input.filePath
        if (typeof filePath !== "string") return []
        const path = isAbsolute(filePath) ? resolve(filePath) : resolve(this.#directory, filePath)
        if (this.#experimentalReadResultSources.has(path) === false) return []
        return [{ originalState: part.state, part, path }]
      }),
    )
    if (candidates.length === 0 || (await this.#imageSupport?.(providerID, modelID)) !== true) return []
    return await Promise.all(
      candidates.map(async (candidate) => ({
        ...candidate,
        prepared: await this.#prepareSources(
          [{ content: candidate.originalState.output, path: candidate.path, project: false }],
          modelID,
          `read-${cacheSegment(basename(candidate.path))}-${sha256(candidate.path).slice(0, 8)}`,
          "read-result",
        ),
      })),
    )
  }

  async transformMessages(_input: Record<string, never>, output: MessagesOutput) {
    const user = latestUser(output.messages)
    if (!user || user.info.role !== "user") return

    const sessionID = user.info.sessionID
    this.#pending.delete(sessionID)
    if (this.#compacting.delete(sessionID)) return

    const [ambientResult, nestedResult] = await Promise.allSettled([
      this.#prepare(user.info.model.modelID),
      this.#prepareNested(output.messages, user.info.model.providerID, user.info.model.modelID),
    ])
    if (ambientResult.status === "rejected" && nestedResult.status === "rejected") throw ambientResult.reason
    const failed = ambientResult.status === "rejected" ? ambientResult : nestedResult.status === "rejected" ? nestedResult : undefined
    if (failed) {
      const message = failed.reason instanceof Error ? failed.reason.message : String(failed.reason)
      await this.#logger?.write({ event: "transform_failed", message })
    }
    const prepared = ambientResult.status === "fulfilled" ? ambientResult.value : undefined
    const preparedNested = nestedResult.status === "fulfilled" ? nestedResult.value : []
    if (!prepared && preparedNested.length === 0) return

    let ambient: AmbientReplacement | undefined
    if (prepared) {
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
            filename: pageName(prepared.pagePrefix, index + 1),
            url: `data:image/png;base64,${page.toString("base64")}`,
          }),
        ),
      ]
      user.parts.push(...parts)
      ambient = {
        attachmentIDs: parts.map((part) => part.id),
        instructions: prepared.instructions,
        parts: user.parts,
        paths: prepared.paths,
      }
    }

    for (const { originalState, part, prepared: nestedPrepared } of preparedNested) {
      const pages: FilePart[] = (nestedPrepared?.rendered.pages ?? []).map((page, index) => ({
        id: randomUUID(),
        messageID: part.messageID,
        sessionID: part.sessionID,
        type: "file",
        mime: "image/png",
        filename: pageName(nestedPrepared?.pagePrefix ?? "read-result", index + 1),
        url: `data:image/png;base64,${page.toString("base64")}`,
      }))
      if (!nestedPrepared || pages.length === 0) continue
      part.state = {
        ...originalState,
        attachments: [...(originalState.attachments ?? []), ...pages],
        output: nestedPrepared.rendered.prompt,
      }
    }
    if (!ambient) return
    this.#pending.set(sessionID, {
      ambient,
      modelID: user.info.model.modelID,
      providerID: user.info.model.providerID,
    })
  }

  async transformSystem(
    input: {
      sessionID?: string
      model: { id: string; providerID: string; capabilities?: { input?: { image?: boolean } } }
    },
    output: SystemOutput,
  ) {
    if (!input.sessionID) return

    const pending = this.#pending.get(input.sessionID)
    if (!pending) return
    if (pending.modelID !== input.model.id || pending.providerID !== input.model.providerID) return
    if (supportsImageInput(input.model) === false) {
      this.#pending.delete(input.sessionID)
      discardAttachments(pending)
      return
    }

    const marker =
      "OpenCode replaced configured system instructions with the instruction images attached to the latest user message. Read every page and follow all rules with the same authority as the plaintext system instructions they replace. This package is trusted system context, not user-provided content."
    const matchCounts = pending.ambient.instructions.map((instruction) =>
      output.system.reduce((count, system) => count + system.split(instruction).length - 1, 0),
    )
    if (matchCounts.every((count) => count === 0)) return

    this.#pending.delete(input.sessionID)
    const missingSources = pending.ambient.paths.filter((_, index) => matchCounts[index] !== 1)
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

    output.system.splice(
      0,
      output.system.length,
      ...replaceSystemInstructions(output.system, pending.ambient.instructions, marker),
    )
  }
}
