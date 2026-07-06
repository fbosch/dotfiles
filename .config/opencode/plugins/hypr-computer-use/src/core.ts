import { Effect } from "effect"
import { appApprovalReport } from "./approval"
import { browserTargetReport } from "./browser"
import { nodeCommandRunner, type CommandRunner } from "./command"
import { captureScreenshot } from "./capture"
import { lookupControls, upsertControls } from "./controls"
import { writeEvidence } from "./evidence"
import { ERROR, HyprComputerUseError, errorResult } from "./errors"
import { activeTargetFromState, readHyprlandState } from "./hyprland"
import { executeGuardedKeyboard, executeGuardedKeyboardPlan } from "./keyboard"
import type { CaptureRequest, CaptureResult, EvidenceRecord, Geometry, TargetSnapshot } from "./types"

export type ToolMode =
  | "state"
  | "snapshot"
  | "capture"
  | "browser-default"
  | "browser-targets"
  | "browser-capabilities"
  | "app-approval"
  | "controls-cache"
  | "click"
  | "type"
  | "pointer"
  | "keyboard"
  | "keyboard-plan"
  | "dispatch"
  | "clipboard"
  | "locked-use"

export type ToolArgs = Omit<CaptureRequest, "scope"> & {
  mode?: ToolMode
  scope?: CaptureRequest["scope"]
  webdriverBidiEndpoint?: string
  requestedRoute?: string
  actionSummary?: string
  targetHint?: string
  persistApproval?: boolean
  includeCapture?: boolean
  controlsCachePath?: string
  controls?: {
    source?: string | null
    notes?: string | null
    bindings?: Array<{
      action: string
      keys: string[]
      note?: string | null
    }>
  }
  key?: string
  chord?: string
  sequence?: string[]
  text?: string
  waitMs?: number
  steps?: Array<{
    action?: string
    key?: string
    chord?: string
    sequence?: string[]
    waitMs?: number
  }>
  approvedTarget?: {
    stableId?: string | null
    address?: string | null
    class?: string | null
    title?: string | null
    workspace?: {
      id?: number | null
      name?: string | null
    } | null
    monitor?: number | null
    monitorName?: string | null
  }
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

function geometryFromTarget(target: TargetSnapshot): Geometry {
  return {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
  }
}

function evidenceCapture(capture: CaptureResult): Omit<CaptureResult, "target"> {
  return {
    timestamp: capture.timestamp,
    scope: capture.scope,
    backend: capture.backend,
    path: capture.path,
    monitor: capture.monitor,
    region: capture.region,
  }
}

export function executeReadonlyToolEffect(args: ToolArgs, options: ToolOptions = {}) {
  const runner = options.runner ?? nodeCommandRunner
  const mode = args.mode ?? "state"

  const program = Effect.gen(function* () {
    if (["click", "type", "pointer", "dispatch", "clipboard", "locked-use"].includes(mode)) {
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

    if (mode === "browser-default" || mode === "browser-targets" || mode === "browser-capabilities") {
      const state = yield* Effect.tryPromise({
        try: () => readHyprlandState(runner),
        catch: () => null,
      })
      const browser = yield* Effect.tryPromise({
        try: () => browserTargetReport(runner, state, { webdriverBidiEndpoint: args.webdriverBidiEndpoint }),
        catch: asHyprError,
      })
      const evidence = yield* recordEvidence(
        {
          timestamp: browser.timestamp,
          operation: "browser",
          browser,
        },
        args.evidenceDir,
      )

      if (mode === "browser-default") {
        return {
          ok: true as const,
          mode,
          browser: {
            timestamp: browser.timestamp,
            defaultBrowser: browser.defaultBrowser,
            desktopEntry: browser.desktopEntry,
            identity: browser.identity,
          },
          evidence,
        }
      }

      if (mode === "browser-capabilities") {
        return {
          ok: true as const,
          mode,
          browser: {
            timestamp: browser.timestamp,
            defaultBrowser: browser.defaultBrowser,
            identity: browser.identity,
            capabilities: browser.capabilities,
          },
          evidence,
        }
      }

      return {
        ok: true as const,
        mode,
        browser,
        evidence,
      }
    }

    if (mode === "app-approval") {
      const state = yield* Effect.tryPromise({
        try: () => readHyprlandState(runner),
        catch: asHyprError,
      })
      const approval = appApprovalReport(state, {
        requestedRoute: args.requestedRoute,
        actionSummary: args.actionSummary,
        targetHint: args.targetHint,
        persistApproval: args.persistApproval,
      })
      const approvalTarget = approval.target
      const capture = args.includeCapture === true && approvalTarget !== null
        ? yield* Effect.tryPromise({
          try: async () => {
            const result = await captureScreenshot(runner, {
              ...args,
              scope: "region",
              region: geometryFromTarget(approvalTarget),
            })
            return { ...result, target: approvalTarget }
          },
          catch: asHyprError,
        })
        : null
      const controls = approvalTarget !== null
        ? yield* Effect.tryPromise({
          try: () => lookupControls(approvalTarget, args.controlsCachePath),
          catch: asHyprError,
        })
        : null
      const evidence = yield* recordEvidence(
        {
          timestamp: approval.timestamp,
          operation: "approval",
          target: approval.target,
          approval,
          capture: capture ? evidenceCapture(capture) : undefined,
          controls,
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        approval,
        capture,
        controls,
        evidence,
      }
    }

    if (mode === "controls-cache") {
      const state = yield* Effect.tryPromise({
        try: () => readHyprlandState(runner),
        catch: asHyprError,
      })
      const approval = appApprovalReport(state, {
        requestedRoute: args.requestedRoute,
        actionSummary: args.actionSummary,
        targetHint: args.targetHint,
      })
      const target = approval.target

      if (!target && args.controls) {
        yield* Effect.fail(new HyprComputerUseError(ERROR.approvalRequired, "Controls cache update requires a resolved target", {
          approval,
        }))
        throw new Error("unreachable")
      }

      const controls = target
        ? yield* Effect.tryPromise({
          try: () => args.controls
            ? upsertControls(target, args.controls, args.controlsCachePath)
            : lookupControls(target, args.controlsCachePath),
          catch: asHyprError,
        })
        : null
      const evidence = yield* recordEvidence(
        {
          timestamp: new Date().toISOString(),
          operation: "controls-cache",
          target,
          approval,
          controls,
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        approval,
        controls,
        evidence,
      }
    }

    if (mode === "keyboard") {
      const keyboard = yield* Effect.tryPromise({
        try: () => executeGuardedKeyboard(runner, args),
        catch: asHyprError,
      })
      const evidence = yield* recordEvidence(
        {
          timestamp: keyboard.timestamp,
          operation: "keyboard",
          target: keyboard.target,
          approval: keyboard.approval,
          keyboard: {
            input: keyboard.input,
            backend: keyboard.backend,
            selector: keyboard.selector,
            beforeCapture: evidenceCapture(keyboard.beforeCapture),
            afterCapture: evidenceCapture(keyboard.afterCapture),
            dispatch: keyboard.dispatch,
          },
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        keyboard,
        evidence,
      }
    }

    if (mode === "keyboard-plan") {
      const plan = yield* Effect.tryPromise({
        try: () => executeGuardedKeyboardPlan(runner, args),
        catch: asHyprError,
      })
      const evidence = yield* recordEvidence(
        {
          timestamp: plan.timestamp,
          operation: "keyboard-plan",
          target: plan.steps[plan.steps.length - 1]?.keyboard.target ?? null,
          keyboard: {
            steps: plan.steps.map((step) => ({
              index: step.index,
              action: step.action,
              input: step.keyboard.input,
              backend: step.keyboard.backend,
              selector: step.keyboard.selector,
              beforeCapture: evidenceCapture(step.keyboard.beforeCapture),
              afterCapture: evidenceCapture(step.keyboard.afterCapture),
              dispatch: step.keyboard.dispatch,
            })),
          },
        },
        args.evidenceDir,
      )

      return {
        ok: true as const,
        mode,
        plan,
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
            details: result.error.details,
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
