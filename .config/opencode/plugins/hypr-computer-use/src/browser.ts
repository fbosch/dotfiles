import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { CommandRunner } from "./command"
import type {
  BrowserCapabilities,
  BrowserIdentity,
  BrowserTargetMatch,
  BrowserTargetReport,
  ClientSnapshot,
  DesktopEntry,
  HyprlandState,
} from "./types"

const browserMimeKeys = ["x-scheme-handler/https", "x-scheme-handler/http", "text/html"]

type BrowserDiscoveryOptions = {
  env?: NodeJS.ProcessEnv
  readFile?: (path: string) => Promise<string>
  webdriverBidiEndpoint?: string
  webSocketFactory?: typeof WebSocket
}

type DefaultBrowser = {
  desktopId: string | null
  source: string | null
}

function cleanDesktopId(value: string): string | null {
  const desktopId = value.trim().split(";")[0]?.trim()
  return desktopId && desktopId.endsWith(".desktop") ? desktopId : null
}

async function commandDesktopId(runner: CommandRunner, command: string, args: string[], source: string) {
  try {
    const result = await runner.execFile(command, args, { timeout: 1000 })
    const desktopId = cleanDesktopId(result.stdout)
    return desktopId ? { desktopId, source } : null
  } catch {
    return null
  }
}

function xdgDataHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME || join(env.HOME || "", ".local", "share")
}

function xdgDataDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = env.XDG_DATA_DIRS || "/usr/local/share:/usr/share"
  return raw.split(":").filter(Boolean)
}

function applicationDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = [xdgDataHome(env), ...xdgDataDirs(env)].map((dir) => join(dir, "applications"))
  return Array.from(new Set(dirs))
}

function parseMimeapps(content: string): Map<string, string> {
  const defaults = new Map<string, string>()
  let section = ""

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1)
      continue
    }
    if (section !== "Default Applications") continue

    const separator = line.indexOf("=")
    if (separator === -1) continue
    const key = line.slice(0, separator)
    const desktopId = cleanDesktopId(line.slice(separator + 1))
    if (desktopId) defaults.set(key, desktopId)
  }

  return defaults
}

async function discoverFromMimeapps(options: {
  env: NodeJS.ProcessEnv
  readFile: (path: string) => Promise<string>
}): Promise<DefaultBrowser | null> {
  const env = options.env
  const paths = [
    join(xdgDataHome(env), "applications", "mimeapps.list"),
    ...xdgDataDirs(env).map((dir) => join(dir, "applications", "mimeapps.list")),
  ]

  for (const path of paths) {
    try {
      const defaults = parseMimeapps(await options.readFile(path))
      for (const key of browserMimeKeys) {
        const desktopId = defaults.get(key)
        if (desktopId) return { desktopId, source: `mimeapps:${path}:${key}` }
      }
    } catch {
      continue
    }
  }

  return null
}

export async function discoverDefaultBrowser(
  runner: CommandRunner,
  options: BrowserDiscoveryOptions = {},
): Promise<DefaultBrowser> {
  const resolvedOptions = {
    env: options.env ?? process.env,
    readFile: options.readFile ?? ((path: string) => readFile(path, "utf8")),
  }
  const settings = await commandDesktopId(runner, "xdg-settings", ["get", "default-web-browser"], "xdg-settings")
  if (settings) return settings

  const mime = await commandDesktopId(runner, "xdg-mime", ["query", "default", "x-scheme-handler/https"], "xdg-mime:https")
  if (mime) return mime

  const mimeapps = await discoverFromMimeapps(resolvedOptions)
  return mimeapps ?? { desktopId: null, source: null }
}

function parseList(value: string | undefined): string[] {
  if (!value) return []
  return value.split(";").map((entry) => entry.trim()).filter(Boolean)
}

