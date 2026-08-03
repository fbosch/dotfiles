import type { Plugin } from "@opencode-ai/plugin"
import { HerdrReporter } from "./herdr-reporter"

export const NeovimHerdrAgentPlugin: Plugin = async () => {
  const reporter = await HerdrReporter.startFromEnvironment()
  if (reporter === undefined) return {}

  return reporter.hooks()
}

export default NeovimHerdrAgentPlugin
