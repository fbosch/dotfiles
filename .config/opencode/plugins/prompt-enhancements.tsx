/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { RGBA } from "@opentui/core"
import type { JSX } from "solid-js"
import { createMemo, createSignal, onCleanup, Show } from "solid-js"

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

type TokenBreakPoint = {
  metric: "tokens" | "percent"
  lte: number
  color: string
}

type PluginConfig = {
  breakpoints: TokenBreakPoint[]
}

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

type TypoRule = {
  from: string
  to: string
}

type PatternPart =
  | { type: "text"; value: string }
  | { type: "group"; alternatives: string[] }

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

const defaultConfig: PluginConfig = {
  breakpoints: [
    { metric: "tokens", lte: 100000, color: "#98c379" },
    { metric: "percent", lte: 74, color: "#e5c07b" },
    { metric: "percent", lte: Infinity, color: "#e06c75" },
  ],
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

function parseConfig(options: unknown): PluginConfig {
  if (isRecord(options) === false || Array.isArray(options.breakpoints) === false) {
    return defaultConfig
  }

  const breakpoints = options.breakpoints
    .flatMap((entry) => {
      if (isRecord(entry) === false) return []

      const metric = entry.metric === "tokens" ? "tokens" : entry.metric === "percent" ? "percent" : undefined
      const lte = asFiniteNumber(entry.lte)
      const color = typeof entry.color === "string" ? entry.color.trim() : ""
      if (metric === undefined || lte === undefined || color.length === 0) return []
      const breakpoint: TokenBreakPoint = { metric, lte, color }
      return [breakpoint]
    })

  if (breakpoints.length === 0) {
    return defaultConfig
  }

  return { breakpoints }
}

function typoRulesPath(): string {
  return `${process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ""}/.config`}/fbb/data/typos.abolish`
}

function parsePattern(pattern: string): PatternPart[] {
  const parts: PatternPart[] = []
  let index = 0

  while (index < pattern.length) {
    const open = pattern.indexOf("{", index)
    if (open === -1) {
      parts.push({ type: "text", value: pattern.slice(index) })
      break
    }

    if (open > index) {
      parts.push({ type: "text", value: pattern.slice(index, open) })
    }

    const close = pattern.indexOf("}", open + 1)
    if (close === -1) {
      parts.push({ type: "text", value: pattern.slice(open) })
      break
    }

    parts.push({ type: "group", alternatives: pattern.slice(open + 1, close).split(",") })
    index = close + 1
  }

  return parts
}

function expandLeftPattern(parts: PatternPart[]) {
  const expanded: { text: string; captures: string[]; indexes: number[] }[] = [{ text: "", captures: [], indexes: [] }]

  for (const part of parts) {
    if (part.type === "text") {
      for (const entry of expanded) {
        entry.text += part.value
      }
      continue
    }

    const alternatives = part.alternatives.length === 0 ? [""] : part.alternatives
    const next = expanded.flatMap((entry) =>
      alternatives.map((alternative, index) => ({
        text: entry.text + alternative,
        captures: [...entry.captures, alternative],
        indexes: [...entry.indexes, index],
      })),
    )

    expanded.splice(0, expanded.length, ...next)
  }

  return expanded
}

function expandRightPattern(parts: PatternPart[], captures: string[], indexes: number[]): string {
  let groupIndex = 0
  let result = ""

  for (const part of parts) {
    if (part.type === "text") {
      result += part.value
      continue
    }

    if (part.alternatives.length === 1 && part.alternatives[0] === "") {
      result += captures[groupIndex] ?? ""
      groupIndex += 1
      continue
    }

    const alternatives = part.alternatives.length === 0 ? [""] : part.alternatives
    const selectedIndex = indexes[groupIndex] ?? 0
    result += alternatives[selectedIndex % alternatives.length] ?? ""
    groupIndex += 1
  }

  return result
}

function caseVariants(rule: TypoRule): TypoRule[] {
  const titleFrom = rule.from.charAt(0).toUpperCase() + rule.from.slice(1)
  const titleTo = rule.to.charAt(0).toUpperCase() + rule.to.slice(1)
  return [
    rule,
    { from: titleFrom, to: titleTo },
    { from: rule.from.toUpperCase(), to: rule.to.toUpperCase() },
  ]
}

function parseTypoRule(line: string): TypoRule[] {
  const match = /^(\S+)\s+(\S+)$/.exec(line)
  if (!match) {
    return []
  }

  const left = parsePattern(match[1])
  const right = parsePattern(match[2])

  return expandLeftPattern(left).flatMap((entry) =>
    caseVariants({
      from: entry.text,
      to: expandRightPattern(right, entry.captures, entry.indexes),
    }),
  )
}

async function loadTypoRules(): Promise<Map<string, string>> {
  const rules = new Map<string, string>()

  try {
    for (const line of (await Bun.file(typoRulesPath()).text()).split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue
      }

      for (const rule of parseTypoRule(trimmed)) {
        rules.set(rule.from, rule.to)
      }
    }
  } catch {
    return rules
  }

  return rules
}

function correctCompletedWord(input: string, rules: ReadonlyMap<string, string>): string {
  const match = /(^|[^A-Za-z0-9_'])([A-Za-z][A-Za-z0-9_']*)([^A-Za-z0-9_']+)$/.exec(input)
  if (!match) {
    return input
  }

  const replacement = rules.get(match[2])
  if (replacement === undefined || replacement === match[2]) {
    return input
  }

  return input.slice(0, match.index) + match[1] + replacement + match[3]
}

function insertSpaceAndCorrect(ref: PromptRef, rules: ReadonlyMap<string, string>) {
  const current = ref.current
  ref.set({ ...current, input: correctCompletedWord(`${current.input} `, rules) })
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
  config: PluginConfig,
  usage: { used: number; percent?: number } | undefined,
): ThemeColor {
  if (usage === undefined) {
    return textMuted(theme)
  }

  const match = config.breakpoints.find((entry) => {
    if (entry.metric === "tokens") {
      return usage.used <= entry.lte
    }

    if (usage.percent === undefined) {
      return false
    }

    return usage.percent <= entry.lte
  })

  if (match) {
    return resolveColor(theme, match.color, textMuted(theme))
  }

  return resolveColor(theme, config.breakpoints[config.breakpoints.length - 1]?.color ?? "textMuted", textMuted(theme))
}

function toAssistantMessage(row: unknown): AssistantMessage | undefined {
  if (isRecord(row) === false) {
    return undefined
  }

  if (row.role === "assistant") {
    return row as AssistantMessage
  }

  if (isRecord(row.info) && row.info.role === "assistant") {
    return row.info as AssistantMessage
  }

  return undefined
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

function contextLimit(api: TuiPluginApi, message: AssistantMessage): number | undefined {
  const providerID = typeof message.providerID === "string" ? message.providerID : undefined
  const modelID = typeof message.modelID === "string" ? message.modelID : undefined
  if (!providerID || !modelID) {
    return undefined
  }

  const providers = Array.isArray(api.state.provider) ? api.state.provider : []
  const provider = providers.find((entry): entry is ProviderInfo => isRecord(entry) && entry.id === providerID)
  return asFiniteNumber(provider?.models?.[modelID]?.limit?.context)
}

function totalTokens(tokens: AssistantTokens): number {
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0) +
    (tokens.cache?.write ?? 0)
  )
}

function lastAssistantWithUsage(messages: AssistantMessage[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message?.tokens) {
      continue
    }

    if (totalTokens(message.tokens) > 0) {
      return message
    }
  }

  return undefined
}

function usageTextFromAssistants(api: TuiPluginApi, assistants: AssistantMessage[]) {
  const last = lastAssistantWithUsage(assistants)

  if (!last?.tokens) {
    return undefined
  }

  const used = totalTokens(last.tokens)
  if (used <= 0) {
    return undefined
  }

  const limit = contextLimit(api, last)
  const percent = limit && limit > 0 ? Math.round((used / limit) * 100) : undefined
  return {
    used,
    contextCompact: percent !== undefined ? `${compactNumber.format(used)} (${percent}%)` : compactNumber.format(used),
    tokensFull: `${fullNumber.format(used)} tokens`,
    usageFull: percent !== undefined ? `${percent}% used` : undefined,
    percent,
  }
}

function eventProperties(event: { properties?: unknown }): Record<string, unknown> {
  return isRecord(event.properties) ? event.properties : {}
}

function eventSessionID(properties: Record<string, unknown>): string | undefined {
  if (typeof properties.sessionID === "string") {
    return properties.sessionID
  }

  if (isRecord(properties.info) && typeof properties.info.sessionID === "string") {
    return properties.info.sessionID
  }

  if (isRecord(properties.part) && typeof properties.part.sessionID === "string") {
    return properties.part.sessionID
  }

  if (isRecord(properties.message) && typeof properties.message.sessionID === "string") {
    return properties.message.sessionID
  }

  return undefined
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
      const rows = Array.isArray(response) ? response : Array.isArray(response.data) ? response.data : []
      setFetchedAssistants(assistantMessagesFromRows(rows))
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
  const runBootstrapRefresh = () => {
    bootstrapAttempts += 1
    setRefresh((value) => value + 1)

    const syncedAssistants = assistantMessagesFromRows(props.api.state.session.messages(props.sessionID))
    if (syncedAssistants.length === 0 && fetchedAssistants().length === 0) {
      void fetchAssistants()
    }

    if (usageTextFromAssistants(props.api, syncedAssistants) || usageTextFromAssistants(props.api, fetchedAssistants()) || bootstrapAttempts >= maxBootstrapAttempts) {
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

function TokenUsageOverlay(props: { api: TuiPluginApi; sessionID: string; config: PluginConfig }): JSX.Element {
  const usage = useUsage(props)
  const theme = createMemo(() => props.api.theme.current as ThemeMap)
  const background = createMemo(() => promptBackground(theme()))
  const foreground = createMemo(() => usageColor(theme(), props.config, usage()))
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

const tui: TuiPlugin = async (api: TuiPluginApi, options: unknown) => {
  const config = parseConfig(options)
  const typoRules = await loadTypoRules()
  const promptRefs = new Set<PromptRef>()
  const ui = api.ui as TuiPluginApi["ui"] & {
    Prompt: PromptComponent
    Slot: SlotComponent
  }

  const trackPromptRef = (ref: PromptRef | undefined) => {
    if (ref) {
      promptRefs.add(ref)
      return
    }

    for (const promptRef of promptRefs) {
      if (promptRef.focused === false) {
        promptRefs.delete(promptRef)
      }
    }
  }

  api.keymap.registerLayer({
    mode: "base",
    commands: [
      {
        name: "prompt-enhancements.space",
        title: "Insert Space",
        category: "Prompt",
        hidden: true,
        run() {
          const ref = [...promptRefs].find((promptRef) => promptRef.focused)
          if (!ref) {
            return
          }

          insertSpaceAndCorrect(ref, typoRules)
        },
      },
    ],
    bindings: [{ key: "space", cmd: "prompt-enhancements.space", desc: "Insert space and fix prompt typo" }],
  })

  api.slots.register({
    slots: {
      home_prompt(_ctx: unknown, props: Record<string, unknown>) {
        return (
          <PromptWithEnhancements
            Prompt={ui.Prompt}
            ref={typeof props.ref === "function" ? (props.ref as (ref: PromptRef | undefined) => void) : undefined}
            onPromptRef={trackPromptRef}
            right={<ui.Slot name="home_prompt_right" />}
          />
        )
      },
      session_prompt(_ctx: unknown, props: Record<string, unknown>) {
        const sessionID = typeof props.session_id === "string" ? props.session_id : ""
        return (
          <box position="relative">
            <PromptWithEnhancements
              Prompt={ui.Prompt}
              sessionID={sessionID}
              visible={typeof props.visible === "boolean" ? props.visible : undefined}
              disabled={typeof props.disabled === "boolean" ? props.disabled : undefined}
              onSubmit={typeof props.on_submit === "function" ? (props.on_submit as () => void) : undefined}
              ref={typeof props.ref === "function" ? (props.ref as (ref: PromptRef | undefined) => void) : undefined}
              onPromptRef={trackPromptRef}
              right={<ui.Slot name="session_prompt_right" session_id={sessionID} />}
            />
            <TokenUsageOverlay api={api} sessionID={sessionID} config={config} />
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
