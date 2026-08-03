/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import net from "node:net"
import path from "node:path"
import { createEffect } from "solid-js"
import {
  makePatchHeadersClickable,
  restorePatchHeaders,
  type PatchedHeader,
  type PatchHeaderRenderable,
} from "./clickable-patch-headers"

const id = "neovim-session-sync"
const herdr_source = "user:opencode-session-title"
const herdr_agent = "opencode"
const herdr_lifecycle_source = "herdr:opencode"
let herdr_report_seq = Date.now() * 1000

function workspaceFile(directory: string, file: string) {
  const absolute = path.resolve(directory, file)
  const relative = path.relative(directory, absolute)
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return
  return absolute
}

async function revealInNeovim(socket: string, file: string, line: number) {
  try {
    const args = JSON.stringify([file, line])
    const expression = `luaeval("require('utils.opencode').open_file(_A[1], _A[2])", ${args})`
    const process = Bun.spawn(["nvim", "--server", socket, "--remote-expr", expression], {
      stderr: "ignore",
      stdout: "pipe",
    })
    const [code, output] = await Promise.all([process.exited, new Response(process.stdout).text()])
    return code === 0 && output.trim() === "true"
  } catch {
    return false
  }
}

function useClickablePatchHeaders(api: TuiPluginApi) {
  const socket = process.env.OPENCODE_NVIM_SOCKET
  if (socket === undefined) return { refresh() {} }

  const pluginApi = api as TuiPluginApi & {
    renderer: {
      root: PatchHeaderRenderable
      getSelection(): { getSelectedText(): string } | null
    }
    lifecycle: { onDispose(cleanup: () => void): void }
    ui: { toast(input: { variant: "error"; message: string }): void }
  }
  const renderer = pluginApi.renderer
  const patched = new Map<PatchHeaderRenderable, PatchedHeader>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const refresh = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      makePatchHeadersClickable(renderer.root, api.theme.current.primary, patched, (file, line, event) => {
        if (renderer.getSelection()?.getSelectedText()) return
        const statePath = api.state.path as typeof api.state.path & { worktree: string }
        const root = statePath.worktree === "/" ? statePath.directory : statePath.worktree
        const absolute = workspaceFile(root, file)
        if (absolute === undefined) return

        event.stopPropagation()
        void revealInNeovim(socket, absolute, line).then((opened) => {
          if (opened) return
          pluginApi.ui.toast({ variant: "error", message: `Could not open ${file} in Neovim` })
        })
      })
    }, 80)
  }

  const unsubscribe = [
    api.event.on("message.updated", refresh),
    api.event.on("message.part.updated", refresh),
    api.event.on("session.updated", refresh),
  ]
  pluginApi.lifecycle.onDispose(() => {
    if (timer !== undefined) clearTimeout(timer)
    for (const stop of unsubscribe) stop()
    restorePatchHeaders(patched)
  })
  refresh()
  return { refresh }
}

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

function SessionSync(props: { api: TuiPluginApi; refreshPatchHeaders: () => void }) {
  let last_session_id: string | undefined
  let last_herdr_title: string | null | undefined
  const socket = process.env.OPENCODE_NVIM_SOCKET

  createEffect(() => {
    const route = props.api.route.current
    props.refreshPatchHeaders()
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
  const patchHeaders = useClickablePatchHeaders(api)
  api.slots.register({
    slots: {
      app() {
        return <SessionSync api={api} refreshPatchHeaders={patchHeaders.refresh} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
