/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect } from "solid-js"
import { NeovimClient } from "./neovim-client"
import { enablePatchNavigation } from "./patch-navigation"

const id = "neovim-integration"

function SessionSync(props: {
  api: TuiPluginApi
  neovim?: NeovimClient
}) {
  let last_session_id: string | undefined
  createEffect(() => {
    const route = props.api.route.current
    const session_id = route.name === "session" ? route.params.sessionID : undefined
    if (props.neovim === undefined || session_id === undefined || session_id === last_session_id) return

    last_session_id = session_id
    props.neovim.setSessionId(session_id)
  })

  return <box />
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const neovim = NeovimClient.fromEnvironment()
  if (neovim !== undefined) enablePatchNavigation(api, neovim)
  api.slots.register({
    slots: {
      app() {
        return <SessionSync api={api} neovim={neovim} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
