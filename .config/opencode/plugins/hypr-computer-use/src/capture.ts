import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { ERROR, HyprComputerUseError } from "./errors"
import type { CommandRunner } from "./command"
import { activeTargetFromState, previewIdForClient, readHyprlandState } from "./hyprland"
import type { CaptureRequest, CaptureResult, Geometry, HyprlandState, MonitorSnapshot, TargetSnapshot } from "./types"

function defaultCaptureRoot(): string {
  return process.env.XDG_RUNTIME_DIR
    ? join(process.env.XDG_RUNTIME_DIR, "hypr-computer-use", "captures")
    : "/tmp/hypr-computer-use-captures"
}

function timestampFilename(scope: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${scope}.png`
}

function geometryArg(geometry: Geometry): string {
  return `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`
}

function monitorMatches(monitor: MonitorSnapshot, identifier: string): boolean {
  return monitor.name === identifier || String(monitor.id) === identifier
}

async function ensureGrim(runner: CommandRunner, scope: string) {
  if (await runner.commandExists("grim")) return
  throw new HyprComputerUseError(ERROR.missingBackend, "No compatible screenshot backend is available", {
    scope,
    backend: "grim",
  })
}

async function outputPathFor(request: CaptureRequest): Promise<string> {
  if (request.outputPath) return request.outputPath
  const directory = defaultCaptureRoot()
  await mkdir(directory, { recursive: true })
  return join(directory, timestampFilename(request.scope))
}

async function runGrim(runner: CommandRunner, args: string[]) {
  try {
    await runner.execFile("grim", args, { timeout: 3000 })
  } catch (error) {
    throw new HyprComputerUseError(ERROR.missingBackend, "Screenshot capture failed with configured backend", {
      backend: "grim",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function captureScreenshot(
  runner: CommandRunner,
  request: CaptureRequest,
  existingState?: HyprlandState,
): Promise<CaptureResult> {
  if (request.scope === "region" && !request.region) {
    throw new HyprComputerUseError(ERROR.regionRequired, "Region capture requires explicit region geometry")
  }

  if (request.scope === "full" && request.allowFullDesktop !== true) {
    throw new HyprComputerUseError(ERROR.fullCaptureNotAllowed, "Full-desktop capture requires explicit policy opt-in")
  }

  await ensureGrim(runner, request.scope)
  const needsState = request.scope === "active-window" || request.scope === "monitor"
  const state = needsState ? existingState ?? (await readHyprlandState(runner)) : null
  const path = await outputPathFor(request)
  const timestamp = new Date().toISOString()
  let target: TargetSnapshot | null = null
  let monitor: MonitorSnapshot | null = null
  let region: Geometry | null = null

  if (request.scope === "active-window") {
    if (!state) {
      throw new HyprComputerUseError(ERROR.unavailableState, "Active-window capture requires Hyprland state")
    }

    target = activeTargetFromState(state)
    if (!target) {
      throw new HyprComputerUseError(ERROR.noActiveTarget, "Active-window capture requires an active target")
    }

    const previewId = previewIdForClient(target)
    if (!previewId) {
      throw new HyprComputerUseError(ERROR.noActiveTarget, "Active target has no toplevel identifier")
    }

    await runGrim(runner, ["-T", previewId, path])
  } else if (request.scope === "monitor") {
    if (!state) {
      throw new HyprComputerUseError(ERROR.unavailableState, "Monitor capture requires Hyprland state")
    }

    if (!request.monitor) {
      throw new HyprComputerUseError(ERROR.unsupportedScope, "Monitor capture requires a monitor identifier")
    }

    monitor = state.monitors.find((candidate) => monitorMatches(candidate, request.monitor || "")) ?? null
    if (!monitor) {
      throw new HyprComputerUseError(ERROR.unsupportedScope, "Requested monitor was not found", {
        monitor: request.monitor,
      })
    }

    region = monitor
    await runGrim(runner, ["-g", geometryArg(monitor), path])
  } else if (request.scope === "region") {
    const requestedRegion = request.region
    if (!requestedRegion) {
      throw new HyprComputerUseError(ERROR.regionRequired, "Region capture requires explicit region geometry")
    }

    region = requestedRegion
    await runGrim(runner, ["-g", geometryArg(region), path])
  } else if (request.scope === "full") {
    await runGrim(runner, [path])
  } else {
    throw new HyprComputerUseError(ERROR.unsupportedScope, "Unsupported screenshot capture scope", {
      scope: request.scope,
    })
  }

  return {
    timestamp,
    scope: request.scope,
    backend: "grim",
    path,
    target,
    monitor,
    region,
  }
}
