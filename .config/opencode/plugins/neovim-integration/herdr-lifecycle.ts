import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { AgentState } from "./herdr-integration"

type Event = { properties?: unknown }
type Reporter = {
  reportState(state: AgentState): Promise<void>
  reportTitle(title: string | null): Promise<void>
}

function eventSessionId(event: Event) {
  const properties = event.properties
  if (typeof properties !== "object" || properties === null) return
  if ("sessionID" in properties && typeof properties.sessionID === "string") return properties.sessionID
  for (const key of ["info", "part"] as const) {
    if (!(key in properties)) continue
    const value = properties[key]
    if (typeof value === "object" && value !== null && "sessionID" in value && typeof value.sessionID === "string") {
      return value.sessionID
    }
  }
}

function activeSessionId(api: TuiPluginApi) {
  const route = api.route.current
  return route.name === "session" ? route.params.sessionID : undefined
}

function statusState(status: unknown): AgentState | undefined {
  const type = typeof status === "string"
    ? status
    : typeof status === "object" && status !== null && "type" in status
      ? status.type
      : undefined
  if (type === "idle") return "idle"
  if (type === "busy" || type === "retry") return "working"
}

export function attachHerdrLifecycle(api: TuiPluginApi, reporter: Reporter) {
  const report = (state: AgentState) => (event: Event) => {
    if (eventSessionId(event) !== activeSessionId(api)) return
    void reporter.reportState(state)
  }
  const reportStatus = (event: Event) => {
    if (eventSessionId(event) !== activeSessionId(api)) return
    const properties = event.properties as { status?: { type?: unknown } | string }
    const state = statusState(properties.status)
    if (state !== undefined) void reporter.reportState(state)
  }
  const reportSession = (event: Event) => {
    const properties = event.properties as { info?: { id?: unknown; title?: unknown } } | undefined
    if (properties?.info?.id !== activeSessionId(api) || typeof properties.info.title !== "string") return
    void reporter.reportTitle(properties.info.title)
  }

  const unsubscribe = [
    api.event.on("session.status", reportStatus),
    api.event.on("session.idle", report("idle")),
    api.event.on("tool.execute.before", report("working")),
    api.event.on("tool.execute.after", report("working")),
    api.event.on("session.compacted", report("working")),
    api.event.on("permission.asked", report("blocked")),
    api.event.on("question.asked", report("blocked")),
    api.event.on("session.error", report("blocked")),
    api.event.on("permission.replied", report("working")),
    api.event.on("question.replied", report("working")),
    api.event.on("question.rejected", report("working")),
    api.event.on("session.created", reportSession),
    api.event.on("session.updated", reportSession),
  ]

  const sessionID = activeSessionId(api)
  if (typeof sessionID === "string") {
    const session = api.state.session.get(sessionID)
    if (typeof session?.title === "string") void reporter.reportTitle(session.title)
    const state = statusState(api.state.session.status(sessionID))
    if (state !== undefined) void reporter.reportState(state)
  }

  return () => {
    for (const stop of unsubscribe) stop()
  }
}
