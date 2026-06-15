import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Mode = "auto" | "browser" | "window" | "region" | "monitor" | "full"
type Format = "png" | "jpeg"

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

type Geometry = {
  x: number
  y: number
  width: number
  height: number
}

type Monitor = Geometry & {
  name: string
  focused: boolean
  id: number | null
}

type WindowInfo = {
  className: string
  initialClass: string
  title: string
  stableId: string
  address: string
  monitor: number | null
  size: [number, number] | null
  visible: boolean
  mapped: boolean
}

type Layer = Geometry & {
  namespace: string
  monitor: string
  level: string
}

type CaptureResult = {
  path: string
  method: string
  target?: string
  geometry?: Geometry
  window?: WindowInfo
  fallback?: string[]
}

const browserClasses = new Set([
  "app.zen_browser.zen",
  "brave-browser",
  "chromium",
  "firefox",
  "google-chrome",
  "microsoft-edge",
  "org.mozilla.firefox",
  "vivaldi",
  "zen",
])

const chromiumClasses = new Set(["brave-browser", "chromium", "google-chrome", "microsoft-edge", "vivaldi"])

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode })
    })
  })
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && Array.isArray(value) === false ? (value as Record<string, unknown>) : null
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : []
}

async function hyprctlJson(request: string, cwd: string): Promise<unknown | null> {
  const result = await runCommand("hyprctl", [request, "-j"], cwd)
  if (result.exitCode !== 0) {
    return null
  }

  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

function parseWindow(value: unknown): WindowInfo | null {
  const input = objectValue(value)
  if (input === null || Object.keys(input).length === 0) {
    return null
  }

  const size = numberArray(input.size)
  return {
    className: stringValue(input.class),
    initialClass: stringValue(input.initialClass),
    title: stringValue(input.title),
    stableId: stringValue(input.stableId),
    address: stringValue(input.address),
    monitor: numberValue(input.monitor),
    size: size.length >= 2 && size[0] !== undefined && size[1] !== undefined ? [size[0], size[1]] : null,
    visible: booleanValue(input.visible, true),
    mapped: booleanValue(input.mapped, true),
  }
}

function parseMonitors(value: unknown): Monitor[] {
  if (Array.isArray(value) === false) {
    return []
  }

  const monitors: Monitor[] = []
  for (const item of value) {
    const input = objectValue(item)
    if (input === null) {
      continue
    }

    const x = numberValue(input.x)
    const y = numberValue(input.y)
    const width = numberValue(input.width)
    const height = numberValue(input.height)
    const name = stringValue(input.name)
    if (x === null || y === null || width === null || height === null || name === "") {
      continue
    }

    monitors.push({
      x,
      y,
      width,
      height,
      name,
      focused: booleanValue(input.focused, false),
      id: numberValue(input.id),
    })
  }

  return monitors
}

function collectLayers(value: unknown, monitor = "", level = "", layers: Layer[] = []): Layer[] {
  const input = objectValue(value)
  if (input === null) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectLayers(item, monitor, level, layers)
      }
    }
    return layers
  }

  const x = numberValue(input.x)
  const y = numberValue(input.y)
  const width = numberValue(input.w) ?? numberValue(input.width)
  const height = numberValue(input.h) ?? numberValue(input.height)
  const namespace = stringValue(input.namespace)
  if (x !== null && y !== null && width !== null && height !== null && namespace !== "") {
    layers.push({ x, y, width, height, namespace, monitor, level })
    return layers
  }

  for (const [key, item] of Object.entries(input)) {
    if (key === "levels") {
      collectLayers(item, monitor, level, layers)
    } else if (monitor === "" && objectValue(item)?.levels !== undefined) {
      collectLayers(item, key, level, layers)
    } else if (/^\d+$/.test(key)) {
      collectLayers(item, monitor, key, layers)
    } else {
      collectLayers(item, monitor, level, layers)
    }
  }

  return layers
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "")
}

function hintTokens(hint: string): string[] {
  return hint
    .toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .map(normalizeToken)
    .filter((token) => token.length >= 3)
}

function focusedMonitor(monitors: Monitor[], activeWindow: WindowInfo | null): Monitor | null {
  const focused = monitors.find((monitor) => monitor.focused)
  if (focused !== undefined) {
    return focused
  }

  if (activeWindow?.monitor !== null && activeWindow?.monitor !== undefined) {
    const windowMonitor = monitors.find((monitor) => monitor.id === activeWindow.monitor)
    if (windowMonitor !== undefined) {
      return windowMonitor
    }
  }

  return monitors[0] ?? null
}

