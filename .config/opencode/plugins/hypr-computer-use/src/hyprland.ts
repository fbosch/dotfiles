import { ERROR, HyprComputerUseError } from "./errors"
import type { CommandRunner } from "./command"
import type { ClientSnapshot, Geometry, HyprlandState, JsonObject, MonitorSnapshot, TargetSnapshot, WorkspaceRef } from "./types"

function parseJsonObject(value: string): JsonObject | null {
  if (!value.trim() || value.trim() === "{}") return null
  const parsed = JSON.parse(value) as unknown
  return isObject(parsed) ? parsed : null
}

function parseJsonArray(value: string): JsonObject[] {
  if (!value.trim()) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter(isObject) : []
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && Array.isArray(value) === false
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}

function tupleNumber(value: unknown, index: number): number {
  return Array.isArray(value) && typeof value[index] === "number" ? value[index] : 0
}

function workspaceRef(value: unknown): WorkspaceRef | null {
  if (!isObject(value)) return null
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
  }
}

function normalizeAddress(value: unknown): string {
  return stringValue(value)?.replace(/^0x/, "") ?? ""
}

function normalizeGeometry(position: unknown, size: unknown): Geometry {
  return {
    x: tupleNumber(position, 0),
    y: tupleNumber(position, 1),
    width: tupleNumber(size, 0),
    height: tupleNumber(size, 1),
  }
}

export function previewIdForClient(client: Pick<ClientSnapshot, "stableId" | "address">): string {
  return client.stableId || client.address.replace(/^0x/, "")
}

export function normalizeMonitor(raw: JsonObject): MonitorSnapshot {
  return {
    id: numberValue(raw.id),
    name: stringValue(raw.name) ?? "",
    x: numberValue(raw.x) ?? 0,
    y: numberValue(raw.y) ?? 0,
    width: numberValue(raw.width) ?? 0,
    height: numberValue(raw.height) ?? 0,
    scale: numberValue(raw.scale),
    focused: booleanValue(raw.focused),
    activeWorkspace: workspaceRef(raw.activeWorkspace),
  }
}

export function normalizeClient(raw: JsonObject): ClientSnapshot {
  const geometry = normalizeGeometry(raw.at, raw.size)
  return {
    ...geometry,
    address: normalizeAddress(raw.address),
    stableId: stringValue(raw.stableId),
    class: stringValue(raw.class),
    title: stringValue(raw.title),
    pid: numberValue(raw.pid),
    workspace: workspaceRef(raw.workspace),
    monitor: numberValue(raw.monitor),
    mapped: booleanValue(raw.mapped, true),
    floating: booleanValue(raw.floating),
    fullscreen: Boolean(numberValue(raw.fullscreen) ?? 0),
  }
}

export async function readHyprlandState(runner: CommandRunner): Promise<HyprlandState> {
  const [activeRaw, clientsRaw, monitorsRaw, workspacesRaw] = await Promise.all([
    runner.hyprQuery("j/activewindow"),
    runner.hyprQuery("j/clients"),
    runner.hyprQuery("j/monitors"),
    runner.hyprQuery("j/workspaces"),
  ])

  if (!clientsRaw.trim() && !monitorsRaw.trim() && !activeRaw.trim()) {
    throw new HyprComputerUseError(ERROR.unavailableState, "Hyprland IPC is unavailable")
  }

  return {
    timestamp: new Date().toISOString(),
    activeWindow: parseJsonObject(activeRaw),
    clients: parseJsonArray(clientsRaw).map(normalizeClient),
    monitors: parseJsonArray(monitorsRaw).map(normalizeMonitor),
    workspaces: parseJsonArray(workspacesRaw),
  }
}

export function activeTargetFromState(state: HyprlandState): TargetSnapshot | null {
  if (!state.activeWindow) {
    return null
  }

  const activeAddress = normalizeAddress(state.activeWindow.address)
  if (!activeAddress) {
    return null
  }

  const matches = state.clients.filter((client) => client.address === activeAddress)
  if (matches.length === 0) {
    throw new HyprComputerUseError(ERROR.noActiveTarget, "Active Hyprland window was not found in clients", {
      activeAddress,
    })
  }

  if (matches.length > 1) {
    throw new HyprComputerUseError(ERROR.ambiguousTarget, "Active Hyprland window matched multiple clients", {
      activeAddress,
      matches: matches.length,
    })
  }

  const target = matches[0]
  const monitorName = state.monitors.find((monitor) => monitor.id === target.monitor)?.name ?? null
  return {
    ...target,
    timestamp: state.timestamp,
    monitorName,
  }
}
