import { tool, type Plugin } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { ContextImagesService } from "./context-images"
import { JsonlLogger } from "./logger"
import { PxpipeRenderer } from "./pxpipe"
import { ContextImagesStats } from "./stats"

let warned = false
const STARTUP_WARM_TIMEOUT_MS = 1_000
const MINIMUM_SAVINGS_TOKENS = 1
const STATS_COMMAND = `Scope: $ARGUMENTS

If Scope is empty, use session. If Scope is not exactly session, repo, or total, output only:
Usage: /context-images-stats [session|repo|total]

Otherwise call context_image_stats exactly once with the selected scope and output only its result.`

function warnOnce(error: unknown) {
  if (warned) return
  warned = true
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[context-images] preserving text instructions: ${detail}\n`)
}

function configuredModelID(model: unknown) {
  if (typeof model !== "string") return
  const separator = model.indexOf("/")
  if (separator < 1 || separator === model.length - 1) return
  return model.slice(separator + 1)
}

export type ImageReadResults = {
  filenames?: string[]
  paths?: string[]
  referenceContents?: boolean
}

export function parseImageReadResults(options: Record<string, unknown>): ImageReadResults | undefined {
  if ("readResultSources" in options) {
    throw new Error('[context-images] option "readResultSources" was replaced by "imageReadResults.paths"')
  }
  const imageReadResults = options.imageReadResults
  if (imageReadResults === undefined) return
  if (typeof imageReadResults !== "object" || imageReadResults === null || Array.isArray(imageReadResults)) {
    throw new Error('[context-images] option "imageReadResults" must be an object')
  }
  const { filenames, paths, referenceContents, ...unknown } = imageReadResults as Record<string, unknown>
  if (Object.keys(unknown).length > 0) {
    throw new Error('[context-images] option "imageReadResults" only supports "paths", "filenames", and "referenceContents"')
  }
  if (paths !== undefined && (Array.isArray(paths) === false || paths.some((path) => typeof path !== "string" || path.trim().length === 0))) {
    throw new Error('[context-images] option "imageReadResults.paths" must be an array of non-empty paths')
  }
  if (
    filenames !== undefined &&
    (Array.isArray(filenames) === false ||
      filenames.some(
        (filename) =>
          typeof filename !== "string" ||
          filename.trim().length === 0 ||
          filename === "." ||
          filename === ".." ||
          filename.includes("/") ||
          filename.includes("\\"),
      ))
  ) {
    throw new Error('[context-images] option "imageReadResults.filenames" must be an array of non-empty basenames')
  }
  if (referenceContents !== undefined && typeof referenceContents !== "boolean") {
    throw new Error('[context-images] option "imageReadResults.referenceContents" must be a boolean')
  }
  return {
    ...(paths === undefined ? {} : { paths: paths as string[] }),
    ...(filenames === undefined ? {} : { filenames: filenames as string[] }),
    ...(referenceContents === undefined ? {} : { referenceContents }),
  }
}

export function materializedReferencePaths(response: unknown) {
  if (typeof response !== "object" || response === null) return []
  const data = (response as Record<string, unknown>).data
  if (Array.isArray(data) === false) return []
  return data.flatMap((reference) => {
    if (typeof reference !== "object" || reference === null) return []
    const path = (reference as Record<string, unknown>).path
    return typeof path === "string" ? [path] : []
  })
}

type ReferenceClient = {
  v2: {
    reference: {
      list(input: { location: { directory: string } }): Promise<{ data?: unknown }>
    }
  }
}

export async function fetchMaterializedReferencePaths(client: ReferenceClient, directory: string) {
  const response = await client.v2.reference.list({ location: { directory } })
  const data = response.data
  if (typeof data !== "object" || data === null || Array.isArray((data as Record<string, unknown>).data) === false) {
    throw new Error("OpenCode returned an invalid reference list")
  }
  return materializedReferencePaths(data)
}

export function cachedReferenceRoots(fetchRoots: () => Promise<string[]>) {
  let roots: Promise<string[]> | undefined
  return async () => {
    const request = (roots ??= fetchRoots())
    try {
      return await request
    } catch {
      if (roots === request) roots = undefined
      return []
    }
  }
}

export const ContextImagesPlugin: Plugin = async ({ client, directory, project, serverUrl, worktree }, options = {}) => {
  if ("sources" in options) {
    throw new Error('[context-images] option "sources" is no longer supported; use OpenCode instruction discovery')
  }
  const imageReadResults = parseImageReadResults(options)
  const scopedInstructions = options.scopedInstructions
  if (scopedInstructions !== undefined && typeof scopedInstructions !== "boolean") {
    throw new Error('[context-images] option "scopedInstructions" must be a boolean')
  }
  const logFile = typeof options.logFile === "string" ? options.logFile : undefined
  const logger = new JsonlLogger(logFile)
  const stats = new ContextImagesStats({ repoID: project.id, worktree })
  await logger.write({ event: "plugin_loaded" })
  let providers: ReturnType<typeof client.config.providers> | undefined
  const referenceClient = createOpencodeClient({ baseUrl: serverUrl.toString() })
  const service = new ContextImagesService({
    directory,
    imageReadResults,
    referenceRoots: cachedReferenceRoots(async () => await fetchMaterializedReferencePaths(referenceClient, directory)),
    scopedInstructions,
    imageSupport: async (providerID, modelID) => {
      const request = (providers ??= client.config.providers({ query: { directory } }))
      const response = await request.catch(() => undefined)
      if (!response?.data) {
        if (providers === request) providers = undefined
        return false
      }
      const model = response.data.providers.find((provider) => provider.id === providerID)?.models[modelID]
      return model?.capabilities.input.image === true
    },
    logger,
    minimumSavingsTokens: MINIMUM_SAVINGS_TOKENS,
    renderer: new PxpipeRenderer(),
    stats,
    worktree,
  })

  return {
    config: async (config) => {
      config.command = config.command || {}
      config.command["context-images-stats"] = {
        description: "Show estimated context-image token savings",
        template: STATS_COMMAND,
      }
      service.setConfiguredInstructions(config.instructions ?? [])
      const modelID = configuredModelID(config.model)
      if (!modelID) return
      try {
        await service.warmAmbient(modelID, STARTUP_WARM_TIMEOUT_MS)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logger.write({ event: "transform_failed", message })
        warnOnce(error)
      }
    },
    "experimental.session.compacting": async (input) => {
      service.markCompacting(input.sessionID)
    },
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        await service.transformMessages(input, output)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logger.write({ event: "transform_failed", message })
        warnOnce(error)
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      try {
        await service.transformSystem(input, output)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await logger.write({ event: "transform_failed", message })
        warnOnce(error)
      }
    },
    tool: {
      context_image_stats: tool({
        description: "Report estimated context-image token savings for the current session, repository, or all usage.",
        args: {
          scope: tool.schema.enum(["session", "repo", "total"]).optional(),
        },
        execute: async ({ scope }, context) => await stats.report(scope ?? "session", context.sessionID),
      }),
    },
  }
}
