/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { JSX } from "solid-js"
import { createMemo, createSignal } from "solid-js"
import { readProfileState, watchProfileState } from "../openai-account-selector/profile-state"
import { promptStatusLabel } from "./status-label"

type ThemeMap = Record<string, unknown>

const id = "current-port"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false
}

function portFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.port || (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : undefined)
  } catch {
    return undefined
  }
}

function normalizePort(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return String(value)
  }

  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  if (/^[1-9][0-9]*$/.test(trimmed)) {
    return trimmed
  }

  return portFromUrl(trimmed)
}

function configuredPort(api: TuiPluginApi): string | undefined {
  const state = api.state as unknown
  const config = isRecord(state) ? state.config : undefined
  if (!isRecord(config) || !isRecord(config.server)) {
    return undefined
  }

  return normalizePort(config.server.port)
}

function clientBaseUrl(api: TuiPluginApi): string | undefined {
  const client = api.client as unknown
  if (!isRecord(client) || !isRecord(client.client) || typeof client.client.getConfig !== "function") {
    return undefined
  }

  const config = client.client.getConfig() as unknown
  if (!isRecord(config) || typeof config.baseUrl !== "string") {
    return undefined
  }

  return config.baseUrl
}

function currentServerUrl(api: TuiPluginApi): string | undefined {
  if (process.env.OPENCODE_SERVER_PORT) return `http://127.0.0.1:${process.env.OPENCODE_SERVER_PORT}`
  if (process.env.OPENCODE_SERVER_URL) return process.env.OPENCODE_SERVER_URL
  if (process.env.OPENCODE_PORT) return `http://127.0.0.1:${process.env.OPENCODE_PORT}`
  return clientBaseUrl(api)
}

function currentPortLabel(api: TuiPluginApi): string {
  const serverUrl = currentServerUrl(api)
  const port = normalizePort(serverUrl) ?? configuredPort(api)

  if (port) {
    return `:${port}`
  }

  if (serverUrl?.includes("opencode.internal")) {
    return ":internal"
  }

  return ""
}

function themeColor(theme: ThemeMap, key: string, fallback: string): unknown {
  return theme[key] ?? fallback
}

function CurrentPort(props: { api: TuiPluginApi; profile: () => string | undefined }): JSX.Element {
  const label = createMemo(() => promptStatusLabel(currentPortLabel(props.api), props.profile()))
  const theme = createMemo(() => props.api.theme.current as ThemeMap)

  return (
    <box paddingRight={1}>
      <text fg={themeColor(theme(), "textMuted", "#808080")} wrapMode="none">
        {label()}
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const serverUrl = currentServerUrl(api)
  const directory = api.state.path.directory
  const [profile, setProfile] = createSignal<string | undefined>(undefined)
  let refreshGeneration = 0
  const refreshProfile = async () => {
    const generation = ++refreshGeneration
    const next = serverUrl ? (await readProfileState(directory, serverUrl))?.profile : undefined
    if (generation === refreshGeneration) setProfile(next)
  }
  const stopWatching = serverUrl
    ? await watchProfileState(directory, serverUrl, () => void refreshProfile()).catch(() => undefined)
    : undefined
  await refreshProfile()
  const lifecycle = api as unknown as { lifecycle?: { onDispose(cleanup: () => void): void } }
  lifecycle.lifecycle?.onDispose(() => stopWatching?.())
  api.slots.register({
    slots: {
      home_prompt_right() {
        return <CurrentPort api={api} profile={profile} />
      },
      session_prompt_right() {
        return <CurrentPort api={api} profile={profile} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
