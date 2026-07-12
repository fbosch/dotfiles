/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import { contextHealth } from "./context-health"
import { appendDelimiterAndCorrect, parseTypoRules, typoRuleLengths } from "./typo-engine"

declare const Bun: {
  file(path: string): {
    text(): Promise<string>
  }
}

declare const process: {
  env: {
    HOME?: string
    XDG_CONFIG_HOME?: string
  }
}

type ThemeColor = string | RGBA
type ThemeMap = Record<string, unknown>

const typoDelimiters = [
  { key: "space", name: "space", value: " ", description: "Insert space and fix prompt typo" },
  { key: ".", name: "period", value: "." },
  { key: ",", name: "comma", value: "," },
  { key: "!", name: "exclamation", value: "!" },
  { key: "?", name: "question", value: "?" },
  { key: ":", name: "colon", value: ":" },
  { key: ";", name: "semicolon", value: ";" },
] as const

type PromptInfo = {
  input: string
  mode?: "normal" | "shell"
  parts: unknown[]
}

type PromptRef = {
  focused: boolean
  current: PromptInfo
  set(prompt: PromptInfo): void
}

type AssistantTokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

type AssistantMessage = {
  role: string
  summary?: boolean
  cost?: number
  providerID?: string
  modelID?: string
  tokens?: AssistantTokens
}

type ProviderModel = {
  limit?: {
    context?: number
  }
}

type ProviderInfo = {
  id: string
  models?: Record<string, ProviderModel>
}

type PromptComponent = (props: {
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
  ref?: (ref: PromptRef | undefined) => void
  right?: JSX.Element
  showPlaceholder?: boolean
  placeholders?: {
    normal?: string[]
    shell?: string[]
  }
}) => JSX.Element

type SlotComponent = (
  props: {
    name: string
    mode?: unknown
    children?: JSX.Element
  } & Record<string, unknown>,
) => JSX.Element | null

const id = "prompt-enhancements"
const PROMPT_COMMAND_HINT_WIDTH = 17

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const fullNumber = new Intl.NumberFormat("en-US")

const usageColors = {
  green: "#98c379",
  yellow: "#e5c07b",
  red: "#e06c75",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false
}

function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" || isRecord(value)
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined
  }

  return value
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function asSubmitHandler(value: unknown): (() => void) | undefined {
  return typeof value === "function" ? (value as () => void) : undefined
}

function asPromptRefHandler(value: unknown): ((ref: PromptRef | undefined) => void) | undefined {
  return typeof value === "function" ? (value as (ref: PromptRef | undefined) => void) : undefined
}

