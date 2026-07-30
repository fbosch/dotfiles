import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import {
  accountIdForEntry,
  aliasesFor,
  discoverUsage,
  fetchUsage,
  profilesFromAuth,
} from "../../../fbb/lib/opencode-multi-auth/providers/codex.ts"
import { isJsonObject, readJsonObject, type JsonObject } from "../../../fbb/lib/opencode-multi-auth/storage.ts"
import { defaultPaths, type AccountPaths, type AccountProfile, type AccountUsage } from "../../../fbb/lib/opencode-multi-auth/types.ts"
import { refreshOAuthCredential } from "./transport.ts"

export type OAuthCredential = {
  accountId: string
  access: string
  expires: number
  refresh: string
}

export type AccountSelection = {
  alias: string | null
  credential: OAuthCredential
  profileKey: string
  repository: string
  source: "mapped" | "fallback"
  warnings: string[]
}

type SelectionOptions = {
  allowFallback?: boolean
  excludedAccountIds?: ReadonlySet<string>
  forceUsageRefresh?: boolean
  mappingPath?: string
  paths?: AccountPaths
  repository: string
}

export const defaultRepositoryMappingPath = (env: NodeJS.ProcessEnv = process.env) => {
  const home = env.HOME || ""
  const configHome = env.XDG_CONFIG_HOME || join(home, ".config")
  return join(configHome, "fbb", "data", "opencode-repository-accounts.json")
}

export const repositoryNameFromOrigin = (origin: string) => {
  const normalized = origin.trim().replace(/\/+$/, "")
  if (!normalized) return

  const component = normalized.split(/[/:]/).at(-1)?.replace(/\.git$/, "")
  if (!component) return

  try {
    return decodeURIComponent(component)
  } catch {
    return component
  }
}

export const repositoryNameFallback = (worktree: string) => basename(worktree.replace(/\/+$/, ""))

export const usageIsAvailable = (usage: AccountUsage) => {
  const reported = [usage.primary.remainingPercent, usage.secondary.remainingPercent].filter(
    (remaining): remaining is number => remaining !== null,
  )
  return reported.length > 0 && reported.every((remaining) => remaining > 0)
}

export async function selectRepositoryAccount({
  allowFallback = true,
  excludedAccountIds = new Set(),
  forceUsageRefresh = false,
  mappingPath = defaultRepositoryMappingPath(),
  paths = defaultPaths(),
  repository,
}: SelectionOptions): Promise<AccountSelection | undefined> {
  const warnings: string[] = []
  const auth = await readJsonObject(paths.auth)
  const fallback = credentialForEntry(auth.openai)
  if (!fallback) return

  let aliases: string[] = []
  try {
    aliases = (await readRepositoryMapping(mappingPath))[repository] || []
  } catch (error) {
    warnings.push(errorMessage(error))
  }

  if (aliases.length > 0) {
    try {
      const selected = await selectMappedAccount(
        aliases,
        auth,
        paths,
        warnings,
        excludedAccountIds,
        forceUsageRefresh,
      )
      if (selected) {
        return {
          ...selected,
          repository,
          source: "mapped",
          warnings,
        }
      }
    } catch (error) {
      warnings.push(`mapped account selection failed: ${errorMessage(error)}`)
    }
  }

  if (allowFallback === false || excludedAccountIds.has(fallback.accountId)) return
  return {
    alias: null,
    credential: fallback,
    profileKey: "openai",
    repository,
    source: "fallback",
    warnings,
  }
}

