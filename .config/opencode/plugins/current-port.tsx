/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { JSX } from "solid-js"
import { createMemo } from "solid-js"

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

function currentPortLabel(api: TuiPluginApi): string {
  const baseUrl = clientBaseUrl(api)
  const port =
    normalizePort(process.env.OPENCODE_SERVER_PORT) ??
    normalizePort(process.env.OPENCODE_SERVER_URL) ??
    normalizePort(process.env.OPENCODE_PORT) ??
    normalizePort(baseUrl) ??
    configuredPort(api)

  if (port) {
    return `port ${port}`
  }

  if (baseUrl?.includes("opencode.internal")) {
    return "port internal"
  }

  return "port ?"
}

function themeColor(theme: ThemeMap, key: string, fallback: string): unknown {
  return theme[key] ?? fallback
}

function CurrentPort(props: { api: TuiPluginApi }): JSX.Element {
  const label = createMemo(() => currentPortLabel(props.api))
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
  api.slots.register({
    slots: {
      home_prompt_right() {
        return <CurrentPort api={api} />
      },
      session_prompt_right() {
        return <CurrentPort api={api} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