export function parseDesktopEntry(content: string, desktopId: string, path: string): DesktopEntry | null {
  const fields = new Map<string, string>()
  let inDesktopEntry = false

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("[") && line.endsWith("]")) {
      inDesktopEntry = line === "[Desktop Entry]"
      continue
    }
    if (!inDesktopEntry) continue

    const separator = line.indexOf("=")
    if (separator === -1) continue
    fields.set(line.slice(0, separator), line.slice(separator + 1))
  }

  if (fields.size === 0) return null

  return {
    desktopId,
    path,
    name: fields.get("Name") ?? null,
    exec: fields.get("Exec") ?? null,
    startupWMClass: fields.get("StartupWMClass") ?? null,
    mimeTypes: parseList(fields.get("MimeType")),
    categories: parseList(fields.get("Categories")),
  }
}

export async function resolveDesktopEntry(
  desktopId: string,
  options: BrowserDiscoveryOptions = {},
): Promise<DesktopEntry | null> {
  const env = options.env ?? process.env
  const read = options.readFile ?? ((path: string) => readFile(path, "utf8"))

  for (const dir of applicationDirs(env)) {
    const path = join(dir, desktopId)
    try {
      const entry = parseDesktopEntry(await read(path), desktopId, path)
      if (entry) return entry
    } catch {
      continue
    }
  }

  return null
}

function desktopStem(desktopId: string): string {
  return desktopId.replace(/\.desktop$/, "")
}

function inferFlatpakId(entry: DesktopEntry | null, desktopId: string): string | null {
  const stem = desktopStem(desktopId)
  if (/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/.test(stem)) return stem
  const exec = entry?.exec ?? ""
  const match = exec.match(/\b([a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+)\b/)
  return match?.[1] ?? null
}

function addCandidate(candidates: Set<string>, value: string | null | undefined) {
  const candidate = value?.trim()
  if (candidate) candidates.add(candidate)
}

export function normalizeBrowserIdentity(defaultBrowser: DefaultBrowser, entry: DesktopEntry | null): BrowserIdentity | null {
  if (!defaultBrowser.desktopId) return null

  const candidates = new Set<string>()
  const stem = desktopStem(defaultBrowser.desktopId)
  const flatpakId = inferFlatpakId(entry, defaultBrowser.desktopId)
  addCandidate(candidates, stem)
  addCandidate(candidates, entry?.startupWMClass)
  addCandidate(candidates, flatpakId)
  addCandidate(candidates, flatpakId?.split(".").at(-1))

  return {
    desktopId: defaultBrowser.desktopId,
    name: entry?.name ?? null,
    exec: entry?.exec ?? null,
    startupWMClass: entry?.startupWMClass ?? null,
    flatpakId,
    classCandidates: Array.from(candidates),
    source: defaultBrowser.source ?? "unknown",
    desktopEntryPath: entry?.path ?? null,
  }
}

function classMatches(client: ClientSnapshot, identity: BrowserIdentity): string[] {
  const clientClass = client.class?.toLowerCase()
  if (!clientClass) return []

  const reasons: string[] = []
  for (const candidate of identity.classCandidates) {
    const normalized = candidate.toLowerCase()
    if (clientClass === normalized || clientClass.includes(normalized) || normalized.includes(clientClass)) {
      reasons.push(`class:${candidate}`)
    }
  }
  return reasons
}

export function matchBrowserTargets(identity: BrowserIdentity | null, state: HyprlandState | null): BrowserTargetMatch[] | null {
  if (!identity || !state) return null

  return state.clients.flatMap((client) => {
    const reasons = classMatches(client, identity)
    if (reasons.length === 0) return []
    const monitorName = state.monitors.find((monitor) => monitor.id === client.monitor)?.name ?? null
    return [{ ...client, reasons, monitorName }]
  })
}

function browserMetadataText(identity: BrowserIdentity | null): string {
  if (!identity) return ""
  return [
    identity.desktopId,
    identity.name,
    identity.exec,
    identity.startupWMClass,
    identity.flatpakId,
    ...identity.classCandidates,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .toLowerCase()
}

export function inferBrowserFamily(identity: BrowserIdentity | null): BrowserCapabilities["family"] {
  const text = browserMetadataText(identity)
  if (!text) return "unknown"

  const firefoxMarkers = ["zen_browser", "zen browser", "firefox", "floorp", "librewolf", "mullvad browser"]
  if (firefoxMarkers.some((marker) => text.includes(marker))) {
    return "firefox-gecko"
  }

  return "unknown"
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1"
}

function validateBidiEndpoint(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null
    return isLoopbackHost(url.hostname) ? url : null
  } catch {
    return null
  }
}

async function probeWebdriverBidiEndpoint(endpoint: string, webSocketFactory = WebSocket) {
  const endpointUrl = validateBidiEndpoint(endpoint)
  if (!endpointUrl) {
    return {
      endpoint: "rejected" as const,
      url: endpoint,
      reason: "WebDriver BiDi endpoint probes are restricted to loopback ws/wss URLs",
    }
  }

  if (!webSocketFactory) {
    return {
      endpoint: "unreachable" as const,
      url: endpointUrl.toString(),
      reason: "WebSocket support is unavailable in this runtime",
    }
  }

  const endpointUrlString = endpointUrl.toString()

  return await new Promise<{
    endpoint: "available" | "unreachable"
    url: string
    reason?: string
  }>((resolve) => {
    const socket = new webSocketFactory(endpointUrl)
    let settled = false
    const timeout = setTimeout(() => finish("unreachable", "Timed out waiting for WebDriver BiDi session.status"), 1000)

    function finish(endpoint: "available" | "unreachable", reason?: string) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        socket.close()
      } catch {
      }
      resolve({ endpoint, url: endpointUrlString, reason })
    }

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "session.status", params: {} }))
    })
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { id?: unknown; error?: unknown }
        if (parsed.id === 1 && parsed.error === undefined) {
          finish("available")
          return
        }
        finish("unreachable", "Endpoint responded but did not accept session.status")
      } catch {
        finish("unreachable", "Endpoint returned a non-JSON response")
      }
    })
    socket.addEventListener("error", () => finish("unreachable", "WebSocket connection failed"))
  })
}