function windowTarget(window: WindowInfo): string {
  if (window.stableId !== "") {
    return window.stableId
  }

  return window.address.replace(/^0x/, "")
}

function isBrowserWindow(window: WindowInfo | null): boolean {
  if (window === null) {
    return false
  }

  const classes = [window.className, window.initialClass].map((item) => item.toLowerCase())
  return classes.some((item) => browserClasses.has(item) || item.includes("browser") || item.includes("chromium") || item.includes("firefox"))
}

function isChromiumWindow(window: WindowInfo | null): boolean {
  if (window === null) {
    return false
  }

  const classes = [window.className, window.initialClass].map((item) => item.toLowerCase())
  return classes.some((item) => chromiumClasses.has(item) || item.includes("chromium") || item.includes("chrome"))
}

function looksLikeWidgetHint(hint: string): boolean {
  return /\b(widget|layer|overlay|bar|popup|menu|calendar|tray|panel|launcher|notification|dock)\b/i.test(hint)
}

function looksLikePopupHint(hint: string): boolean {
  return /\b(popup|menu|calendar|widget|launcher|overlay)\b/i.test(hint)
}

function isThinBarGeometry(geometry: Geometry): boolean {
  return geometry.height <= 120 || geometry.width <= 120
}

function scoreLayer(layer: Layer, tokens: string[]): number {
  const namespace = layer.namespace.toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (namespace === token) {
      score += 4
    } else if (namespace.includes(token) || token.includes(namespace)) {
      score += 2
    }
  }

  if (namespace.includes("bar") && tokens.includes("bar")) score += 3
  if (namespace.includes("tray") && tokens.includes("tray")) score += 3
  if (namespace.includes("calendar") && tokens.includes("calendar")) score += 3
  if (namespace.includes("notification") && tokens.includes("notification")) score += 3

  return score
}

function inferLayerGeometry(hint: string, layers: Layer[]): { geometry: Geometry; target: string } | null {
  const tokens = hintTokens(hint)
  if (tokens.length === 0) {
    return null
  }

  let best: { layer: Layer; score: number } | null = null
  for (const layer of layers) {
    const score = scoreLayer(layer, tokens)
    if (score > 0 && (best === null || score > best.score)) {
      best = { layer, score }
    }
  }

  if (best === null) {
    return null
  }

  return {
    geometry: {
      x: best.layer.x,
      y: best.layer.y,
      width: best.layer.width,
      height: best.layer.height,
    },
    target: `${best.layer.namespace} on ${best.layer.monitor || "unknown monitor"}`,
  }
}

function insetGeometry(monitor: Monitor, horizontalRatio: number, verticalRatio: number): Geometry {
  const width = Math.round(monitor.width * horizontalRatio)
  const height = Math.round(monitor.height * verticalRatio)
  return {
    x: monitor.x + Math.round((monitor.width - width) / 2),
    y: monitor.y + Math.round((monitor.height - height) / 2),
    width,
    height,
  }
}

function inferRegionGeometry(hint: string, monitor: Monitor | null): { geometry: Geometry; target: string } | null {
  if (monitor === null) {
    return null
  }

  const lower = hint.toLowerCase()
  if (/\bbottom\b/.test(lower)) {
    const height = Math.round(monitor.height * 0.35)
    return { geometry: { x: monitor.x, y: monitor.y + monitor.height - height, width: monitor.width, height }, target: `bottom of ${monitor.name}` }
  }
  if (/\btop\b/.test(lower)) {
    const height = Math.round(monitor.height * 0.35)
    return { geometry: { x: monitor.x, y: monitor.y, width: monitor.width, height }, target: `top of ${monitor.name}` }
  }
  if (/\bleft\b/.test(lower)) {
    const width = Math.round(monitor.width * 0.35)
    return { geometry: { x: monitor.x, y: monitor.y, width, height: monitor.height }, target: `left of ${monitor.name}` }
  }
  if (/\bright\b/.test(lower)) {
    const width = Math.round(monitor.width * 0.35)
    return { geometry: { x: monitor.x + monitor.width - width, y: monitor.y, width, height: monitor.height }, target: `right of ${monitor.name}` }
  }

  if (/\b(center|popup|menu|calendar|widget|launcher|overlay)\b/.test(lower)) {
    return { geometry: insetGeometry(monitor, 0.7, 0.7), target: `center of ${monitor.name}` }
  }

  return null
}

