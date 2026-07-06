import { match, P } from "ts-pattern"
import { appApprovalReport, type ApprovalReport } from "./approval"
import { captureScreenshot } from "./capture"
import type { CommandRunner } from "./command"
import { ERROR, HyprComputerUseError } from "./errors"
import { activeTargetFromState, readHyprlandState } from "./hyprland"
import type { CaptureRequest, CaptureResult, ClientSnapshot, Geometry, HyprlandState, TargetSnapshot, WorkspaceRef } from "./types"

type ApprovedTarget = {
  stableId?: string | null
  address?: string | null
  class?: string | null
  title?: string | null
  workspace?: Partial<WorkspaceRef> | null
  monitor?: number | null
  monitorName?: string | null
}

export type GuardedKeyboardArgs = Omit<CaptureRequest, "scope"> & {
  key?: string
  chord?: string
  sequence?: string[]
  text?: string
  waitMs?: number
  approvedTarget?: ApprovedTarget
  requestedRoute?: string
  actionSummary?: string
  targetHint?: string
}

export type GuardedKeyboardPlanStep = {
  action?: string
  key?: string
  chord?: string
  sequence?: string[]
  waitMs?: number
}

export type GuardedKeyboardPlanArgs = GuardedKeyboardArgs & {
  steps?: GuardedKeyboardPlanStep[]
}

type KeyStroke = {
  raw: string
  mods: string[]
  key: string
}

type KeyboardInput = {
  kind: "key" | "chord" | "sequence"
  requested: string | string[]
  strokes: KeyStroke[]
}

type KeyboardDispatch = {
  backend: "hyprland-dispatcher" | "hyprland-key-state"
  selector: string
  dispatcher: "hl.dsp.send_shortcut" | "hl.dsp.send_key_state"
  strokes: KeyStroke[]
}

type ApprovedKeyboardTarget = {
  approval: ApprovalReport
  target: TargetSnapshot
}

type FieldPair = readonly [unknown, unknown]

export type GuardedKeyboardResult = {
  timestamp: string
  input: KeyboardInput
  approval: ApprovalReport
  target: TargetSnapshot
  selector: string
  backend: "hyprland-dispatcher" | "hyprland-key-state"
  beforeCapture: CaptureResult
  afterCapture: CaptureResult
  dispatch: KeyboardDispatch
}

export type GuardedKeyboardPlanResult = {
  timestamp: string
  steps: Array<{
    index: number
    action: string | null
    keyboard: GuardedKeyboardResult
  }>
}

const maxSequenceLength = 8
const maxPlanSteps = 100
const maxWaitMs = 5000
const keyHoldMs = 80

const keyAliases = new Map<string, string>([
  ["arrowup", "UP"],
  ["arrowdown", "DOWN"],
  ["arrowleft", "LEFT"],
  ["arrowright", "RIGHT"],
  ["up", "UP"],
  ["down", "DOWN"],
  ["left", "LEFT"],
  ["right", "RIGHT"],
  ["enter", "RETURN"],
  ["return", "RETURN"],
  ["escape", "ESCAPE"],
  ["esc", "ESCAPE"],
  ["space", "SPACE"],
  ["tab", "TAB"],
  ["backspace", "BACKSPACE"],
  ["delete", "DELETE"],
  ["insert", "INSERT"],
  ["home", "HOME"],
  ["end", "END"],
  ["pageup", "PAGE_UP"],
  ["pagedown", "PAGE_DOWN"],
])

const modAliases = new Map<string, string>([
  ["ctrl", "CTRL"],
  ["control", "CTRL"],
  ["shift", "SHIFT"],
  ["alt", "ALT"],
  ["option", "ALT"],
  ["super", "SUPER"],
  ["meta", "SUPER"],
  ["cmd", "SUPER"],
  ["command", "SUPER"],
])

function geometryFromTarget(target: TargetSnapshot): Geometry {
  return {
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
  }
}

function normalizeAddress(address: string | null | undefined): string | null {
  const normalized = address?.replace(/^0x/, "") ?? ""
  return normalized.length > 0 ? normalized : null
}

function isLikelyTextInput(value: string): boolean {
  const trimmed = value.trim()
  return /\s/.test(trimmed) || /^[a-z]{2,}$/u.test(trimmed)
}

function normalizeKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Keyboard input requires an explicit key", { input: raw })
  }

  if (/^[a-z0-9]$/iu.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/iu.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  const alias = keyAliases.get(trimmed.toLowerCase())
  if (alias) {
    return alias
  }

  if (isLikelyTextInput(trimmed)) {
    throw new HyprComputerUseError(ERROR.textInputUnsupported, "Free-form text input is not supported by guarded keyboard mode", {
      input: raw,
      reason: "text-input-unsupported",
    })
  }

  throw new HyprComputerUseError(ERROR.unsupportedKey, "Unsupported guarded keyboard key", {
    input: raw,
    reason: "unsupported-key",
  })
}

function parseStroke(raw: string): KeyStroke {
  const parts = raw.split("+").map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length === 0) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Keyboard input requires an explicit key", { input: raw })
  }

  const key = normalizeKey(parts[parts.length - 1])
  const mods = parts.slice(0, -1).map((part) => {
    const mod = modAliases.get(part.toLowerCase())
    if (!mod) {
      throw new HyprComputerUseError(ERROR.unsupportedKey, "Unsupported guarded keyboard modifier", {
        input: raw,
        modifier: part,
        reason: "unsupported-key",
      })
    }
    return mod
  })

  if (new Set(mods).size !== mods.length) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Duplicate guarded keyboard modifier", {
      input: raw,
      reason: "unsupported-key",
    })
  }

  return { raw, mods, key }
}

function parseKeyboardInput(args: GuardedKeyboardArgs): KeyboardInput {
  if (args.text?.trim()) {
    throw new HyprComputerUseError(ERROR.textInputUnsupported, "Free-form text input is not supported by guarded keyboard mode", {
      input: args.text,
      reason: "text-input-unsupported",
    })
  }

  const requestedInputs = [args.key, args.chord, args.sequence].filter((value) => value !== undefined).length
  if (requestedInputs !== 1) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Guarded keyboard mode requires exactly one key, chord, or sequence", {
      key: args.key,
      chord: args.chord,
      sequence: args.sequence,
      reason: "unsupported-key",
    })
  }

  if (args.sequence) {
    if (args.sequence.length === 0 || args.sequence.length > maxSequenceLength) {
      throw new HyprComputerUseError(ERROR.unsupportedKey, "Guarded keyboard sequence must contain 1-8 explicit keys or chords", {
        sequence: args.sequence,
        maxSequenceLength,
        reason: "unsupported-key",
      })
    }

    return {
      kind: "sequence",
      requested: args.sequence,
      strokes: args.sequence.map(parseStroke),
    }
  }

  if (args.chord) {
    return {
      kind: "chord",
      requested: args.chord,
      strokes: [parseStroke(args.chord)],
    }
  }

  if (!args.key) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Guarded keyboard mode requires an explicit key", {
      reason: "unsupported-key",
    })
  }

  const stroke = parseStroke(args.key)
  return {
    kind: stroke.mods.length > 0 ? "chord" : "key",
    requested: args.key,
    strokes: [stroke],
  }
}

function targetMatchesApprovedInput(target: TargetSnapshot, approvedTarget?: ApprovedTarget): boolean {
  if (!approvedTarget) return false

  const idMatches = match(target.stableId)
    .with(P.string, (stableId) => approvedTarget.stableId === stableId)
    .otherwise(() => normalizeAddress(approvedTarget.address) === normalizeAddress(target.address))

  return idMatches && optionalFieldsMatch([
    [approvedTarget.class, target.class],
    [approvedTarget.title, target.title],
    [approvedTarget.monitor, target.monitor],
    [approvedTarget.monitorName, target.monitorName],
    [approvedTarget.workspace?.id, target.workspace?.id],
    [approvedTarget.workspace?.name, target.workspace?.name],
  ])
}

function targetIdentityMatches(approved: TargetSnapshot, current: TargetSnapshot): boolean {
  const idMatches = match(approved.stableId)
    .with(P.string, (stableId) => current.stableId === stableId)
    .otherwise(() => normalizeAddress(current.address) === normalizeAddress(approved.address))

  return idMatches && exactFieldsMatch([
    [current.class, approved.class],
    [current.title, approved.title],
    [current.monitor, approved.monitor],
    [current.monitorName, approved.monitorName],
    [current.workspace?.id, approved.workspace?.id],
    [current.workspace?.name, approved.workspace?.name],
  ])
}

