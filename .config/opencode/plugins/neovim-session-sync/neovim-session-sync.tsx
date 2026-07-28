/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import net from "node:net"
import { createEffect } from "solid-js"

const id = "neovim-session-sync"
const herdr_source = "user:opencode-session-title"
const herdr_agent = "opencode"
const herdr_lifecycle_source = "herdr:opencode"
let herdr_report_seq = Date.now() * 1000

function report_herdr_session_title(title: string | null) {
  const pane_id = process.env.OPENCODE_NVIM_HERDR_PANE_ID ?? process.env.HERDR_PANE_ID
  const socket_path = process.env.HERDR_SOCKET_PATH
  if (
    process.env.HERDR_ENV !== "1" ||
    typeof pane_id !== "string" ||
    typeof socket_path !== "string"
  ) {
    return
  }

  herdr_report_seq += 1
  const request = {
    id: `${herdr_source}:${herdr_report_seq}`,
    method: "pane.report_metadata",
    params: {
      pane_id,
      source: herdr_source,
      agent: herdr_agent,
      applies_to_source: herdr_lifecycle_source,
      seq: herdr_report_seq,
      tokens: { opencode_session_title: title },
    },
  }

  const client = net.createConnection(socket_path, () => {
    client.write(`${JSON.stringify(request)}\n`)
  })
  const finish = () => client.destroy()
  client.setTimeout(500, finish)
  client.on("data", finish)
  client.on("error", finish)
  client.on("end", finish)
}

function SessionSync(props: { api: TuiPluginApi }) {
  let last_session_id: string | undefined
  let last_herdr_title: string | null | undefined
  const socket = process.env.OPENCODE_NVIM_SOCKET

  createEffect(() => {
    const route = props.api.route.current
    const session_id = route.name === "session" ? route.params.sessionID : undefined
    const session = session_id === undefined ? undefined : props.api.state.session.get(session_id)
    const title = session_id === undefined ? null : typeof session?.title === "string" ? session.title : undefined
    if (title !== undefined && title !== last_herdr_title) {
      last_herdr_title = title
      report_herdr_session_title(title)
    }

    if (socket === undefined || session_id === undefined || session_id === last_session_id) return

    last_session_id = session_id
    const expression = `luaeval("require('utils.session').set_opencode_session_id(_A)", ${JSON.stringify(session_id)})`
    Bun.spawn(["nvim", "--server", socket, "--remote-expr", expression], {
      stderr: "ignore",
      stdout: "ignore",
    })
  })

  return <box />
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  api.slots.register({
    slots: {
      app() {
        return <SessionSync api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