function inferContextRegion(hint: string, layers: Layer[], monitor: Monitor | null): { geometry: Geometry; target: string } | null {
  const exact = inferLayerGeometry(hint, layers)
  if (exact !== null && (looksLikePopupHint(hint) === false || isThinBarGeometry(exact.geometry) === false)) {
    return exact
  }

  return inferRegionGeometry(hint, monitor) ?? exact
}

async function outputDirectory(): Promise<string> {
  const base = existsSync("/dev/shm") ? "/dev/shm" : tmpdir()
  const directory = join(base, "opencode-window-screenshots")
  await mkdir(directory, { recursive: true })
  return directory
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

async function outputPath(format: Format): Promise<string> {
  return join(await outputDirectory(), `screenshot-${timestamp()}.${format === "jpeg" ? "jpg" : "png"}`)
}

async function grim(args: string[], cwd: string): Promise<string | null> {
  const result = await runCommand("grim", args, cwd)
  if (result.exitCode === 0) {
    return null
  }

  return result.stderr.trim() || result.stdout.trim() || `grim failed with exit ${result.exitCode ?? "unknown"}`
}

function grimFormatArgs(format: Format): string[] {
  return format === "jpeg" ? ["-t", "jpeg", "-q", "90"] : []
}

async function captureWindow(window: WindowInfo | null, format: Format, cwd: string): Promise<CaptureResult | string> {
  if (window === null || window.mapped === false || window.visible === false) {
    return "No active mapped window."
  }

  const target = windowTarget(window)
  if (target === "") {
    return "Active window has no stableId or address."
  }

  const path = await outputPath(format)
  const error = await grim([...grimFormatArgs(format), "-T", target, path], cwd)
  return error ?? { path, method: "window", target, window }
}

async function captureRegion(geometry: Geometry, target: string, format: Format, cwd: string): Promise<CaptureResult | string> {
  const path = await outputPath(format)
  const region = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`
  const error = await grim([...grimFormatArgs(format), "-g", region, path], cwd)
  return error ?? { path, method: "region", target, geometry }
}

async function captureMonitor(monitor: Monitor | null, format: Format, cwd: string): Promise<CaptureResult | string> {
  const path = await outputPath(format)
  if (monitor === null) {
    const error = await grim([...grimFormatArgs(format), path], cwd)
    return error ?? { path, method: "full" }
  }

  const error = await grim([...grimFormatArgs(format), "-o", monitor.name, path], cwd)
  return error ?? { path, method: "monitor", target: monitor.name, geometry: monitor }
}

async function captureFull(format: Format, cwd: string): Promise<CaptureResult | string> {
  const path = await outputPath(format)
  const error = await grim([...grimFormatArgs(format), path], cwd)
  return error ?? { path, method: "full" }
}

function cdpCandidates(): string[] {
  const candidates = [process.env.PLAYWRIGHT_CDP_URL, process.env.CHROME_REMOTE_DEBUGGING_URL, "http://127.0.0.1:9222", "http://localhost:9222"]
  return candidates.filter((item): item is string => typeof item === "string" && item.length > 0)
}

type CdpTab = {
  type?: unknown
  url?: unknown
  title?: unknown
  webSocketDebuggerUrl?: unknown
}

async function fetchTabs(endpoint: string): Promise<CdpTab[] | string> {
  try {
    const response = await fetch(new URL("/json/list", endpoint))
    if (response.ok === false) {
      return `${endpoint}/json/list returned ${response.status}`
    }

    const value = await response.json()
    return Array.isArray(value) ? value : "CDP /json/list did not return an array"
  } catch (error) {
    return error instanceof Error ? error.message : "Failed to fetch CDP tabs"
  }
}

function pickTab(tabs: CdpTab[], hint: string): CdpTab | null {
  const pageTabs = tabs.filter((tab) => tab.type === "page" && typeof tab.webSocketDebuggerUrl === "string")
  if (pageTabs.length === 0) {
    return null
  }

  const tokens = hintTokens(hint)
  if (tokens.length > 0) {
    const scored = pageTabs
      .map((tab) => {
        const haystack = `${stringValue(tab.title)} ${stringValue(tab.url)}`.toLowerCase()
        return { tab, score: tokens.filter((token) => haystack.includes(token)).length }
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
    if (scored[0] !== undefined) {
      return scored[0].tab
    }
  }

  return pageTabs[0] ?? null
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening CDP websocket")), 2000)
    socket.addEventListener("open", () => {
      clearTimeout(timeout)
      resolve()
    })
    socket.addEventListener("error", () => {
      clearTimeout(timeout)
      reject(new Error("Failed to open CDP websocket"))
    })
  })
}

type CdpResponse = {
  id?: unknown
  result?: unknown
  error?: unknown
}

async function cdpCall(socket: WebSocket, id: number, method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 5000)
    const listener = (event: MessageEvent) => {
      try {
        const response = JSON.parse(String(event.data)) as CdpResponse
        if (response.id !== id) {
          return
        }

        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        if (response.error !== undefined) {
          reject(new Error(JSON.stringify(response.error)))
          return
        }
        resolve(response.result)
      } catch (error) {
        clearTimeout(timeout)
        socket.removeEventListener("message", listener)
        reject(error)
      }
    }

    socket.addEventListener("message", listener)
    socket.send(JSON.stringify({ id, method, params: params ?? {} }))
  })
}

function layoutContentSize(value: unknown): { width: number; height: number } | null {
  const root = objectValue(value)
  const contentSize = objectValue(root?.contentSize)
  const width = numberValue(contentSize?.width)
  const height = numberValue(contentSize?.height)
  if (width === null || height === null) {
    return null
  }
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

function screenshotData(value: unknown): string | null {
  return stringValue(objectValue(value)?.data) || null
}

async function captureBrowserCdp(hint: string, format: Format, fullPage: boolean): Promise<CaptureResult | string> {
  const errors: string[] = []
  for (const endpoint of cdpCandidates()) {
    const tabs = await fetchTabs(endpoint)
    if (typeof tabs === "string") {
      errors.push(`${endpoint}: ${tabs}`)
      continue
    }

    const tab = pickTab(tabs, hint)
    const webSocketDebuggerUrl = typeof tab?.webSocketDebuggerUrl === "string" ? tab.webSocketDebuggerUrl : ""
    if (webSocketDebuggerUrl === "") {
      errors.push(`${endpoint}: no page tab with websocket URL`)
      continue
    }

    const socket = new WebSocket(webSocketDebuggerUrl)
    try {
      await waitForSocketOpen(socket)
      let id = 1
      await cdpCall(socket, id++, "Page.enable")
      if (fullPage) {
        const metrics = layoutContentSize(await cdpCall(socket, id++, "Page.getLayoutMetrics"))
        if (metrics !== null) {
          await cdpCall(socket, id++, "Emulation.setDeviceMetricsOverride", {
            width: metrics.width,
            height: metrics.height,
            deviceScaleFactor: 1,
            mobile: false,
          })
        }
      }

      const result = await cdpCall(socket, id++, "Page.captureScreenshot", {
        format: format === "jpeg" ? "jpeg" : "png",
        fromSurface: true,
        captureBeyondViewport: fullPage,
      })
      const data = screenshotData(result)
      if (data === null) {
        errors.push(`${endpoint}: Page.captureScreenshot returned no data`)
        continue
      }

      const path = await outputPath(format)
      await writeFile(path, Buffer.from(data, "base64"))
      return {
        path,
        method: "browser-cdp",
        target: `${stringValue(tab?.title) || "untitled"} ${stringValue(tab?.url)}`.trim(),
      }
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : "CDP screenshot failed"}`)
    } finally {
      socket.close()
    }
  }

  return `No usable existing CDP endpoint found. ${errors.join("; ")}`
}