function optionalFieldsMatch(fields: FieldPair[]): boolean {
  return fields.every(([expected, actual]) => expected === undefined || expected === actual)
}

function exactFieldsMatch(fields: FieldPair[]): boolean {
  return fields.every(([expected, actual]) => expected === actual)
}

function targetFromClient(state: HyprlandState, client: ClientSnapshot): TargetSnapshot {
  return {
    ...client,
    timestamp: state.timestamp,
    monitorName: state.monitors.find((monitor) => monitor.id === client.monitor)?.name ?? null,
  }
}

function revalidatedTargetFromState(approved: TargetSnapshot, state: HyprlandState): TargetSnapshot {
  const approvedStableId = approved.stableId
  const approvedAddress = normalizeAddress(approved.address)
  const matches = approvedStableId
    ? state.clients.filter((client) => client.stableId === approvedStableId)
    : state.clients.filter((client) => normalizeAddress(client.address) === approvedAddress)

  if (matches.length === 0) {
    throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard target disappeared before input", {
      approvedTarget: approved,
      reason: "missing-target",
    })
  }

  if (matches.length > 1) {
    throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard target matched multiple current clients", {
      approvedTarget: approved,
      matches: matches.length,
      reason: "ambiguous-target",
    })
  }

  const target = targetFromClient(state, matches[0])
  if (target.mapped === false) {
    throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard target is no longer mapped", {
      approvedTarget: approved,
      currentTarget: target,
      reason: "missing-target",
    })
  }

  if (targetIdentityMatches(approved, target) === false) {
    throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard target identity changed before input", {
      approvedTarget: approved,
      currentTarget: target,
      reason: "target-drift",
    })
  }

  return target
}

function approvedTargetFromState(state: HyprlandState, approvedTarget?: ApprovedTarget): TargetSnapshot | null {
  if (!approvedTarget) return null

  const matches = state.clients
    .map((client) => targetFromClient(state, client))
    .filter((target) => targetMatchesApprovedInput(target, approvedTarget))

  return match(matches)
    .with([], () => {
      throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard approved target was not found", {
        approvedTarget,
        reason: "missing-target",
      })
    })
    .with([P.select()], (target) => target)
    .otherwise(() => {
      throw new HyprComputerUseError(ERROR.targetDrift, "Guarded keyboard approved target matched multiple current clients", {
        approvedTarget,
        matches: matches.length,
        reason: "ambiguous-target",
      })
    })
}

async function focusTargetAndReadState(runner: CommandRunner, target: TargetSnapshot, backend: KeyboardDispatch["backend"]) {
  if ((await runner.commandExists("hyprctl")) === false) {
    throw new HyprComputerUseError(ERROR.noInputBackend, "Focused Hyprland keyboard input requires hyprctl", {
      target,
      backend,
      reason: "no-input-backend",
    })
  }

  const selector = targetSelector(target)
  try {
    await runner.execFile("hyprctl", ["dispatch", focusExpression(selector)], { timeout: 1500 })
  } catch (error) {
    throw new HyprComputerUseError(ERROR.noInputBackend, "Focused Hyprland keyboard target could not be focused", {
      target,
      backend,
      selector,
      error: error instanceof Error ? error.message : String(error),
      reason: "wayland-focus-failed",
    })
  }

  const focusedState = await readHyprlandState(runner)
  const currentTarget = revalidatedTargetFromState(target, focusedState)
  const activeTarget = activeTargetFromState(focusedState)
  if (activeTarget === null || targetIdentityMatches(currentTarget, activeTarget) === false) {
    throw new HyprComputerUseError(ERROR.noInputBackend, "Focused Hyprland keyboard target did not become active before input", {
      target: currentTarget,
      activeTarget,
      backend,
      selector,
      reason: "wayland-focus-failed",
    })
  }

  return { state: focusedState, target: currentTarget }
}

function rejectUnsafeXwaylandTargeting(state: HyprlandState, target: TargetSnapshot, input: KeyboardInput, beforeCapture: CaptureResult) {
  if (target.xwayland === false) return

  const activeTarget = activeTargetFromState(state)
  if (!activeTarget || activeTarget.address === target.address || activeTarget.xwayland === false) return

  throw new HyprComputerUseError(ERROR.noInputBackend, "Hyprland targeted keyboard dispatch is unsafe between two different XWayland windows", {
    input,
    approvedTarget: target,
    activeTarget,
    beforeCapture,
    backend: "hyprland-dispatcher",
    reason: "xwayland-targeting-unsafe",
  })
}