async function selectMappedAccount(
  aliases: string[],
  auth: JsonObject,
  paths: AccountPaths,
  warnings: string[],
  excludedAccountIds: ReadonlySet<string>,
  forceUsageRefresh: boolean,
): Promise<Omit<AccountSelection, "repository" | "source" | "warnings"> | undefined> {
  const aliasesDocument = await readJsonObject(paths.aliases)
  const profiles = profilesFromAuth(auth, aliasesFor(aliasesDocument, paths.aliases))
  const candidates: Array<{ alias: string; credential: OAuthCredential; profile: AccountProfile }> = []

  for (const alias of aliases) {
    const matches = profiles.filter((profile) => profile.alias === alias)
    if (matches.length !== 1) {
      warnings.push(`configured OpenAI alias could not be resolved uniquely: ${alias}`)
      continue
    }

    const credential = credentialForEntry(auth[matches[0].key], matches[0].accountId)
    if (!credential) {
      warnings.push(`configured OpenAI alias has invalid OAuth credentials: ${alias}`)
      continue
    }
    if (excludedAccountIds.has(credential.accountId)) continue
    candidates.push({ alias, credential, profile: matches[0] })
  }

  if (candidates.length === 0) return

  const usageByProfile = forceUsageRefresh
    ? await refreshCandidateUsage(candidates, paths, warnings)
    : (
        await discoverUsage(
          { profiles: candidates.map((candidate) => candidate.profile), diagnostics: [] },
          auth,
          paths,
        )
      ).usageByProfile

  for (const candidate of candidates) {
    const accountUsage = usageByProfile.get(candidate.profile.key)
    if (!accountUsage || usageIsAvailable(accountUsage) === false) {
      warnings.push(`configured OpenAI alias has no confirmed remaining usage: ${candidate.alias}`)
      continue
    }
    return {
      alias: candidate.alias,
      credential: candidate.credential,
      profileKey: candidate.profile.key,
    }
  }
}

async function refreshCandidateUsage(
  candidates: Array<{ alias: string; credential: OAuthCredential; profile: AccountProfile }>,
  paths: AccountPaths,
  warnings: string[],
) {
  const ready = []
  for (const candidate of candidates) {
    try {
      if (!candidate.credential.access || candidate.credential.expires < Date.now()) {
        candidate.credential = await refreshOAuthCredential(candidate.credential, paths)
      }
      ready.push(candidate)
    } catch {
      warnings.push(`configured OpenAI alias credential refresh failed: ${candidate.alias}`)
    }
  }

  const entries = await Promise.all(
    ready.map(async (candidate) => {
      try {
        const usage = await fetchUsage(
          { accessToken: candidate.credential.access, accountId: candidate.credential.accountId },
          paths,
          true,
        )
        return [candidate.profile.key, usage] as const
      } catch {
        warnings.push(`configured OpenAI alias usage request failed: ${candidate.alias}`)
        return
      }
    }),
  )
  return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined))
}

function credentialForEntry(value: unknown, expectedAccountId?: string | null): OAuthCredential | undefined {
  if (isJsonObject(value) === false || value.type !== "oauth") return
  if (typeof value.refresh !== "string" || value.refresh.trim() === "") return
  if (typeof value.access !== "string") return
  if (typeof value.expires !== "number" || Number.isFinite(value.expires) === false || value.expires < 0) return

  const accountId = accountIdForEntry(value)
  if (!accountId || (expectedAccountId && accountId !== expectedAccountId)) return
  return {
    accountId,
    access: value.access,
    expires: value.expires,
    refresh: value.refresh,
  }
}

async function readRepositoryMapping(path: string): Promise<Record<string, string[]>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new Error(`failed to read repository account mapping: ${errorMessage(error)}`)
  }

  if (isJsonObject(parsed) === false) throw new Error("repository account mapping must be a JSON object")

  const mapping: Record<string, string[]> = {}
  for (const [repository, value] of Object.entries(parsed)) {
    if (repository.trim() !== repository || repository === "") {
      throw new Error("repository account mapping contains an invalid repository name")
    }
    if (Array.isArray(value) === false) {
      throw new Error(`repository account mapping for ${repository} must be an array`)
    }

    const aliases = value.map((alias) => {
      if (typeof alias !== "string" || alias.trim() !== alias || alias === "" || alias.includes("\n")) {
        throw new Error(`repository account mapping for ${repository} contains an invalid alias`)
      }
      return alias
    })
    if (aliases.length > 16) {
      throw new Error(`repository account mapping for ${repository} contains too many aliases`)
    }
    if (new Set(aliases).size !== aliases.length) {
      throw new Error(`repository account mapping for ${repository} contains duplicate aliases`)
    }
    mapping[repository] = aliases
  }
  return mapping
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
