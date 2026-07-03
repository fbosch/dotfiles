import { nodeCommandRunner, type CommandRunner } from "./command"
import { captureScreenshot } from "./capture"
import { writeEvidence } from "./evidence"
import { ERROR, HyprComputerUseError, errorResult } from "./errors"
import { activeTargetFromState, readHyprlandState } from "./hyprland"
import type { CaptureRequest, EvidenceRecord } from "./types"

export type ToolMode =
  | "state"
  | "snapshot"
  | "capture"
  | "click"
  | "type"
  | "pointer"
  | "keyboard"
  | "dispatch"
  | "clipboard"
  | "locked-use"

export type ToolArgs = Omit<CaptureRequest, "scope"> & {
  mode?: ToolMode
  scope?: CaptureRequest["scope"]
}

export type ToolOptions = {
  runner?: CommandRunner
}

function sideEffectMessage(mode: string): string {
  return `Mode '${mode}' is outside the read-only Hyprland visibility capability`
}

async function recordEvidence(record: EvidenceRecord, evidenceDir?: string) {
  const evidencePath = await writeEvidence(record, evidenceDir)
  return {
    ...record,
    evidencePath,
  }
}

export async function executeReadonlyTool(args: ToolArgs, options: ToolOptions = {}) {
  const runner = options.runner ?? nodeCommandRunner
  const mode = args.mode ?? "state"

  try {
    if (["click", "type", "pointer", "keyboard", "dispatch", "clipboard", "locked-use"].includes(mode)) {
      throw new HyprComputerUseError(ERROR.rejectedSideEffect, sideEffectMessage(mode), { mode })
    }

    if (mode === "state") {
      const state = await readHyprlandState(runner)
      const evidence = await recordEvidence(
        {
          timestamp: state.timestamp,
          operation: "state",
          target: activeTargetFromState(state),
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        state,
        evidence,
      }
    }

    if (mode === "snapshot") {
      const state = await readHyprlandState(runner)
      const target = activeTargetFromState(state)
      const evidence = await recordEvidence(
        {
          timestamp: state.timestamp,
          operation: "snapshot",
          target,
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        target,
        evidence,
      }
    }

    if (mode === "capture") {
      if (!args.scope) {
        throw new HyprComputerUseError(ERROR.unsupportedScope, "Capture mode requires an explicit scope")
      }

      const capture = await captureScreenshot(runner, { ...args, scope: args.scope })
      const evidence = await recordEvidence(
        {
          timestamp: capture.timestamp,
          operation: "capture",
          target: capture.target,
          capture: {
            timestamp: capture.timestamp,
            scope: capture.scope,
            backend: capture.backend,
            path: capture.path,
            monitor: capture.monitor,
            region: capture.region,
          },
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        capture,
        evidence,
      }
    }

    throw new HyprComputerUseError(ERROR.unsupportedScope, "Unsupported read-only tool mode", { mode })
  } catch (error) {
    const result = errorResult(error)
    try {
      const evidence = await recordEvidence(
        {
          timestamp: new Date().toISOString(),
          operation: "rejected",
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        },
        args.evidenceDir,
      )
      return { ...result, evidence }
    } catch {
      return result
    }
  }
}
