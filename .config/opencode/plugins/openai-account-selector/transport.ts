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
const quotaInspectionMaxBytes = 64 * 1024
const quotaInspectionTimeoutMs = 2_000
const usageLimitRetryMs = 60_000

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type UsageLimitInfo = {
  resetsAt: number | null
}

type TransportOptions = {
  credential: OAuthCredential
  fetch?: Fetch
  now?: () => number
  onUsageLimit?: (credential: OAuthCredential, info: UsageLimitInfo) => Promise<OAuthCredential | undefined>
  onWarning?: (message: string) => void | Promise<void>
  paths: AccountPaths
}

type RefreshOptions = {
  fetch?: Fetch
  now?: () => number
  onWarning?: (message: string) => void | Promise<void>
}

export function createCodexFetch({
  credential: initialCredential,
  fetch: fetchRequest = globalThis.fetch,
  now = Date.now,
  onUsageLimit,
  onWarning,
  paths,
}: TransportOptions): Fetch {
  let credential = { ...initialCredential }
  const handledUsageLimits = new Map<string, number>()
  const refreshPromises = new Map<string, Promise<OAuthCredential>>()
  let rotationGeneration = 0
  let rotationPromise: Promise<OAuthCredential | undefined> | undefined

  const ensureFreshCredential = async () => {
    while (!credential.access || credential.expires < now()) {
      const refreshing = { ...credential }
      let refresh = refreshPromises.get(refreshing.accountId)
      if (!refresh) {
        refresh = refreshOAuthCredential(refreshing, paths, {
          fetch: fetchRequest,
          now,
          onWarning,
        }).finally(() => {
          refreshPromises.delete(refreshing.accountId)
        })
        refreshPromises.set(refreshing.accountId, refresh)
      }
      const refreshed = await refresh
      if (credential.accountId === refreshing.accountId) credential = refreshed
    }
  }

  const credentialForRequest = async () => {
    while (true) {
      const generation = rotationGeneration
      if (rotationPromise) await rotationPromise
      await ensureFreshCredential()
      if (!rotationPromise && generation === rotationGeneration) return { ...credential }
    }
  }

  return async (input, init) => {
    const request = new Request(input, init)
    const requestUrl = new URL(request.url)
    if (requestUrl.pathname !== "/v1/responses") {
      throw new Error(`unsupported OpenAI OAuth request destination: ${requestUrl.origin}`)
    }

    const attemptedCredential = await credentialForRequest()

    const headers = new Headers(request.headers)
    headers.delete("authorization")
    headers.delete(internalTitleHeader)
    headers.set("authorization", `Bearer ${attemptedCredential.access}`)
    headers.set("ChatGPT-Account-Id", attemptedCredential.accountId)

    const response = await fetchRequest(codexEndpoint, {
      body: request.body,
      headers,
      method: request.method,
      redirect: "error",
      signal: request.signal,
    })
    const usageLimit = await usageLimitPayload(response)
    if (!usageLimit || !onUsageLimit) return response

    const handledUntil = handledUsageLimits.get(attemptedCredential.accountId) || 0
    if (attemptedCredential.accountId === credential.accountId && handledUntil <= now() && !rotationPromise) {
      const resetsAt = usageLimit.resetsAt && usageLimit.resetsAt > now() ? usageLimit.resetsAt : now() + usageLimitRetryMs
      handledUsageLimits.set(attemptedCredential.accountId, resetsAt)
      rotationGeneration += 1
      rotationPromise = onUsageLimit(attemptedCredential, { resetsAt: usageLimit.resetsAt })
        .catch(async (error) => {
          void warn(onWarning, `OpenAI account failover failed: ${errorMessage(error)}`)
          return undefined
        })
        .then((rotated) => {
          if (rotated) credential = rotated
          return rotated
        })
        .finally(() => {
          rotationPromise = undefined
        })
    }
    if (rotationPromise) {
      await rotationPromise
    }
    return terminalUsageLimitResponse(response, usageLimit.payload)
  }
}

async function usageLimitPayload(
  response: Response,
): Promise<{ payload: Record<string, unknown>; resetsAt: number | null } | undefined> {
  if (response.status !== 429) return
  try {
    const payload = await boundedResponseJson(response)
    if (isJsonObject(payload) === false || isJsonObject(payload.error) === false) return
    if (payload.error.type !== "usage_limit_reached") return
    const resetsAtSeconds = payload.error.resets_at
    const resetsAt =
      typeof resetsAtSeconds === "number" && Number.isFinite(resetsAtSeconds) && resetsAtSeconds > 0
        ? resetsAtSeconds * 1000
        : null
    return { payload, resetsAt }
  } catch {
    return
  }
}

async function boundedResponseJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(contentLength) && contentLength > quotaInspectionMaxBytes) return
  const reader = response.clone().body?.getReader()
  if (!reader) return

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      readJsonBody(reader),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("quota response inspection timed out")), quotaInspectionTimeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    void reader.cancel().catch(() => undefined)
  }
}

async function readJsonBody(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > quotaInspectionMaxBytes) throw new Error("quota response is too large")
    chunks.push(chunk.value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}

function terminalUsageLimitResponse(response: Response, payload: Record<string, unknown>) {
  const error = isJsonObject(payload.error) ? payload.error : {}
  const headers = new Headers(response.headers)
  headers.delete("content-encoding")
  headers.delete("content-length")
  headers.delete("retry-after")
  headers.delete("retry-after-ms")
  headers.delete("transfer-encoding")
  headers.set("content-type", "application/json")
  return new Response(JSON.stringify({ ...payload, error: { ...error, code: "quota_exceeded" } }), {
    headers,
    status: 400,
    statusText: "Usage Limit Reached",
  })
}

export async function refreshOAuthCredential(
  selected: OAuthCredential,
  paths: AccountPaths,
  {
    fetch: fetchRequest = globalThis.fetch,
    now = Date.now,
    onWarning,
  }: RefreshOptions = {},
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
