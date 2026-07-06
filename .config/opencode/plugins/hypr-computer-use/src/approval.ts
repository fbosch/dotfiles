import { activeTargetFromState } from "./hyprland"
import type { ClientSnapshot, HyprlandState, TargetSnapshot, WorkspaceRef } from "./types"

export type AppIdentity = {
  desktopId: string | null
  flatpakId: string | null
  name: string | null
  class: string | null
  title: string | null
  pid: number | null
  workspace: WorkspaceRef | null
  monitor: number | null
  monitorName: string | null
  address: string
  stableId: string | null
  confidence: "partial" | "none"
}

export type ApprovalRequest = {
  requestedRoute?: string
  actionSummary?: string
  targetHint?: string
  persistApproval?: boolean
}

export type ApprovalPrompt = {
  appName: string | null
  class: string | null
  title: string | null
  pid: number | null
  workspace: WorkspaceRef | null
  monitor: number | null
  monitorName: string | null
  desktopId: string | null
  flatpakId: string | null
  requestedRoute: string | null
  actionSummary: string | null
  reason: string
}

export type ApprovalDecision = {
  state: "ask"
  reason: "unknown-normal-app"
  matchedSignals: string[]
  prompt: ApprovalPrompt
} | {
  state: "sensitive"
  reason: "sensitive-context"
  matchedSignals: string[]
  prompt: ApprovalPrompt
} | {
  state: "denied"
  reason: "terminal-gui" | "self-target" | "privileged-prompt" | "missing-target" | "ambiguous-target" | "browser-page-interaction" | "persistent-approval-unsupported"
  matchedSignals: string[]
  recommendation: string
  candidates?: AppIdentity[]
}

export type ApprovalReport = {
  timestamp: string
  request: {
    requestedRoute: string | null
    actionSummary: string | null
    targetHint: string | null
    persistApproval: boolean
  }
  target: TargetSnapshot | null
  identity: AppIdentity | null
  decision: ApprovalDecision
}

function identityFromTarget(target: TargetSnapshot): AppIdentity {
  return {
    desktopId: null,
    flatpakId: null,
    name: target.class,
    class: target.class,
    title: target.title,
    pid: target.pid,
    workspace: target.workspace,
    monitor: target.monitor,
    monitorName: target.monitorName,
    address: target.address,
    stableId: target.stableId,
    confidence: target.class || target.title || target.pid ? "partial" : "none",
  }
}

function targetFromClient(state: HyprlandState, client: ClientSnapshot): TargetSnapshot {
  const monitorName = state.monitors.find((monitor) => monitor.id === client.monitor)?.name ?? null
  return {
    ...client,
    timestamp: state.timestamp,
    monitorName,
  }
}

function targetMatchesHint(client: ClientSnapshot, targetHint: string): boolean {
  const hint = targetHint.toLowerCase()
  return [client.class, client.title].some((value) => value?.toLowerCase().includes(hint))
}

function resolveTarget(state: HyprlandState, targetHint?: string) {
  if (targetHint) {
    const matches = state.clients.filter((client) => targetMatchesHint(client, targetHint))
    if (matches.length !== 1) {
      return {
        target: null,
        candidates: matches.map((client) => identityFromTarget(targetFromClient(state, client))),
      }
    }
    return { target: targetFromClient(state, matches[0]), candidates: [] }
  }

  return { target: activeTargetFromState(state), candidates: [] }
}

const terminalSignals = [
  "alacritty",
  "kitty",
  "foot",
  "ghostty",
  "wezterm",
  "org.wezfurlong.wezterm",
  "terminal",
]

const selfTargetSignals = [
  "opencode",
  "codex",
  "agent approval",
  "tool permission",
  "permission prompt",
]

const privilegedPromptSignals = [
  "polkit",
  "policykit",
  "authentication required",
  "authenticate",
  "sudo",
  "password",
  "keychain",
  "system security",
  "security prompt",
  "browser permission",
]

const sensitiveSignals = [
  "account",
  "payment",
  "billing",
  "credential",
  "password",
  "passkey",
  "2fa",
  "two-factor",
  "privacy",
  "security",
]

const browserSignals = [
  "browser",
  "zen",
  "firefox",
  "chrome",
  "chromium",
  "brave",
  "vivaldi",
]

const browserPageActionSignals = [
  "browser page",
  "page interaction",
  "navigate",
  "tab",
  "click link",
  "fill form",
  "evaluate javascript",
  "extract page",
]

function matchingSignals(identity: AppIdentity, signals: string[]): string[] {
  const values = [identity.class, identity.title].flatMap((value) => value ? [value.toLowerCase()] : [])
  return signals.filter((signal) => values.some((value) => value.includes(signal)))
}

function matchingContextSignals(identity: AppIdentity, request: ApprovalRequest, signals: string[]): string[] {
  const values = [identity.class, identity.title, request.requestedRoute, request.actionSummary, request.targetHint].flatMap((value) => value ? [value.toLowerCase()] : [])
  return signals.filter((signal) => values.some((value) => value.includes(signal)))
}

