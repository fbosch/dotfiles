import type { Plugin } from "@opencode-ai/plugin"

const DEFAULT_PROXY_URL = "http://127.0.0.1:8787"
const BASE_URL_HEADER = "x-headroom-base-url"
const ORIGINAL_PATH_HEADER = "x-headroom-original-path"
const STATE_KEY = Symbol.for("dotfiles.headroom.opencode.transport")

type TransportState = {
  originalFetch: typeof fetch
  proxyUrl: string
}

type TransportGlobal = typeof globalThis & {
  [STATE_KEY]?: TransportState
}

function normalizeProxyUrl(url: string) {
  return url.replace(/\/+$/, "")
}

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url)
  if (input instanceof URL) return input
  return new URL(String(input))
}

function routedPath(upstream: URL) {
  if (upstream.hostname === "api.openai.com" && upstream.pathname.endsWith("/chat/completions")) {
    return "/v1/chat/completions"
  }

  if (upstream.hostname === "api.openai.com" && upstream.pathname.endsWith("/responses")) {
    return "/v1/responses"
  }

  if (upstream.hostname === "chatgpt.com" && upstream.pathname.endsWith("/backend-api/codex/responses")) {
    return "/v1/responses"
  }

  return undefined
}

function routedFetchArgs(input: RequestInfo | URL, init: RequestInit | undefined, proxyUrl: string) {
  const upstream = requestUrl(input)
  const path = routedPath(upstream)
  if (!path) return [input, init] as const

  const proxy = new URL(proxyUrl)
  const nextUrl = new URL(`${path}${upstream.search}`, proxy.origin)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  }

  headers.set(BASE_URL_HEADER, upstream.origin)
  headers.set(ORIGINAL_PATH_HEADER, upstream.pathname)
  headers.delete("host")

  const nextInit = { ...init, headers }
  if (input instanceof Request) return [new Request(nextUrl, input), nextInit] as const
  return [nextUrl, nextInit] as const
}

function installTransport(proxyUrl: string) {
  const currentGlobal = globalThis as TransportGlobal
  const existing = currentGlobal[STATE_KEY]
  if (existing) {
    existing.proxyUrl = proxyUrl
    return
  }

  const state: TransportState = {
    originalFetch: globalThis.fetch,
    proxyUrl,
  }

  currentGlobal[STATE_KEY] = state
  globalThis.fetch = async (...args) => {
    const current = currentGlobal[STATE_KEY]
    if (!current) return state.originalFetch(...args)

    const [input, init] = routedFetchArgs(args[0], args[1], current.proxyUrl)
    return state.originalFetch(input, init)
  }
}

export const HeadroomOpenCodeTransportPlugin: Plugin = async (input, options = {}) => {
  const pluginOptions = options as { proxyUrl?: string; project?: string }
  const proxyUrl = normalizeProxyUrl(
    pluginOptions.proxyUrl ?? process.env.HEADROOM_PROXY_URL ?? DEFAULT_PROXY_URL,
  )

  installTransport(proxyUrl)

  return {
    "shell.env": async (_input, output) => {
      output.env.HEADROOM_ACTIVE = "1"
      output.env.HEADROOM_PROXY_URL = proxyUrl
      output.env.HEADROOM_PROJECT = pluginOptions.project ?? String(input.project?.id ?? input.directory)
    },
  }
}

export default HeadroomOpenCodeTransportPlugin
