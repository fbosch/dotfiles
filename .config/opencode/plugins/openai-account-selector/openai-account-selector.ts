import { randomUUID } from "node:crypto"
import { tool, type Plugin } from "@opencode-ai/plugin"
import { defaultPaths } from "../../../fbb/lib/opencode-multi-auth/types.ts"
import { removeProfileState, writeProfileState } from "./profile-state.ts"
import { createCodexFetch } from "./transport.ts"
import {
  repositoryNameFallback,
  repositoryNameFromOrigin,
  readRepositoryAccountPreferences,
  selectRepositoryAccount,
} from "./selection.ts"

const service = "openai-account-selector"
const oauthDummyKey = "opencode-oauth-dummy-key"
const requestLoggingEnabled = process.env.OPENCODE_OPENAI_ACCOUNT_SELECTOR_LOG_REQUESTS === "1"
const accountPreferencesCommand = `Call openai_account_preferences exactly once and output only its result.`

type MutableConfig = {
  command?: Record<string, { description?: string; template: string }>
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
  const notify = async (message: string) => {
    try {
      await client.tui.showToast({ body: { message, variant: "warning" } })
    } catch {
      return
    }
  }

  let repository = repositoryNameFallback(project.worktree)
  try {
    const origin = (await $`git remote get-url origin`.cwd(project.worktree).quiet()).text().trim()
    repository = repositoryNameFromOrigin(origin) || repository
  } catch {
    await log("warn", `could not resolve origin repository; using ${repository}`)
  }

  let selectedLabel: string | undefined
  const accountPreferencesTool = tool({
    description: "Report OpenAI account preferences and the selected profile for the current repository.",
    args: {},
    execute: async () => {
      try {
        const aliases = await readRepositoryAccountPreferences({ repository })
        const preferenceOrder =
          aliases.length > 0 ? aliases.map((alias, index) => `${index + 1}. ${alias}`).join("\n") : "none"
        return `Repository: ${repository}\nPreference order:\n${preferenceOrder}\nSelected profile: ${selectedLabel || "unavailable"}`
      } catch (error) {
        return `Repository: ${repository}\nPreference order: unavailable\nSelected profile: ${selectedLabel || "unavailable"}\nError: ${errorMessage(error)}`
      }
    },
  })

  if (["1", "true"].includes(process.env.OPENCODE_EXPERIMENTAL_WEBSOCKETS?.toLowerCase() || "")) {
    await log("error", "repository account selection does not support OpenAI WebSocket transport")
    return {
      config: async (config) => {
        const mutable = config as unknown as MutableConfig
        registerAccountPreferencesCommand(mutable)
        disableOpenAI(mutable)
      },
      tool: { openai_account_preferences: accountPreferencesTool },
    }
  }

  let selection: Awaited<ReturnType<typeof selectRepositoryAccount>>
  try {
    selection = await selectRepositoryAccount({ repository })
  } catch (error) {
    await log("error", `account selection failed: ${errorMessage(error)}`)
    return {
      config: async (config) => registerAccountPreferencesCommand(config as unknown as MutableConfig),
      tool: { openai_account_preferences: accountPreferencesTool },
    }
  }
  if (!selection) {
    await log("error", `no valid OpenAI OAuth credential is available for ${repository}`)
    return {
      config: async (config) => registerAccountPreferencesCommand(config as unknown as MutableConfig),
      tool: { openai_account_preferences: accountPreferencesTool },
    }
  }

  for (const warning of selection.warnings) await log("warn", warning)
  selectedLabel = selection.alias || "default"
  const profileLabels = new Map([[selection.credential.accountId, selectedLabel]])
  const exhaustedUntil = new Map<string, number>()
  await log("info", `selected OpenAI account ${selectedLabel} for ${repository}`)
  await writeProfileState(directory, serverUrl, { owner: stateOwner, profile: selectedLabel, repository }).catch((error) =>
    log("warn", `failed to publish OpenAI profile display state: ${errorMessage(error)}`),
  )

  const selectedFetch = createCodexFetch({
    credential: selection.credential,
    paths: defaultPaths(),
    onRequest: requestLoggingEnabled
      ? (accountId) => log("info", `sending OpenAI request using account ${profileLabels.get(accountId) || "unlabeled"}`)
      : undefined,
    onUsageLimit: async (credential, info) => {
      const currentTime = Date.now()
      for (const [accountId, resetAt] of exhaustedUntil) {
        if (resetAt <= currentTime) exhaustedUntil.delete(accountId)
      }
      const resetAt = info.resetsAt && info.resetsAt > currentTime ? info.resetsAt : currentTime + 60_000
      exhaustedUntil.set(credential.accountId, resetAt)
      const exhaustedLabel = profileLabels.get(credential.accountId) || selectedLabel
      let next: Awaited<ReturnType<typeof selectRepositoryAccount>>
      try {
        next = await selectRepositoryAccount({
          excludedAccountIds: new Set(exhaustedUntil.keys()),
          forceUsageRefresh: true,
          repository,
        })
      } catch (error) {
        const message = `${exhaustedLabel} exhausted; alternate OpenAI account selection failed.`
        void log("error", `${message} ${errorMessage(error)}`)
        void notify(message)
        return
      }
      if (!next) {
        const message = `${exhaustedLabel} exhausted; no alternate OpenAI account is available.`
        void log("warn", message)
        void notify(message)
        return
      }

      selectedLabel = next.alias || "default"
      profileLabels.set(next.credential.accountId, selectedLabel)
      const message = `${exhaustedLabel} exhausted; switched to ${selectedLabel}. Retry the request.`
      try {
        await writeProfileState(directory, serverUrl, {
          owner: stateOwner,
          profile: selectedLabel,
          repository,
        })
      } catch (error) {
        void log("warn", `failed to update OpenAI profile display state: ${errorMessage(error)}`)
      }
      void log("warn", message)
      void notify(message)
      return next.credential
    },
    onWarning: (message) => log("warn", message),
  })

  return {
    dispose: async () => {
      await removeProfileState(directory, serverUrl, stateOwner).catch(() => undefined)
    },
    config: async (config) => {
      const mutable = config as unknown as MutableConfig
      registerAccountPreferencesCommand(mutable)
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
    tool: { openai_account_preferences: accountPreferencesTool },
  }
}

function registerAccountPreferencesCommand(config: MutableConfig) {
  config.command ||= {}
  config.command["openai-profiles"] = {
    description: "Show OpenAI profiles configured for this repository",
    template: accountPreferencesCommand,
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