function targetSelector(target: TargetSnapshot): string {
  if (target.stableId) {
    return `stableid:${target.stableId}`
  }

  const address = normalizeAddress(target.address)
  if (address) {
    return `address:0x${address}`
  }

  throw new HyprComputerUseError(ERROR.noInputBackend, "Approved target has no strong Hyprland selector", {
    target,
    reason: "no-input-backend",
  })
}

function luaString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function shortcutExpression(stroke: KeyStroke, selector: string): string {
  return `hl.dsp.send_shortcut({ mods = ${luaString(stroke.mods.join(" + "))}, key = ${luaString(stroke.key)}, window = ${luaString(selector)} })`
}

function keyStateExpression(stroke: KeyStroke, selector: string, state: "down" | "up"): string {
  return `hl.dsp.send_key_state({ mods = ${luaString(stroke.mods.join(" + "))}, key = ${luaString(stroke.key)}, state = ${luaString(state)}, window = ${luaString(selector)} })`
}

function focusExpression(selector: string): string {
  return `hl.dsp.focus({ window = ${luaString(selector)} })`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizedWaitMs(value: number | undefined): number {
  if (value === undefined) return 0
  if (Number.isInteger(value) === false || value < 0 || value > maxWaitMs) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Keyboard waitMs must be an integer between 0 and 5000", {
      waitMs: value,
      maxWaitMs,
      reason: "unsupported-key",
    })
  }
  return value
}

async function captureTarget(runner: CommandRunner, args: GuardedKeyboardArgs, target: TargetSnapshot): Promise<CaptureResult> {
  const capture = await captureScreenshot(runner, {
    ...args,
    scope: "region",
    region: geometryFromTarget(target),
  })
  return { ...capture, target }
}

async function dispatchKeyboard(runner: CommandRunner, input: KeyboardInput, selector: string): Promise<KeyboardDispatch> {
  if ((await runner.commandExists("hyprctl")) === false) {
    throw new HyprComputerUseError(ERROR.noInputBackend, "Hyprland targeted keyboard dispatcher is unavailable", {
      backend: "hyprland-dispatcher",
      reason: "no-input-backend",
    })
  }

  for (const stroke of input.strokes) {
    try {
      await runner.execFile("hyprctl", ["dispatch", shortcutExpression(stroke, selector)], { timeout: 1500 })
    } catch (error) {
      throw new HyprComputerUseError(ERROR.noInputBackend, "Hyprland targeted keyboard dispatch failed", {
        backend: "hyprland-dispatcher",
        selector,
        input: stroke,
        error: error instanceof Error ? error.message : String(error),
        reason: "no-input-backend",
      })
    }
  }

  return {
    backend: "hyprland-dispatcher",
    selector,
    dispatcher: "hl.dsp.send_shortcut",
    strokes: input.strokes,
  }
}

async function dispatchFocusedHyprlandKeyState(runner: CommandRunner, input: KeyboardInput, target: TargetSnapshot): Promise<KeyboardDispatch> {
  const selector = targetSelector(target)

  for (const stroke of input.strokes) {
    try {
      await runner.execFile("hyprctl", ["dispatch", keyStateExpression(stroke, selector, "down")], { timeout: 1500 })
      await wait(keyHoldMs)
      await runner.execFile("hyprctl", ["dispatch", keyStateExpression(stroke, selector, "up")], { timeout: 1500 })
    } catch (error) {
      throw new HyprComputerUseError(ERROR.noInputBackend, "Focused Wayland keyboard dispatch failed", {
        target,
        backend: "hyprland-key-state",
        selector,
        input: stroke,
        error: error instanceof Error ? error.message : String(error),
        reason: "no-input-backend",
      })
    }
  }

  return {
    backend: "hyprland-key-state",
    selector,
    dispatcher: "hl.dsp.send_key_state",
    strokes: input.strokes,
  }
}

