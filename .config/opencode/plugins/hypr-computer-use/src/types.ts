import type { ApprovalReport } from "./approval"

export type JsonObject = Record<string, unknown>

export type Geometry = {
  x: number
  y: number
  width: number
  height: number
}

export type WorkspaceRef = {
  id: number | null
  name: string | null
}

export type MonitorSnapshot = Geometry & {
  id: number | null
  name: string
  activeWorkspace: WorkspaceRef | null
  scale: number | null
  focused: boolean
}

export type ClientSnapshot = Geometry & {
  address: string
  stableId: string | null
  class: string | null
  title: string | null
  pid: number | null
  workspace: WorkspaceRef | null
  monitor: number | null
  mapped: boolean
  floating: boolean
  fullscreen: boolean
  xwayland: boolean
}

export type HyprlandState = {
  timestamp: string
  activeWindow: JsonObject | null
  monitors: MonitorSnapshot[]
  workspaces: JsonObject[]
  clients: ClientSnapshot[]
}

export type TargetSnapshot = ClientSnapshot & {
  timestamp: string
  monitorName: string | null
}

export type CaptureScope = "active-window" | "monitor" | "region" | "full"

export type CaptureRequest = {
  scope: CaptureScope
  outputPath?: string
  monitor?: string
  region?: Geometry
  allowFullDesktop?: boolean
  evidenceDir?: string
}

export type CaptureResult = {
  timestamp: string
  scope: CaptureScope
  backend: "grim"
  path: string
  target: TargetSnapshot | null
  monitor: MonitorSnapshot | null
  region: Geometry | null
}

export type EvidenceRecord = {
  timestamp: string
  operation: "state" | "snapshot" | "capture" | "browser" | "approval" | "keyboard" | "keyboard-plan" | "controls-cache" | "rejected"
  target?: TargetSnapshot | null
  capture?: Omit<CaptureResult, "target">
  browser?: BrowserTargetReport
  approval?: ApprovalReport
  keyboard?: Record<string, unknown>
  controls?: Record<string, unknown> | null
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

export type DesktopEntry = {
  desktopId: string
  path: string
  name: string | null
  exec: string | null
  startupWMClass: string | null
  mimeTypes: string[]
  categories: string[]
}

export type BrowserIdentity = {
  desktopId: string
  name: string | null
  exec: string | null
  startupWMClass: string | null
  flatpakId: string | null
  classCandidates: string[]
  source: string
  desktopEntryPath: string | null
}

export type BrowserTargetMatch = ClientSnapshot & {
  reasons: string[]
  monitorName: string | null
}

export type BrowserCapabilities = {
  nativeWindowCapture: "available" | "unavailable"
  xdgOpen: "available" | "unavailable"
  family: "firefox-gecko" | "unknown"
  protocols: {
    cdp: {
      support: "unsupported" | "unknown"
      endpoint: "notConfigured"
      reason?: string
    }
    webdriverBidi: {
      support: "supported" | "unknown"
      endpoint: "notConfigured" | "available" | "unreachable" | "rejected"
      url?: string
      reason?: string
    }
    marionette: {
      support: "supported" | "unknown"
      endpoint: "notConfigured"
      reason?: string
    }
  }
}

export type BrowserTargetReport = {
  timestamp: string
  defaultBrowser: {
    desktopId: string | null
    source: string | null
  }
  desktopEntry: DesktopEntry | null
  identity: BrowserIdentity | null
  matches: BrowserTargetMatch[] | null
  capabilities: BrowserCapabilities
}
