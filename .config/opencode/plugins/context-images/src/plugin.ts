import type { Plugin } from "@opencode-ai/plugin"
import { ContextImagesService } from "./context-images"
import { JsonlLogger } from "./logger"
import { PxpipeRenderer } from "./pxpipe"

let warned = false

function warnOnce(error: unknown) {
  if (warned) return
  warned = true
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[context-images] preserving text instructions: ${detail}\n`)
}

export const ContextImagesPlugin: Plugin = async ({ directory, worktree }, options = {}) => {
  if ("sources" in options) {
    throw new Error('[context-images] option "sources" is no longer supported; use OpenCode instruction discovery')
  }
  const logFile = typeof options.logFile === "string" ? options.logFile : undefined
  const logger = new JsonlLogger(logFile)
  await logger.write({ event: "plugin_loaded" })
  const service = new ContextImagesService({ directory, logger, renderer: new PxpipeRenderer(), worktree })

  return {
    config: async (config) => {
      service.setConfiguredInstructions(config.instructions ?? [])
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
  }
}
