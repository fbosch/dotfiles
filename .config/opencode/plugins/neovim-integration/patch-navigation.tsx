/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import path from "node:path"
import { createEffect } from "solid-js"
import type { NeovimClient } from "./neovim-client"
import {
  makePatchHeadersClickable,
  restorePatchHeaders,
  type PatchedHeader,
  type PatchHeaderRenderable,
} from "./patch-navigation-core"

type PatchNavigationApi = TuiPluginApi & {
  renderer: {
    root: PatchHeaderRenderable
    getSelection(): { getSelectedText(): string } | null
  }
  lifecycle: { onDispose(cleanup: () => void): void }
  ui: { toast(input: { variant: "error"; message: string }): void }
}

function workspaceFile(directory: string, file: string) {
  const absolute = path.resolve(directory, file)
  const relative = path.relative(directory, absolute)
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return
  return absolute
}

function RouteSync(props: { api: TuiPluginApi; refresh: () => void }) {
  createEffect(() => {
    const route = props.api.route.current
    if (route.name === "session") props.api.state.session.messages(route.params.sessionID)
    props.refresh()
  })
  return <box />
}

export function enablePatchNavigation(api: TuiPluginApi, neovim: NeovimClient) {
  const pluginApi = api as PatchNavigationApi
  const patched = new Map<PatchHeaderRenderable, PatchedHeader>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const refresh = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      makePatchHeadersClickable(pluginApi.renderer.root, api.theme.current.primary, patched, (file, line, event) => {
        if (pluginApi.renderer.getSelection()?.getSelectedText()) return
        const statePath = api.state.path as typeof api.state.path & { worktree: string }
        const root = statePath.worktree === "/" ? statePath.directory : statePath.worktree
        const absolute = workspaceFile(root, file)
        if (absolute === undefined) return

        event.stopPropagation()
        void neovim.revealFile(absolute, line).then((opened) => {
          if (opened) return
          pluginApi.ui.toast({ variant: "error", message: `Could not open ${file} in Neovim` })
        })
      })
    }, 80)
  }

  const unsubscribe = [
    api.event.on("message.updated", refresh),
    api.event.on("message.part.updated", refresh),
    api.event.on("session.compacted", refresh),
    api.event.on("session.idle", refresh),
    api.event.on("session.updated", refresh),
  ]
  refresh()
  api.slots.register({
    slots: {
      app() {
        return <RouteSync api={api} refresh={refresh} />
      },
    },
  })
  pluginApi.lifecycle.onDispose(() => {
    if (timer !== undefined) clearTimeout(timer)
    for (const stop of unsubscribe) stop()
    restorePatchHeaders(patched)
  })
}
