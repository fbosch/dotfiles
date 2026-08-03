import net from "node:net"

type AgentState = "idle" | "working" | "blocked"
type HerdrMethod = "pane.report_agent" | "pane.report_metadata" | "pane.release_agent"
type OpenCodeEvent = { type: string; properties?: unknown }

const neovimAgentSource = "user:neovim-opencode-agent"
const sessionTitleSource = "user:opencode-session-title"
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
  readonly #sequences = new Map<string, number>()
  #requestChain = Promise.resolve()

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

  hooks() {
    return {
      "chat.message": ({ sessionID }: { sessionID?: string }) => this.#onChatMessage(sessionID),
      event: ({ event }: { event: OpenCodeEvent }) => this.#onEvent(event),
    }
  }

  #onChatMessage(sessionId: string | undefined) {
    if (sessionId && this.#childSessions.has(sessionId)) return Promise.resolve()
    return this.#report("working")
  }

  async #onEvent(event: OpenCodeEvent) {
    const properties = typeof event.properties === "object" && event.properties !== null
      ? event.properties as Record<string, unknown>
      : {}
    const id = sessionId(properties)
    const info = properties.info
    if (typeof info === "object" && info !== null && "id" in info && "parentID" in info) {
      if (typeof info.id === "string" && info.parentID) this.#childSessions.add(info.id)
    }

    if (id && this.#childSessions.has(id)) {
      if (event.type === "permission.asked" || event.type === "question.asked") await this.#report("blocked")
      if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
        await this.#report("working")
      }
      return
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      if (typeof info === "object" && info !== null && "title" in info && typeof info.title === "string") {
        await this.#reportTitle(info.title)
      }
      return
    }

    if (event.type === "session.status") {
      const state = stateFromStatus(properties.status)
      if (state) await this.#report(state)
      return
    }
    if (["permission.asked", "question.asked", "session.error"].includes(event.type)) {
      await this.#report("blocked")
      return
    }
    if (event.type === "session.idle") {
      await this.#report("idle")
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
      await this.#report("working")
    }
  }

  #report(state: AgentState) {
    return this.#request("pane.report_agent", { state })
  }

  #reportTitle(title: string) {
    return this.#request(
      "pane.report_metadata",
      { applies_to_source: neovimAgentSource, tokens: { opencode_session_title: title } },
      sessionTitleSource,
    )
  }

  #request(method: HerdrMethod, params: Record<string, unknown> = {}, reportSource = neovimAgentSource) {
    const pending = this.#requestChain.then(() => this.#requestOnce(method, params, reportSource))
    this.#requestChain = pending.catch(() => {})
    return pending
  }

  #requestOnce(method: HerdrMethod, params: Record<string, unknown>, reportSource: string) {
    const sequence = (this.#sequences.get(reportSource) ?? Date.now() * 1000) + 1
    this.#sequences.set(reportSource, sequence)
    const payload = JSON.stringify({
      id: `${reportSource}:${sequence}`,
      method,
      params: { pane_id: this.#paneId, source: reportSource, agent, seq: sequence, ...params },
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