export async function browserCapabilities(
  defaultBrowser: DefaultBrowser,
  matches: BrowserTargetMatch[] | null,
  identity: BrowserIdentity | null,
  options: BrowserDiscoveryOptions = {},
): Promise<BrowserCapabilities> {
  const family = inferBrowserFamily(identity)
  const webdriverBidiProbe = options.webdriverBidiEndpoint
    ? await probeWebdriverBidiEndpoint(options.webdriverBidiEndpoint, options.webSocketFactory)
    : null

  return {
    nativeWindowCapture: matches && matches.length > 0 ? "available" : "unavailable",
    xdgOpen: defaultBrowser.desktopId ? "available" : "unavailable",
    family,
    protocols: {
      cdp: family === "firefox-gecko"
        ? {
            support: "unsupported",
            endpoint: "notConfigured",
            reason: "Firefox-family CDP support was removed in current Firefox; use WebDriver BiDi for Zen/Firefox",
          }
        : { support: "unknown", endpoint: "notConfigured" },
      webdriverBidi: {
        support: family === "firefox-gecko" ? "supported" : "unknown",
        endpoint: webdriverBidiProbe?.endpoint ?? "notConfigured",
        url: webdriverBidiProbe?.url,
        reason: webdriverBidiProbe?.reason,
      },
      marionette: family === "firefox-gecko"
        ? {
            support: "supported",
            endpoint: "notConfigured",
            reason: "Firefox-family browsers include Marionette, but this plugin does not use it for detection",
          }
        : { support: "unknown", endpoint: "notConfigured" },
    },
  }
}

export async function browserTargetReport(
  runner: CommandRunner,
  state: HyprlandState | null,
  options: BrowserDiscoveryOptions = {},
): Promise<BrowserTargetReport> {
  const defaultBrowser = await discoverDefaultBrowser(runner, options)
  const desktopEntry = defaultBrowser.desktopId ? await resolveDesktopEntry(defaultBrowser.desktopId, options) : null
  const identity = normalizeBrowserIdentity(defaultBrowser, desktopEntry)
  const matches = matchBrowserTargets(identity, state)
  const capabilities = await browserCapabilities(defaultBrowser, matches, identity, options)

  return {
    timestamp: new Date().toISOString(),
    defaultBrowser,
    desktopEntry,
    identity,
    matches,
    capabilities,
  }
}
