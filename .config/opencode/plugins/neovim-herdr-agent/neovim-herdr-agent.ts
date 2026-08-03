import type { Plugin } from "@opencode-ai/plugin"
import { HerdrReporter } from "./herdr-reporter"

export const NeovimHerdrAgentPlugin: Plugin = async () => {
  // Neovim restores this OpenCode session, not Herdr's native agent recovery.
  const reporter = await HerdrReporter.startFromEnvironment()
  if (reporter === undefined) return {}

  return {
    "chat.message": ({ sessionID }) => reporter.onChatMessage(sessionID),
    event: ({ event }) => reporter.onEvent(event),
  }
}

export default NeovimHerdrAgentPlugin
