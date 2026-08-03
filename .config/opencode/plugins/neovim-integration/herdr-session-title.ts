import net from "node:net"

const source = "user:opencode-session-title"
const agent = "opencode"
const lifecycleSource = "user:neovim-opencode-agent"

export class HerdrSessionTitleReporter {
  readonly #paneId: string
  readonly #socketPath: string
  #sequence = Date.now() * 1000

  static fromEnvironment() {
    const paneId = process.env.OPENCODE_NVIM_HERDR_PANE_ID ?? process.env.HERDR_PANE_ID
    const socketPath = process.env.HERDR_SOCKET_PATH
    if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) return
    return new HerdrSessionTitleReporter(paneId, socketPath)
  }

  constructor(paneId: string, socketPath: string) {
    this.#paneId = paneId
    this.#socketPath = socketPath
  }

  report(title: string | null) {
    this.#sequence += 1
    const request = {
      id: `${source}:${this.#sequence}`,
      method: "pane.report_metadata",
      params: {
        pane_id: this.#paneId,
        source,
        agent,
        applies_to_source: lifecycleSource,
        seq: this.#sequence,
        tokens: { opencode_session_title: title },
      },
    }

    const client = net.createConnection(this.#socketPath, () => client.write(`${JSON.stringify(request)}\n`))
    const finish = () => client.destroy()
    client.setTimeout(500, finish)
    client.on("data", finish)
    client.on("error", finish)
    client.on("end", finish)
  }
}