function approvedTargetHint(args: GuardedKeyboardArgs, approvedTarget: TargetSnapshot | null): string | undefined {
  return [args.targetHint, approvedTarget?.title, approvedTarget?.class]
    .find((value): value is string => value !== null && value !== undefined)
}

function approvedKeyboardTarget(input: KeyboardInput, args: GuardedKeyboardArgs, state: HyprlandState, approvedTarget: TargetSnapshot | null): ApprovedKeyboardTarget {
  const approval = appApprovalReport(state, {
    requestedRoute: args.requestedRoute,
    actionSummary: args.actionSummary,
    targetHint: approvedTargetHint(args, approvedTarget),
  })
  const target = approval.target

  if (target === null) {
    throw new HyprComputerUseError(ERROR.approvalRequired, "Guarded keyboard input requires a resolved approved target", {
      input,
      approval,
      reason: "missing-target",
    })
  }

  match(approval.decision)
    .with({ state: P.not("ask") }, () => {
      throw new HyprComputerUseError(ERROR.rejectedSideEffect, "Guarded keyboard input is denied for this target", {
        input,
        approval,
        reason: approval.decision.reason,
      })
    })
    .with({ state: "ask" }, () => undefined)
    .exhaustive()

  if (targetMatchesApprovedInput(target, args.approvedTarget) === false) {
    throw new HyprComputerUseError(ERROR.approvalRequired, "Guarded keyboard input requires explicit one-turn approval for this exact target", {
      input,
      approval,
      reason: "approval-required",
    })
  }

  return { approval, target }
}

export async function executeGuardedKeyboard(runner: CommandRunner, args: GuardedKeyboardArgs): Promise<GuardedKeyboardResult> {
  const input = parseKeyboardInput(args)
  const initialState = await readHyprlandState(runner)
  const approvedTarget = approvedTargetFromState(initialState, args.approvedTarget)
  const { approval, target } = approvedKeyboardTarget(input, args, initialState, approvedTarget)

  const beforeCapture = await captureTarget(runner, args, target)
  let currentTarget: TargetSnapshot
  let revalidatedState: HyprlandState
  try {
    const focused = await focusTargetAndReadState(runner, target, target.xwayland === true ? "hyprland-key-state" : "hyprland-dispatcher")
    currentTarget = focused.target
    revalidatedState = focused.state
  } catch (error) {
    if (error instanceof HyprComputerUseError) {
      throw new HyprComputerUseError(error.code, error.message, {
        input,
        approval,
        beforeCapture,
        ...error.details,
      })
    }
    throw error
  }

  const dispatch = await match(currentTarget)
    .with({ xwayland: true }, (target) => dispatchFocusedHyprlandKeyState(runner, input, target))
    .otherwise((target) => {
      rejectUnsafeXwaylandTargeting(revalidatedState, target, input, beforeCapture)
      return dispatchKeyboard(runner, input, targetSelector(target))
    })
  const waitMs = normalizedWaitMs(args.waitMs)
  if (waitMs > 0) {
    await wait(waitMs)
  }
  const afterCapture = await captureTarget(runner, args, currentTarget)

  return {
    timestamp: new Date().toISOString(),
    input,
    approval,
    target: currentTarget,
    selector: dispatch.selector,
    backend: dispatch.backend,
    beforeCapture,
    afterCapture,
    dispatch,
  }
}

export async function executeGuardedKeyboardPlan(runner: CommandRunner, args: GuardedKeyboardPlanArgs): Promise<GuardedKeyboardPlanResult> {
  const steps = args.steps ?? []
  if (steps.length === 0 || steps.length > maxPlanSteps) {
    throw new HyprComputerUseError(ERROR.unsupportedKey, "Keyboard plan requires 1-100 explicit steps", {
      steps: steps.length,
      maxPlanSteps,
      reason: "unsupported-key",
    })
  }

  const results: GuardedKeyboardPlanResult["steps"] = []
  for (const [index, step] of steps.entries()) {
    const keyboard = await executeGuardedKeyboard(runner, {
      ...args,
      key: step.key,
      chord: step.chord,
      sequence: step.sequence,
      text: undefined,
      waitMs: step.waitMs ?? args.waitMs,
      actionSummary: step.action ?? args.actionSummary,
    })
    results.push({
      index,
      action: step.action ?? null,
      keyboard,
    })
  }

  return {
    timestamp: new Date().toISOString(),
    steps: results,
  }
}