function formatGeometry(geometry: Geometry): string {
  return `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`
}

function formatWindow(window: WindowInfo): string {
  return `${window.className || window.initialClass || "unknown"} - ${window.title || "untitled"}`
}

function formatResult(result: CaptureResult, hint: string, fallback: string[]): string {
  const lines = [`Captured screenshot: ${result.path}`, `Method: ${result.method}`]
  if (result.target !== undefined) lines.push(`Target: ${result.target}`)
  if (result.geometry !== undefined) lines.push(`Geometry: ${formatGeometry(result.geometry)}`)
  if (result.window !== undefined) lines.push(`Window: ${formatWindow(result.window)}`)
  if (hint !== "") lines.push(`Hint: ${hint}`)
  const fallbacks = [...fallback, ...(result.fallback ?? [])]
  if (fallbacks.length > 0) lines.push(`Fallbacks: ${fallbacks.join(" | ")}`)
  return lines.join("\n")
}

async function gatherContext(cwd: string): Promise<{ activeWindow: WindowInfo | null; monitors: Monitor[]; layers: Layer[] }> {
  const [activeWindowJson, monitorsJson, layersJson] = await Promise.all([
    hyprctlJson("activewindow", cwd),
    hyprctlJson("monitors", cwd),
    hyprctlJson("layers", cwd),
  ])

  return {
    activeWindow: parseWindow(activeWindowJson),
    monitors: parseMonitors(monitorsJson),
    layers: collectLayers(layersJson),
  }
}

