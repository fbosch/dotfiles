/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect } from "solid-js"

const id = "neovim-session-sync"

function SessionSync(props: { api: TuiPluginApi }) {
  let last_session_id: string | undefined
  const socket = process.env.OPENCODE_NVIM_SOCKET

  createEffect(() => {
    const route = props.api.route.current
    const session_id = route.name === "session" ? route.params.sessionID : undefined
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
