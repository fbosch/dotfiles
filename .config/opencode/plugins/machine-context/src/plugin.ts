import { randomUUID } from "node:crypto"
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import {
  collectDynamicMetadata,
  collectStaticMetadata,
  formatMachineContext,
  marker,
} from "./metadata"

type Part = {
  type?: string
  id?: string
  text?: string
}

type Message = {
  info?: {
    role?: string
  }
  parts: Part[]
}

type TransformOutput = {
  messages?: Message[]
}

class MachineContextService {
  staticMetadata = collectStaticMetadata()

  async transform(_input: Record<string, never>, output: TransformOutput) {
    try {
      const messages = output.messages
      if (!messages?.length) return

      const lastUser = messages.findLast((message) => message.info?.role === "user")
      if (!lastUser) return

      if (
        lastUser.parts.some(
          (part) => part.type === "text" && typeof part.text === "string" && part.text.includes(marker),
        )
      ) {
        return
      }

      const dynamicMetadata = collectDynamicMetadata()
      const text = formatMachineContext(this.staticMetadata, dynamicMetadata)

      lastUser.parts.unshift({
        type: "text",
        id: randomUUID(),
        text,
      })
    } catch {
      return
    }
  }
}

export const MachineContextPlugin: Plugin = async (_input: PluginInput) => {
  const service = new MachineContextService()
  return {
    "experimental.chat.messages.transform": service.transform.bind(service),
  }
}