async function captureByMode(args: { mode: Mode; hint: string; format: Format; fullPage: boolean }, cwd: string): Promise<string> {
  const context = await gatherContext(cwd)
  const monitor = focusedMonitor(context.monitors, context.activeWindow)
  const fallback: string[] = []

  if (args.mode === "browser" || (args.mode === "auto" && isBrowserWindow(context.activeWindow))) {
    if (isChromiumWindow(context.activeWindow) || args.mode === "browser") {
      const browserResult = await captureBrowserCdp(args.hint, args.format, args.fullPage)
      if (typeof browserResult !== "string") {
        return formatResult(browserResult, args.hint, fallback)
      }

      if (args.mode === "browser") {
        return `ERROR: ${browserResult}`
      }
      fallback.push(`browser-cdp failed: ${browserResult}`)
    }
  }

  if (args.mode === "window") {
    const result = await captureWindow(context.activeWindow, args.format, cwd)
    return typeof result === "string" ? `ERROR: ${result}` : formatResult(result, args.hint, fallback)
  }

  if (args.mode === "region") {
    const inferred = inferContextRegion(args.hint, context.layers, monitor)
    if (inferred === null) {
      return "ERROR: Could not infer a region from hint."
    }

    const result = await captureRegion(inferred.geometry, inferred.target, args.format, cwd)
    return typeof result === "string" ? `ERROR: ${result}` : formatResult(result, args.hint, fallback)
  }

  if (args.mode === "monitor") {
    const result = await captureMonitor(monitor, args.format, cwd)
    return typeof result === "string" ? `ERROR: ${result}` : formatResult(result, args.hint, fallback)
  }

  if (args.mode === "full") {
    const result = await captureFull(args.format, cwd)
    return typeof result === "string" ? `ERROR: ${result}` : formatResult(result, args.hint, fallback)
  }

  if (looksLikeWidgetHint(args.hint)) {
    const inferred = inferContextRegion(args.hint, context.layers, monitor)
    if (inferred !== null) {
      const result = await captureRegion(inferred.geometry, inferred.target, args.format, cwd)
      if (typeof result !== "string") {
        return formatResult(result, args.hint, fallback)
      }
      fallback.push(`region failed: ${result}`)
    }
  }

  const windowResult = await captureWindow(context.activeWindow, args.format, cwd)
  if (typeof windowResult !== "string") {
    return formatResult(windowResult, args.hint, fallback)
  }
  fallback.push(`window failed: ${windowResult}`)

  const monitorResult = await captureMonitor(monitor, args.format, cwd)
  if (typeof monitorResult !== "string") {
    return formatResult(monitorResult, args.hint, fallback)
  }
  fallback.push(`monitor failed: ${monitorResult}`)

  const fullResult = await captureFull(args.format, cwd)
  return typeof fullResult === "string" ? `ERROR: ${fullResult}` : formatResult(fullResult, args.hint, fallback)
}

export default tool({
  description: "Capture a Wayland/Hyprland screenshot from context, using browser CDP when possible and grim window/region/monitor fallback",
  args: {
    hint: tool.schema.string().optional().describe("Natural-language target hint, e.g. 'calendar popup above bottom bar' or 'current browser page'"),
    mode: tool.schema.enum(["auto", "browser", "window", "region", "monitor", "full"]).optional().describe("Capture strategy. auto picks browser, layer region, window, monitor, then full fallback."),
    format: tool.schema.enum(["png", "jpeg"]).optional().describe("Output image format. Defaults to png."),
    fullPage: tool.schema.boolean().optional().describe("For browser CDP captures, request a full-page screenshot when supported."),
  },
  async execute(args, context) {
    if (process.env.HYPRLAND_INSTANCE_SIGNATURE === undefined) {
      return "ERROR: HYPRLAND_INSTANCE_SIGNATURE is not set; this tool only works inside a Hyprland session."
    }
    if (process.env.XDG_RUNTIME_DIR === undefined) {
      return "ERROR: XDG_RUNTIME_DIR is not set; cannot talk to the Wayland/Hyprland session."
    }

    const mode = args.mode ?? "auto"
    const format = args.format ?? "png"
    const hint = args.hint ?? ""
    return captureByMode({ mode, hint, format, fullPage: args.fullPage ?? false }, context.directory)
  },
})
