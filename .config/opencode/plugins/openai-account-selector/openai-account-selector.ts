import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode-ai/plugin"
import { defaultPaths } from "../../../fbb/lib/opencode-multi-auth/types.ts"
import { removeProfileState, writeProfileState } from "./profile-state.ts"
import { createCodexFetch } from "./transport.ts"
import {
  repositoryNameFallback,
  repositoryNameFromOrigin,
  selectRepositoryAccount,
} from "./selection.ts"

const service = "openai-account-selector"
const oauthDummyKey = "opencode-oauth-dummy-key"

type MutableConfig = {
  disabled_providers?: string[]
  provider?: Record<string, { options?: Record<string, unknown>; [key: string]: unknown }>
}

export const OpenAIAccountSelectorPlugin: Plugin = async ({ $, client, directory, project, serverUrl }) => {
  const stateOwner = randomUUID()
  const log = async (level: "info" | "warn" | "error", message: string) => {
    try {
      await client.app.log({ body: { service, level, message } })
    } catch {
      // Logging must not determine whether account isolation is installed.
    }
  }

  await removeProfileState(directory, serverUrl).catch(() => undefined)

  if (["1", "true"].includes(process.env.OPENCODE_EXPERIMENTAL_WEBSOCKETS?.toLowerCase() || "")) {
    await log("error", "repository account selection does not support OpenAI WebSocket transport")
    return {
      config: async (config) => disableOpenAI(config as unknown as MutableConfig),
    }
  }

  let repository = repositoryNameFallback(project.worktree)
  try {
    const origin = (await $`git remote get-url origin`.cwd(project.worktree).quiet()).text().trim()
    repository = repositoryNameFromOrigin(origin) || repository
  } catch {
    await log("warn", `could not resolve origin repository; using ${repository}`)
  }

  let selection: Awaited<ReturnType<typeof selectRepositoryAccount>>
  try {
    selection = await selectRepositoryAccount({ repository })
  } catch (error) {
    await log("error", `account selection failed: ${errorMessage(error)}`)
    return {}
  }
  if (!selection) {
    await log("error", `no valid OpenAI OAuth credential is available for ${repository}`)
    return {}
  }

  for (const warning of selection.warnings) await log("warn", warning)
  const selectedLabel = selection.alias || "default"
  await log("info", `selected OpenAI account ${selectedLabel} for ${repository}`)
  await writeProfileState(directory, serverUrl, { owner: stateOwner, profile: selectedLabel, repository }).catch((error) =>
    log("warn", `failed to publish OpenAI profile display state: ${errorMessage(error)}`),
  )

  const selectedFetch = createCodexFetch({
    credential: selection.credential,
    paths: defaultPaths(),
    onWarning: (message) => log("warn", message),
  })

  return {
    dispose: async () => {
      await removeProfileState(directory, serverUrl, stateOwner).catch(() => undefined)
    },
    config: async (config) => {
      const mutable = config as unknown as MutableConfig
      mutable.disabled_providers = (mutable.disabled_providers || []).filter((provider) => provider !== "openai")
      mutable.provider ||= {}
      const openai = mutable.provider.openai || {}
      mutable.provider.openai = {
        ...openai,
        options: {
          ...openai.options,
          apiKey: oauthDummyKey,
          fetch: selectedFetch,
        },
      }
    },
  }
}

function disableOpenAI(config: MutableConfig) {
  config.disabled_providers ||= []
  if (config.disabled_providers.includes("openai") === false) config.disabled_providers.push("openai")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export default OpenAIAccountSelectorPlugin
