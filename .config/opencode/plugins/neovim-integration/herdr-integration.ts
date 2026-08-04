import net from "node:net"

export type AgentState = "idle" | "working" | "blocked"

type HerdrMethod = "pane.report_agent" | "pane.report_metadata" | "pane.release_agent"

const source = "custom:neovim-opencode"
const titleSource = "user:neovim-opencode-title"
const legacyAgentSource = "user:neovim-opencode-agent"
const legacyTitleSource = "user:opencode-session-title"
const agent = "opencode"

export class HerdrIntegration {
  readonly #paneId: string
  readonly #socketPath: string
  #sequence = Date.now() * 1000
  #requestChain = Promise.resolve()
  #lastState: AgentState | undefined
  #lastTitle: string | null | undefined

  static fromEnvironment() {
    const paneId = process.env.OPENCODE_NVIM_HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) return
    return new HerdrIntegration(paneId, socketPath)
  }

  private constructor(paneId: string, socketPath: string) {
    this.#paneId = paneId
    this.#socketPath = socketPath
  }

  initialize() {
    return this.#request("pane.report_metadata", { tokens: { opencode_session_title: null } }, legacyTitleSource)
      .then(() => this.#request("pane.report_metadata", { tokens: { opencode_session_title: null } }, legacyAgentSource))
      .then(() => this.#request("pane.report_metadata", { tokens: { opencode_session_title: null } }, titleSource))
      .then(() => this.reportState("idle"))
  }

  shutdown() {
    return this.reportTitle(null).then(() => this.#request("pane.release_agent"))
  }

  reportState(state: AgentState) {
    if (state === this.#lastState) return Promise.resolve()
    this.#lastState = state
    return this.#request("pane.report_agent", { state })
  }

  reportTitle(title: string | null) {
    if (title === this.#lastTitle) return Promise.resolve()
    this.#lastTitle = title
    return this.#request(
      "pane.report_metadata",
      { applies_to_source: source, tokens: { opencode_session_title: title } },
      titleSource,
    )
  }

  #request(method: HerdrMethod, params: Record<string, unknown> = {}, requestSource = source) {
    const pending = this.#requestChain.then(() => this.#requestOnce(method, params, requestSource))
    this.#requestChain = pending.catch(() => {})
    return pending
  }

  #requestOnce(method: HerdrMethod, params: Record<string, unknown>, requestSource: string) {
    this.#sequence += 1
    const request = {
      id: `${requestSource}:${this.#sequence}`,
      method,
      params: { pane_id: this.#paneId, source: requestSource, agent, seq: this.#sequence, ...params },
    }

    return new Promise<void>((resolve) => {
      const client = net.createConnection(this.#socketPath, () => client.write(`${JSON.stringify(request)}\n`))
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
