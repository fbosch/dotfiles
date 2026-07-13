import type { Plugin } from "@opencode-ai/plugin"
import { ContextImagesService } from "./context-images"
import { PxpipeRenderer } from "./pxpipe"

let warned = false

function warnOnce(error: unknown) {
  if (warned) return
  warned = true
  const detail = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[context-images] preserving text instructions: ${detail}\n`)
}

export const ContextImagesPlugin: Plugin = async ({ worktree }) => {
  const service = new ContextImagesService({ renderer: new PxpipeRenderer(), worktree })

  return {
    "experimental.chat.messages.transform": async (input, output) => {
      try {
        await service.transformMessages(input, output)
      } catch (error) {
        warnOnce(error)
      }
    },
    "experimental.chat.system.transform": service.transformSystem.bind(service),
  }
}