function typoRulesPath(): string {
  return `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ""}/.config`}/fbb/data/typos.abolish`
}

async function loadTypoRules(): Promise<Map<string, string>> {
  try {
    return parseTypoRules(await Bun.file(typoRulesPath()).text())
  } catch {
    return new Map<string, string>()
  }
}

function insertDelimiterAndCorrect(
  ref: PromptRef,
  delimiter: string,
  rules: ReadonlyMap<string, string>,
  ruleLengths: ReadonlySet<number>,
) {
  const current = ref.current
  ref.set({ ...current, input: appendDelimiterAndCorrect(current.input, delimiter, rules, ruleLengths) })
}

function PromptWithEnhancements(
  props: Parameters<PromptComponent>[0] & {
    Prompt: PromptComponent
    onPromptRef?: (ref: PromptRef | undefined) => void
  },
): JSX.Element {
  const Prompt = props.Prompt
  let currentRef: PromptRef | undefined

  const setRef = (ref: PromptRef | undefined) => {
    if (ref !== currentRef) {
      currentRef = ref
      props.onPromptRef?.(ref)
    }

    props.ref?.(ref)
  }

  return (
    <Prompt
      sessionID={props.sessionID}
      visible={props.visible}
      disabled={props.disabled}
      onSubmit={props.onSubmit}
      ref={setRef}
      right={props.right}
      showPlaceholder={props.showPlaceholder}
      placeholders={props.placeholders}
    />
  )
}

function resolveColor(theme: ThemeMap, name: string, fallback: ThemeColor): ThemeColor {
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(name)) {
    return RGBA.fromHex(name)
  }

  if (/^(rgb\(|rgba\(|hsl\(|hsla\()/i.test(name)) {
    return name
  }

  const value = theme[name]
  if (isThemeColor(value)) {
    return value
  }

  return fallback
}

function promptBackground(theme: ThemeMap): ThemeColor {
  const background = theme.background
  if (isThemeColor(background)) {
    return background
  }

  return resolveColor(theme, "backgroundPanel", "#111111")
}

function textMuted(theme: ThemeMap): ThemeColor {
  return resolveColor(theme, "textMuted", "#808080")
}

function colorKey(color: ThemeColor): string {
  if (typeof color === "string") {
    return color
  }

  return `${color.r}:${color.g}:${color.b}:${color.a}`
}

function usageColor(
  theme: ThemeMap,
  usage: { used: number; contextLimit?: number } | undefined,
): ThemeColor {
  if (usage === undefined) {
    return textMuted(theme)
  }

  return resolveColor(theme, usageColors[contextHealth(usage.used, usage.contextLimit)], textMuted(theme))
}

function assistantFromRecord(row: Record<string, unknown>): AssistantMessage | undefined {
  if (row.role === "assistant") {
    return row as AssistantMessage
  }

  if (isRecord(row.info) && row.info.role === "assistant") {
    return row.info as AssistantMessage
  }

  return undefined
}

function toAssistantMessage(row: unknown): AssistantMessage | undefined {
  if (isRecord(row) === false) {
    return undefined
  }

  return assistantFromRecord(row)
}

function assistantMessagesFromRows(rows: ReadonlyArray<unknown> | undefined): AssistantMessage[] {
  if (Array.isArray(rows) === false) {
    return []
  }

  return rows.flatMap((row) => {
    const message = toAssistantMessage(row)
    return message ? [message] : []
  })
}

function messageModelRef(message: AssistantMessage): { providerID: string; modelID: string } | undefined {
  const providerID = asString(message.providerID)
  const modelID = asString(message.modelID)
  if (!providerID) {
    return undefined
  }

  if (!modelID) {
    return undefined
  }

  return { providerID, modelID }
}

function contextLimit(api: TuiPluginApi, message: AssistantMessage): number | undefined {
  const modelRef = messageModelRef(message)
  if (modelRef === undefined) {
    return undefined
  }

  const providers = Array.isArray(api.state.provider) ? api.state.provider : []
  const provider = providers.find((entry): entry is ProviderInfo => providerHasID(entry, modelRef.providerID))
  return asFiniteNumber(provider?.models?.[modelRef.modelID]?.limit?.context)
}

function providerHasID(entry: unknown, providerID: string): entry is ProviderInfo {
  if (isRecord(entry) === false) {
    return false
  }

  return entry.id === providerID
}

function totalTokens(tokens: AssistantTokens): number {
  return [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write]
    .reduce((total, value) => total + (value ?? 0), 0)
}

function hasTokenUsage(message: AssistantMessage | undefined): message is AssistantMessage & { tokens: AssistantTokens } {
  return message?.tokens !== undefined && totalTokens(message.tokens) > 0
}

function lastAssistantWithUsage(messages: AssistantMessage[]): AssistantMessage | undefined {
  return messages.findLast(hasTokenUsage)
}

function contextCompact(used: number, percent: number | undefined): string {
  if (percent === undefined) {
    return compactNumber.format(used)
  }

  return `${compactNumber.format(used)} (${percent}%)`
}

function usageFull(percent: number | undefined): string | undefined {
  if (percent === undefined) {
    return undefined
  }

  return `${percent}% used`
}

function usageTextFromAssistants(api: TuiPluginApi, assistants: AssistantMessage[]) {
  const last = lastAssistantWithUsage(assistants)

  if (last === undefined) {
    return undefined
  }

  const used = totalTokens(last.tokens)
  const limit = contextLimit(api, last)
  const percent = limit && limit > 0 ? Math.round((used / limit) * 100) : undefined
  return {
    used,
    contextLimit: limit,
    contextCompact: contextCompact(used, percent),
    tokensFull: `${fullNumber.format(used)} tokens`,
    usageFull: usageFull(percent),
    percent,
  }
}

function eventProperties(event: { properties?: unknown }): Record<string, unknown> {
  return isRecord(event.properties) ? event.properties : {}
}

function sessionIDFromRecord(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.sessionID === "string") {
    return value.sessionID
  }

  return undefined
}

function eventSessionID(properties: Record<string, unknown>): string | undefined {
  return sessionIDFromRecord(properties)
    ?? sessionIDFromRecord(properties.info)
    ?? sessionIDFromRecord(properties.part)
    ?? sessionIDFromRecord(properties.message)
}

function responseRows(response: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(response)) {
    return response
  }

  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }

  return []
}

function useUsage(props: { api: TuiPluginApi; sessionID: string }) {
  const [refresh, setRefresh] = createSignal(0)
  const [fetchedAssistants, setFetchedAssistants] = createSignal<AssistantMessage[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  let bootstrapTimer: ReturnType<typeof setTimeout> | undefined

  const fetchAssistants = async () => {
    if (!props.sessionID) {
      return
    }

    try {
      const response = await props.api.client.session.messages({
        sessionID: props.sessionID,
        limit: 100,
      })
      setFetchedAssistants(assistantMessagesFromRows(responseRows(response)))
      setRefresh((value) => value + 1)
    } catch {
      // Ignore initial fetch failures and fall back to synced state updates.
    }
  }

  const queueRefresh = (properties: Record<string, unknown>, shouldFetch: boolean) => {
    const sessionID = eventSessionID(properties)
    if (sessionID && sessionID !== props.sessionID) {
      return
    }

    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      setRefresh((value) => value + 1)
      if (shouldFetch) {
        void fetchAssistants()
      }
    }, 80)
  }

  const unsubscribers = [
    props.api.event.on("message.updated", (event) => queueRefresh(eventProperties(event), true)),
    props.api.event.on("message.removed", (event) => queueRefresh(eventProperties(event), true)),
    props.api.event.on("message.part.updated", (event) => queueRefresh(eventProperties(event), false)),
    props.api.event.on("session.compacted", (event) => queueRefresh(eventProperties(event), true)),
    props.api.event.on("session.idle", (event) => queueRefresh(eventProperties(event), true)),
    props.api.event.on("session.updated", (event) => queueRefresh(eventProperties(event), true)),
  ]

  let bootstrapAttempts = 0
  const maxBootstrapAttempts = 12
  const hasUsage = (assistants: AssistantMessage[]) => usageTextFromAssistants(props.api, assistants) !== undefined
  const needsInitialFetch = (syncedAssistants: AssistantMessage[]) => {
    if (syncedAssistants.length > 0) {
      return false
    }

    return fetchedAssistants().length === 0
  }
  const shouldStopBootstrap = (syncedAssistants: AssistantMessage[]) => {
    if (hasUsage(syncedAssistants)) {
      return true
    }

    if (hasUsage(fetchedAssistants())) {
      return true
    }

    return bootstrapAttempts >= maxBootstrapAttempts
  }
  const runBootstrapRefresh = () => {
    bootstrapAttempts += 1
    setRefresh((value) => value + 1)

    const syncedAssistants = assistantMessagesFromRows(props.api.state.session.messages(props.sessionID))
    if (needsInitialFetch(syncedAssistants)) {
      void fetchAssistants()
    }

    if (shouldStopBootstrap(syncedAssistants)) {
      return
    }

    bootstrapTimer = setTimeout(runBootstrapRefresh, 150)
  }

  runBootstrapRefresh()

  onCleanup(() => {
    if (timer) {
      clearTimeout(timer)
    }

    if (bootstrapTimer) {
      clearTimeout(bootstrapTimer)
    }

    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  })

  return createMemo(() => {
    refresh()
    const syncedAssistants = assistantMessagesFromRows(props.api.state.session.messages(props.sessionID))
    const syncedUsage = usageTextFromAssistants(props.api, syncedAssistants)
    if (syncedUsage) {
      return syncedUsage
    }

    return usageTextFromAssistants(props.api, fetchedAssistants())
  })
}

function sessionPromptProps(props: Record<string, unknown>) {
  return {
    sessionID: asString(props.session_id) ?? "",
    visible: asBoolean(props.visible),
    disabled: asBoolean(props.disabled),
    onSubmit: asSubmitHandler(props.on_submit),
    ref: asPromptRefHandler(props.ref),
  }
}

function promptRefProp(props: Record<string, unknown>): ((ref: PromptRef | undefined) => void) | undefined {
  return asPromptRefHandler(props.ref)
}

function TokenUsageOverlay(props: { api: TuiPluginApi; sessionID: string }): JSX.Element {
  const usage = useUsage(props)
  const theme = createMemo(() => props.api.theme.current as ThemeMap)
  const background = createMemo(() => promptBackground(theme()))
  const foreground = createMemo(() => usageColor(theme(), usage()))
  const info = createMemo(() => usage())

  return (
    <Show when={info()} keyed>
      {(current) => {
        const color = foreground()
        const key = colorKey(color)
        return (
    <box
      position="absolute"
      right={PROMPT_COMMAND_HINT_WIDTH}
      bottom={0}
      zIndex={50}
      height={1}
      backgroundColor={background()}
      paddingLeft={2}
      paddingRight={1}
      alignItems="center"
    >
      <box flexDirection="row">
        <text id={`token-usage-${key}`} fg={color} wrapMode="none">
          {current.contextCompact}
        </text>
      </box>
    </box>
        )
      }}
    </Show>
  )
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const typoRules = await loadTypoRules()
  const typoLengths = typoRuleLengths(typoRules)
  let activePromptRef: PromptRef | undefined
  const ui = api.ui as TuiPluginApi["ui"] & {
    Prompt: PromptComponent
    Slot: SlotComponent
  }

  const trackPromptRef = (ref: PromptRef | undefined) => {
    if (ref) {
      activePromptRef = ref
      return
    }

    if (activePromptRef?.focused === false) {
      activePromptRef = undefined
    }
  }

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      ...typoDelimiters.map((delimiter) => ({
        name: `prompt-enhancements.insert-${delimiter.name}`,
        title: `Insert ${delimiter.name}`,
        category: "Prompt",
        hidden: true,
        run() {
          const ref = activePromptRef?.focused ? activePromptRef : undefined
          if (!ref) {
            return
          }

          insertDelimiterAndCorrect(ref, delimiter.value, typoRules, typoLengths)
        },
      })),
    ],
    bindings: typoDelimiters.map((delimiter) => ({
      key: delimiter.key,
      cmd: `prompt-enhancements.insert-${delimiter.name}`,
      desc: delimiter.description ?? "Insert punctuation and fix prompt typo",
    })),
  })

  api.slots.register({
    slots: {
      home_prompt(_ctx: unknown, props: Record<string, unknown>) {
        return (
          <PromptWithEnhancements
            Prompt={ui.Prompt}
            ref={promptRefProp(props)}
            onPromptRef={trackPromptRef}
            right={<ui.Slot name="home_prompt_right" />}
          />
        )
      },
      session_prompt(_ctx: unknown, props: Record<string, unknown>) {
        const promptProps = sessionPromptProps(props)
        return (
          <box position="relative">
            <PromptWithEnhancements
              Prompt={ui.Prompt}
              sessionID={promptProps.sessionID}
              visible={promptProps.visible}
              disabled={promptProps.disabled}
              onSubmit={promptProps.onSubmit}
              ref={promptProps.ref}
              onPromptRef={trackPromptRef}
              right={<ui.Slot name="session_prompt_right" session_id={promptProps.sessionID} />}
            />
            <TokenUsageOverlay api={api} sessionID={promptProps.sessionID} />
          </box>
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
