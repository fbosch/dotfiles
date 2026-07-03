import { Effect } from "effect"
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

function asHyprError(error: unknown): HyprComputerUseError {
  if (error instanceof HyprComputerUseError) return error
  return new HyprComputerUseError(
    ERROR.unavailableState,
    error instanceof Error ? error.message : String(error),
  )
}

function recordEvidence(record: EvidenceRecord, evidenceDir?: string) {
  return Effect.tryPromise({
    try: () => writeEvidence(record, evidenceDir),
    catch: asHyprError,
  }).pipe(
    Effect.map((evidencePath) => ({
      ...record,
      evidencePath,
    })),
  )
}

export function executeReadonlyToolEffect(args: ToolArgs, options: ToolOptions = {}) {
  const runner = options.runner ?? nodeCommandRunner
  const mode = args.mode ?? "state"

  const program = Effect.gen(function* () {
    if (["click", "type", "pointer", "keyboard", "dispatch", "clipboard", "locked-use"].includes(mode)) {
      yield* Effect.fail(new HyprComputerUseError(ERROR.rejectedSideEffect, sideEffectMessage(mode), { mode }))
    }

    if (mode === "state") {
      const state = yield* Effect.tryPromise({
        try: () => readHyprlandState(runner),
        catch: asHyprError,
      })
      const evidence = yield* recordEvidence(
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
      const state = yield* Effect.tryPromise({
        try: () => readHyprlandState(runner),
        catch: asHyprError,
      })
      const target = activeTargetFromState(state)
      const evidence = yield* recordEvidence(
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
      const scope = args.scope
      if (!scope) {
        yield* Effect.fail(new HyprComputerUseError(ERROR.unsupportedScope, "Capture mode requires an explicit scope"))
        throw new Error("unreachable")
      }

      const capture = yield* Effect.tryPromise({
        try: () => captureScreenshot(runner, { ...args, scope }),
        catch: asHyprError,
      })
      const evidence = yield* recordEvidence(
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

    return yield* Effect.fail(new HyprComputerUseError(ERROR.unsupportedScope, "Unsupported read-only tool mode", { mode }))
  })

  return program.pipe(
    Effect.catchAll((error) => {
    const result = errorResult(error)
      return recordEvidence(
        {
          timestamp: new Date().toISOString(),
          operation: "rejected",
          error: {
            code: result.error.code,
            message: result.error.message,
          },
        },
        args.evidenceDir,
      ).pipe(
        Effect.map((evidence) => ({ ...result, evidence })),
        Effect.catchAll(() => Effect.succeed(result)),
      )
    }),
  )
}

export async function executeReadonlyTool(args: ToolArgs, options: ToolOptions = {}) {
  return await Effect.runPromise(executeReadonlyToolEffect(args, options))
}
