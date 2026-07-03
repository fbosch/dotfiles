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
  operation: "state" | "snapshot" | "capture" | "rejected"
  target?: TargetSnapshot | null
  capture?: Omit<CaptureResult, "target">
  error?: {
    code: string
    message: string
  }
}
