import { acquireMutationLock, isJsonObject, readJsonObject, type JsonObject, writeJsonAtomic } from "../../../fbb/lib/opencode-multi-auth/storage.ts"
import type { AccountPaths } from "../../../fbb/lib/opencode-multi-auth/types.ts"
import { accountIdForEntry } from "../../../fbb/lib/opencode-multi-auth/providers/codex.ts"
import type { OAuthCredential } from "./selection.ts"

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann"
const codexEndpoint = "https://chatgpt.com/backend-api/codex/responses"
const refreshEndpoint = "https://auth.openai.com/oauth/token"
const internalTitleHeader = "x-opencode-title"
const lockRetryDelayMs = 50
const lockTimeoutMs = 10_000
const maxTokenLifetimeSeconds = 604_800

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type TransportOptions = {
  credential: OAuthCredential
  fetch?: Fetch
  now?: () => number
  onWarning?: (message: string) => void | Promise<void>
  paths: AccountPaths
}

export function createCodexFetch({
  credential: initialCredential,
  fetch: fetchRequest = globalThis.fetch,
  now = Date.now,
  onWarning,
  paths,
}: TransportOptions): Fetch {
  let credential = { ...initialCredential }
  let refreshPromise: Promise<OAuthCredential> | undefined

  const refreshCredential = () => {
    if (!refreshPromise) {
      refreshPromise = refreshSelectedCredential(credential, paths, fetchRequest, now, onWarning).finally(() => {
        refreshPromise = undefined
      })
    }
    return refreshPromise
  }

  return async (input, init) => {
    const request = new Request(input, init)
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname !== "/v1/responses") {
      throw new Error(`unsupported OpenAI OAuth request destination: ${requestUrl.origin}`)
    }

    if (!credential.access || credential.expires < now()) credential = await refreshCredential()

    const headers = new Headers(request.headers)
    headers.delete("authorization")
    headers.delete(internalTitleHeader)
    headers.set("authorization", `Bearer ${credential.access}`)
    headers.set("ChatGPT-Account-Id", credential.accountId)

    return fetchRequest(codexEndpoint, {
      body: request.body,
      headers,
      method: request.method,
      redirect: "error",
      signal: request.signal,
    })
  }
}

async function refreshSelectedCredential(
  selected: OAuthCredential,
  paths: AccountPaths,
  fetchRequest: Fetch,
  now: () => number,
  onWarning?: (message: string) => void | Promise<void>,
): Promise<OAuthCredential> {
  const lock = await acquireMutationLockWithWait(paths)
  let refreshed: OAuthCredential | undefined
  try {
    const auth = await readJsonObject(paths.auth)
    const match = uniqueCredentialEntry(auth, selected.accountId)
    if (match.credential.access && match.credential.expires >= now()) return match.credential

    const response = await fetchRequest(refreshEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: match.credential.refresh,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    })
    if (response.ok === false) throw new Error(`OpenAI OAuth refresh failed with ${response.status}`)

    const tokens = refreshTokens(await response.json(), selected.accountId, now())
    refreshed = tokens
    auth[match.key] = {
      ...match.entry,
      type: "oauth",
      access: tokens.access,
      refresh: tokens.refresh,
      expires: tokens.expires,
      accountId: selected.accountId,
    }
    try {
      await writeJsonAtomic(paths.auth, auth, 0o600, false)
    } catch (error) {
      await warn(onWarning, `OpenAI account refreshed in memory, but persistence failed: ${errorMessage(error)}`)
    }
    return refreshed
  } finally {
    try {
      await lock.release()
    } catch (error) {
      if (refreshed) await warn(onWarning, `OpenAI account refresh succeeded, but lock cleanup failed: ${errorMessage(error)}`)
      else throw error
    }
  }
}

async function acquireMutationLockWithWait(paths: AccountPaths) {
  const deadline = Date.now() + lockTimeoutMs
  while (true) {
    try {
      return await acquireMutationLock(paths)
    } catch (error) {
      if (errorMessage(error) !== "another account mutation is already in progress" || Date.now() >= deadline) throw error
      await Bun.sleep(lockRetryDelayMs)
    }
  }
}

function uniqueCredentialEntry(auth: JsonObject, accountId: string) {
  const matches = Object.entries(auth).flatMap(([key, value]) => {
    if (isJsonObject(value) === false || accountIdForEntry(value) !== accountId) return []
    const credential = oauthCredential(value, accountId)
    return credential ? [{ key, entry: value, credential }] : []
  })
  if (matches.length !== 1) throw new Error("selected OpenAI account could not be resolved uniquely during refresh")
  return matches[0]
}

function oauthCredential(entry: JsonObject, accountId: string): OAuthCredential | undefined {
  if (entry.type !== "oauth") return
  if (typeof entry.access !== "string" || typeof entry.refresh !== "string" || entry.refresh === "") return
  if (typeof entry.expires !== "number" || Number.isFinite(entry.expires) === false || entry.expires < 0) return
  return { accountId, access: entry.access, expires: entry.expires, refresh: entry.refresh }
}

function refreshTokens(value: unknown, selectedAccountId: string, refreshedAt: number): OAuthCredential {
  if (isJsonObject(value) === false) throw new Error("OpenAI OAuth refresh returned an invalid response")
  const access = requiredToken(value.access_token, "access")
  const refresh = requiredToken(value.refresh_token, "refresh")
  const expiresIn = tokenLifetime(value.expires_in)

  const returnedAccountId = accountIdFromJwt(value.id_token) || accountIdFromJwt(value.access_token)
  if (returnedAccountId && returnedAccountId !== selectedAccountId) {
    throw new Error("OpenAI OAuth refresh returned credentials for another account")
  }
  const expires = refreshedAt + expiresIn * 1000
  if (Number.isFinite(expires) === false) throw new Error("OpenAI OAuth refresh returned an invalid expiry")
  return {
    accountId: selectedAccountId,
    access,
    expires,
    refresh,
  }
}

function requiredToken(value: unknown, label: "access" | "refresh") {
  if (typeof value !== "string" || value === "") {
    throw new Error(`OpenAI OAuth refresh did not return a ${label} token`)
  }
  return value
}

function tokenLifetime(value: unknown) {
  if (value === undefined) return 3600
  if (typeof value !== "number" || Number.isFinite(value) === false || value < 0 || value > maxTokenLifetimeSeconds) {
    throw new Error("OpenAI OAuth refresh returned an invalid expiry")
  }
  return value
}

function accountIdFromJwt(value: unknown) {
  if (typeof value !== "string") return
  const payload = value.split(".")[1]
  if (!payload) return
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    if (isJsonObject(claims) === false) return
    if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id
    const nested = claims["https://api.openai.com/auth"]
    if (isJsonObject(nested) && typeof nested.chatgpt_account_id === "string") return nested.chatgpt_account_id
    const organization = Array.isArray(claims.organizations) ? claims.organizations[0] : undefined
    if (isJsonObject(organization) && typeof organization.id === "string") return organization.id
  } catch {
    return
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function warn(onWarning: TransportOptions["onWarning"], message: string) {
  try {
    await onWarning?.(message)
  } catch {
    return
  }
}