function matchingRequestSignals(request: ApprovalRequest, signals: string[]): string[] {
  const values = [request.requestedRoute, request.actionSummary, request.targetHint].flatMap((value) => value ? [value.toLowerCase()] : [])
  return signals.filter((signal) => values.some((value) => value.includes(signal)))
}

function promptForIdentity(identity: AppIdentity, requestedRoute: string | null, actionSummary: string | null, reason: string): ApprovalPrompt {
  return {
    appName: identity.name,
    class: identity.class,
    title: identity.title,
    pid: identity.pid,
    workspace: identity.workspace,
    monitor: identity.monitor,
    monitorName: identity.monitorName,
    desktopId: identity.desktopId,
    flatpakId: identity.flatpakId,
    requestedRoute,
    actionSummary,
    reason,
  }
}

export function appApprovalReport(state: HyprlandState, request: ApprovalRequest = {}): ApprovalReport {
  const requestedRoute = request.requestedRoute ?? null
  const actionSummary = request.actionSummary ?? null
  const targetHint = request.targetHint ?? null
  const { target, candidates } = resolveTarget(state, request.targetHint)

  if (!target) {
    const ambiguous = candidates.length > 1
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: request.persistApproval === true,
      },
      target: null,
      identity: null,
      decision: {
        state: "denied",
        reason: ambiguous ? "ambiguous-target" : "missing-target",
        matchedSignals: targetHint ? [targetHint] : [],
        recommendation: ambiguous
          ? "Choose one matching app target before approving desktop-level action"
          : "Resolve an active app target before approving desktop-level action",
        candidates: ambiguous ? candidates : undefined,
      },
    }
  }

  const identity = identityFromTarget(target)
  const selfTargetMatches = matchingSignals(identity, selfTargetSignals)

  if (request.persistApproval === true) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: true,
      },
      target,
      identity,
      decision: {
        state: "denied",
        reason: "persistent-approval-unsupported",
        matchedSignals: [],
        recommendation: "Use one-time approval only; persistent Always Allow rules require a separate policy capability",
      },
    }
  }

  if (selfTargetMatches.length > 0) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: false,
      },
      target,
      identity,
      decision: {
        state: "denied",
        reason: "self-target",
        matchedSignals: selfTargetMatches,
        recommendation: "Do not automate OpenCode, Codex, agent approval, or tool-permission windows",
      },
    }
  }

  const privilegedPromptMatches = matchingSignals(identity, privilegedPromptSignals)

  if (privilegedPromptMatches.length > 0) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: false,
      },
      target,
      identity,
      decision: {
        state: "denied",
        reason: "privileged-prompt",
        matchedSignals: privilegedPromptMatches,
        recommendation: "Privileged, authentication, security, and permission prompts require human handling",
      },
    }
  }

  const terminalMatches = matchingSignals(identity, terminalSignals)

  if (terminalMatches.length > 0) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: false,
      },
      target,
      identity,
      decision: {
        state: "denied",
        reason: "terminal-gui",
        matchedSignals: terminalMatches,
        recommendation: "Use normal OpenCode shell tools instead of terminal GUI automation",
      },
    }
  }

  const browserMatches = matchingSignals(identity, browserSignals)
  const browserActionMatches = matchingRequestSignals(request, browserPageActionSignals)

  if (browserMatches.length > 0 && browserActionMatches.length > 0) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: false,
      },
      target,
      identity,
      decision: {
        state: "denied",
        reason: "browser-page-interaction",
        matchedSignals: [...browserMatches, ...browserActionMatches],
        recommendation: "Use agent-browser or available chrome-devtools tools for browser page interaction",
      },
    }
  }

  const sensitiveMatches = matchingContextSignals(identity, request, sensitiveSignals)

  if (sensitiveMatches.length > 0) {
    return {
      timestamp: state.timestamp,
      request: {
        requestedRoute,
        actionSummary,
        targetHint,
        persistApproval: false,
      },
      target,
      identity,
      decision: {
        state: "sensitive",
        reason: "sensitive-context",
        matchedSignals: sensitiveMatches,
        prompt: promptForIdentity(
          identity,
          requestedRoute,
          actionSummary,
          "Sensitive account, payment, credential, privacy, or security context requires a stronger gate than ordinary app approval",
        ),
      },
    }
  }

  return {
    timestamp: state.timestamp,
    request: {
      requestedRoute,
      actionSummary,
      targetHint,
      persistApproval: false,
    },
    target,
    identity,
    decision: {
      state: "ask",
      reason: "unknown-normal-app",
      matchedSignals: [],
      prompt: promptForIdentity(identity, requestedRoute, actionSummary, "Unknown normal app requires user approval before desktop-level action"),
    },
  }
}
