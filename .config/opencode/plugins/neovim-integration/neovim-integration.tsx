/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createEffect } from "solid-js"
import { HerdrIntegration } from "./herdr-integration"
import { attachHerdrLifecycle } from "./herdr-lifecycle"
import { NeovimClient } from "./neovim-client"
import { enablePatchNavigation } from "./patch-navigation"

const id = "neovim-integration"

function SessionSync(props: {
  api: TuiPluginApi
  neovim?: NeovimClient
  herdr?: HerdrIntegration
}) {
  let last_session_id: string | undefined
  createEffect(() => {
    const route = props.api.route.current
    const session_id = route.name === "session" ? route.params.sessionID : undefined
    const session = session_id === undefined ? undefined : props.api.state.session.get(session_id)
    const title = session_id === undefined ? null : typeof session?.title === "string" ? session.title : undefined
    if (title !== undefined) void props.herdr?.reportTitle(title)

    if (session_id === undefined || session_id === last_session_id) return

    last_session_id = session_id
    void props.herdr?.reportState("idle")
    props.neovim?.setSessionId(session_id)
  })

  return <box />
}

async function enableHerdrLifecycle(api: TuiPluginApi, herdr: HerdrIntegration) {
  await herdr.initialize()
  const unsubscribe = attachHerdrLifecycle(api, herdr)
  const pluginApi = api as TuiPluginApi & { lifecycle: { onDispose(cleanup: () => void): void } }
  pluginApi.lifecycle.onDispose(() => {
    unsubscribe()
    void herdr.shutdown()
  })
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const neovim = NeovimClient.fromEnvironment()
  const herdr = HerdrIntegration.fromEnvironment()
  if (neovim !== undefined) enablePatchNavigation(api, neovim)
  if (herdr !== undefined) await enableHerdrLifecycle(api, herdr)
  api.slots.register({
    slots: {
      app() {
        return <SessionSync api={api} neovim={neovim} herdr={herdr} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
