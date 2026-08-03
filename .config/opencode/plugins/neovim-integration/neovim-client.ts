export class NeovimClient {
  readonly #socket: string

  static fromEnvironment() {
    const socket = process.env.OPENCODE_NVIM_SOCKET
    return socket === undefined ? undefined : new NeovimClient(socket)
  }

  constructor(socket: string) {
    this.#socket = socket
  }

  setSessionId(sessionId: string) {
    const expression = `luaeval("require('utils.session').set_opencode_session_id(_A)", ${JSON.stringify(sessionId)})`
    Bun.spawn(["nvim", "--server", this.#socket, "--remote-expr", expression], {
      stderr: "ignore",
      stdout: "ignore",
    })
  }

  async revealFile(file: string, line: number) {
    try {
      const args = JSON.stringify([file, line])
      const expression = `luaeval("require('utils.opencode').open_file(_A[1], _A[2])", ${args})`
      const process = Bun.spawn(["nvim", "--server", this.#socket, "--remote-expr", expression], {
        stderr: "ignore",
        stdout: "pipe",
      })
      const [code, output] = await Promise.all([process.exited, new Response(process.stdout).text()])
      return code === 0 && output.trim() === "true"
    } catch {
      return false
    }
  }
}
