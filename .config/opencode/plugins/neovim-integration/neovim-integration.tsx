/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect } from "solid-js"
import { HerdrSessionTitleReporter } from "./herdr-session-title"
import { NeovimClient } from "./neovim-client"
import { enablePatchNavigation } from "./patch-navigation"

const id = "neovim-integration"

function SessionSync(props: {
  api: TuiPluginApi
  neovim?: NeovimClient
  titleReporter?: HerdrSessionTitleReporter
}) {
  let last_session_id: string | undefined
  let last_herdr_title: string | null | undefined
  createEffect(() => {
    const route = props.api.route.current
    const session_id = route.name === "session" ? route.params.sessionID : undefined
    const session = session_id === undefined ? undefined : props.api.state.session.get(session_id)
    const title = session_id === undefined ? null : typeof session?.title === "string" ? session.title : undefined
    if (title !== undefined && title !== last_herdr_title) {
      last_herdr_title = title
      props.titleReporter?.report(title)
    }

    if (props.neovim === undefined || session_id === undefined || session_id === last_session_id) return

    last_session_id = session_id
    props.neovim.setSessionId(session_id)
  })

  return <box />
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const neovim = NeovimClient.fromEnvironment()
  const titleReporter = HerdrSessionTitleReporter.fromEnvironment()
  if (neovim !== undefined) enablePatchNavigation(api, neovim)
  api.slots.register({
    slots: {
      app() {
        return (
          <SessionSync
            api={api}
            neovim={neovim}
            titleReporter={titleReporter}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
