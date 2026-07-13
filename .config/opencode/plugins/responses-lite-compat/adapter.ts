const CODEX_RESPONSES_PATH = "/backend-api/codex/responses"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const COMPATIBILITY_VERSION = "0.144.0"
const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite"
const RESPONSES_LITE_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"

// Remove after an OpenCode release includes anomalyco/opencode#36143.

type FetchArgs = Parameters<typeof fetch>
type OAuthAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}
type LiteRequest = Record<string, unknown> & {
  input: unknown[]
  tools?: unknown[]
  instructions?: string
}
type CodexOAuthFetchOptions = {
  getAuth: () => Promise<unknown>
  setAuth: (auth: OAuthAuth) => Promise<unknown>
  sessionIDs: Map<string, string>
  httpFetch?: typeof fetch
}
type BunRuntime = {
  randomUUIDv7?: () => string
}

export function isOAuthAuth(auth: unknown): auth is OAuthAuth {
  if (!isRecord(auth) || auth.type !== "oauth") return false
  return typeof auth.refresh === "string" && typeof auth.access === "string" && typeof auth.expires === "number"
}

export function createCodexOAuthFetch(options: CodexOAuthFetchOptions) {
  const httpFetch = options.httpFetch ?? fetch
  let refreshPromise: Promise<OAuthAuth> | undefined

  return async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    let auth = await options.getAuth()
    if (!isOAuthAuth(auth)) return httpFetch(requestInput, init)
    let currentAuth = auth

    if (!currentAuth.access || currentAuth.expires < Date.now()) {
      refreshPromise ??= refreshAccessToken(currentAuth.refresh, httpFetch).then(async (next) => {
        await options.setAuth(next)
        return next
      })
      currentAuth = await refreshPromise.finally(() => {
        refreshPromise = undefined
      })
    }

    const headers = requestHeaders(requestInput, init)
    headers.set("authorization", `Bearer ${currentAuth.access}`)
    if (currentAuth.accountId) headers.set("ChatGPT-Account-Id", currentAuth.accountId)

    const source = requestUrl(requestInput)
    const url = source.pathname.includes("/v1/responses") || source.pathname.includes("/chat/completions")
      ? new URL(CODEX_API_ENDPOINT)
      : source
    const request = prepareResponsesLiteRequest([url, { ...init, headers }], options.sessionIDs)
    return httpFetch(...(request ?? [url, { ...init, headers }]))
  }
}

async function refreshAccessToken(refreshToken: string, httpFetch: typeof fetch): Promise<OAuthAuth> {
  const response = await httpFetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`)

  const tokens: unknown = await response.json()
  if (!isRecord(tokens) || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") {
    throw new Error("Token refresh returned an invalid response")
  }
  return {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (typeof tokens.expires_in === "number" ? tokens.expires_in : 3600) * 1000,
  }
}

export function prepareResponsesLiteRequest(args: FetchArgs, sessionIDs: Map<string, string>): FetchArgs | undefined {
  const [input, init] = args
  const request = liteRequest(input, init)
  if (!request) return

  const headers = requestHeaders(input, init)
  if (headers.get(RESPONSES_LITE_HEADER) === "true") return

  const sessionID = providerSessionID(headers, sessionIDs)
  transformRequest(request, sessionID)

  headers.set("session-id", sessionID)
  headers.set("x-session-affinity", sessionID)
  headers.set("version", COMPATIBILITY_VERSION)
  headers.set(RESPONSES_LITE_HEADER, "true")
  headers.delete("content-length")

  return [input, { ...init, body: JSON.stringify(request), headers }]
}

function liteRequest(input: RequestInfo | URL, init: RequestInit | undefined) {
  const url = requestUrl(input)
  if (url.hostname !== "chatgpt.com" || url.pathname !== CODEX_RESPONSES_PATH) return
  if (typeof init?.body !== "string") return
  return parseResponsesLiteRequest(init.body)
}

function providerSessionID(headers: Headers, sessionIDs: Map<string, string>) {
  const sourceSessionID = headers.get("session-id")
  if (!sourceSessionID) throw new Error("Responses Lite requires a session-id header")

  const sessionID = sessionIDs.get(sourceSessionID) ?? createSessionID()
  sessionIDs.set(sourceSessionID, sessionID)
  return sessionID
}

function transformRequest(request: Record<string, unknown>, sessionID: string) {
  validateRequest(request)
  stripImageDetail(request.input)
  request.input = [
    { type: "additional_tools", role: "developer", tools: request.tools ?? [] },
    ...(request.instructions
      ? [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: request.instructions }],
          },
        ]
      : []),
    ...request.input,
  ]
  delete request.tools
  delete request.instructions
  request.tool_choice = "auto"
  request.parallel_tool_calls = false
  request.prompt_cache_key = sessionID
  request.reasoning = {
    ...(isRecord(request.reasoning) ? request.reasoning : {}),
    context: "all_turns",
  }
}

function validateRequest(request: Record<string, unknown>): asserts request is LiteRequest {
  if (!Array.isArray(request.input)) throw new Error("Responses Lite requires an input array")
  if (request.tools !== undefined && !Array.isArray(request.tools)) {
    throw new Error("Responses Lite requires a tools array")
  }
  if (request.instructions !== undefined && typeof request.instructions !== "string") {
    throw new Error("Responses Lite requires string instructions")
  }
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url)
  if (input instanceof URL) return input
  return new URL(input)
}

function requestHeaders(input: RequestInfo | URL, init: RequestInit | undefined) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }
  return headers
}

function parseResponsesLiteRequest(body: string): Record<string, unknown> | undefined {
  let request: unknown
  try {
    request = JSON.parse(body)
  } catch {
    return
  }

  if (!isRecord(request)) return
  if (typeof request.model !== "string" || !RESPONSES_LITE_MODELS.has(request.model)) return
  return request
}

function createSessionID() {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun
  if (!runtime?.randomUUIDv7) throw new Error("Responses Lite requires Bun.randomUUIDv7")
  return runtime.randomUUIDv7()
}

function stripImageDetail(input: unknown): void {
  if (Array.isArray(input)) {
    input.forEach(stripImageDetail)
    return
  }
  if (!isRecord(input)) return
  if (input.type === "input_image") delete input.detail
  Object.values(input).forEach(stripImageDetail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
