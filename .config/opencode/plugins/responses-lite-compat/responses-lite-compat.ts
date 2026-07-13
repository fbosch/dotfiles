import type { Plugin } from "@opencode-ai/plugin"
import { installResponsesLiteCompatibility } from "./adapter"

export const ResponsesLiteCompatibilityPlugin: Plugin = async () => {
  installResponsesLiteCompatibility()
  return {}
}

export default ResponsesLiteCompatibilityPlugin
