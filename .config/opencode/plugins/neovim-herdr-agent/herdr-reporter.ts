import net from "node:net"

type AgentState = "idle" | "working" | "blocked"
type HerdrMethod = "pane.report_agent" | "pane.report_agent_session" | "pane.release_agent"
type OpenCodeEvent = { type: string; properties?: unknown }

const source = "herdr:opencode"
const agent = "opencode"

function sessionId(properties: Record<string, unknown>) {
  return typeof properties.sessionID === "string" && properties.sessionID !== ""
    ? properties.sessionID
    : undefined
}

function stateFromStatus(status: unknown): AgentState | undefined {
  const kind = typeof status === "string"
    ? status
    : typeof status === "object" && status !== null && "type" in status
      ? status.type
      : undefined
  if (typeof kind !== "string") return
  if (kind.toLowerCase() === "idle") return "idle"
  if (["active", "busy", "pending", "running", "streaming", "working", "retry"].includes(kind.toLowerCase())) {
    return "working"
  }
}

export class HerdrReporter {
  readonly #paneId: string
  readonly #socketPath: string
  readonly #childSessions = new Set<string>()
  #sequence = Date.now() * 1000
  #requestChain = Promise.resolve()
  #reportedRootSessionId: string | undefined

  static async startFromEnvironment() {
    const paneId = process.env.OPENCODE_NVIM_HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) return
    const reporter = new HerdrReporter(paneId, socketPath)
    await reporter.#request("pane.release_agent")
    return reporter
  }

  private constructor(paneId: string, socketPath: string) {
    this.#paneId = paneId
    this.#socketPath = socketPath
  }

  onChatMessage(sessionId: string | undefined) {
    if (sessionId && this.#childSessions.has(sessionId)) return Promise.resolve()
    return this.#reportState("working", sessionId)
  }

  async onEvent(event: OpenCodeEvent) {
    const properties = typeof event.properties === "object" && event.properties !== null
      ? event.properties as Record<string, unknown>
      : {}
    const id = sessionId(properties)
    const info = properties.info
    if (typeof info === "object" && info !== null && "id" in info && "parentID" in info) {
      if (typeof info.id === "string" && info.parentID) this.#childSessions.add(info.id)
    }

    if (id && this.#childSessions.has(id)) {
      if (event.type === "permission.asked" || event.type === "question.asked") await this.#reportState("blocked")
      if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
        await this.#reportState("working")
      }
      return
    }

    if (event.type === "session.status") {
      const state = stateFromStatus(properties.status)
      if (state) await this.#reportState(state, id)
      else await this.#reportSession(id)
      return
    }
    if (event.type === "session.created") {
      await this.#reportSession(id, "new")
      return
    }
    if (event.type === "session.updated") {
      if (id && id !== this.#reportedRootSessionId) await this.#reportSession(id)
      return
    }
    if (["permission.asked", "question.asked", "session.error"].includes(event.type)) {
      await this.#reportState("blocked", id)
      return
    }
    if (event.type === "session.idle") {
      await this.#reportState("idle", id)
      return
    }
    if (
      [
        "tool.execute.before",
        "tool.execute.after",
        "permission.replied",
        "question.replied",
        "question.rejected",
        "session.compacted",
      ].includes(event.type)
    ) {
      await this.#reportState("working", id)
    }
  }

  #reportSession(sessionId: string | undefined, sessionStartSource?: "new") {
    if (!sessionId) return Promise.resolve()
    const params: Record<string, unknown> = { agent_session_id: sessionId }
    if (sessionStartSource) params.session_start_source = sessionStartSource
    return this.#request("pane.report_agent_session", params)
  }

  #reportState(state: AgentState, sessionId?: string) {
    const params: Record<string, unknown> = { state }
    if (sessionId) {
      this.#reportedRootSessionId = sessionId
      params.agent_session_id = sessionId
    }
    return this.#request("pane.report_agent", params)
  }

  #request(method: HerdrMethod, params: Record<string, unknown> = {}) {
    const pending = this.#requestChain.then(() => this.#requestOnce(method, params))
    this.#requestChain = pending.catch(() => {})
    return pending
  }

  #requestOnce(method: HerdrMethod, params: Record<string, unknown>) {
    this.#sequence += 1
    const payload = JSON.stringify({
      id: `${source}:${this.#sequence}`,
      method,
      params: { pane_id: this.#paneId, source, agent, seq: this.#sequence, ...params },
    })

    return new Promise<void>((resolve) => {
      const client = net.createConnection(this.#socketPath, () => client.write(`${payload}\n`))
      const finish = () => {
        client.destroy()
        resolve()
      }
      client.setTimeout(500, finish)
      client.on("data", finish)
      client.on("error", finish)
      client.on("end", finish)
      client.on("close", resolve)
    })
  }
}
