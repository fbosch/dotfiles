/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import type { JSX } from "solid-js"
import { colorNativeUsage, type Renderable } from "./native-usage-color"
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

type Renderer = {
  root: Renderable
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
  ref: PromptRef | undefined,
  delimiter: string,
  rules: ReadonlyMap<string, string>,
  ruleLengths: ReadonlySet<number>,
) {
  if (!ref || ref.focused === false) {
    return false
  }

  const current = ref.current
  const input = appendDelimiterAndCorrect(current.input, delimiter, rules, ruleLengths)
  if (input === `${current.input}${delimiter}`) {
    return false
  }

  ref.set({ ...current, input })
  return true
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

function useNativeUsageColor(api: TuiPluginApi) {
  const renderer = (api as unknown as { renderer?: Renderer }).renderer
  if (renderer === undefined) {
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => colorNativeUsage(renderer.root), 80)
  }
  const unsubscribe = [
    api.event.on("message.updated", refresh),
    api.event.on("message.part.updated", refresh),
    api.event.on("session.compacted", refresh),
    api.event.on("session.idle", refresh),
    api.event.on("session.updated", refresh),
  ]

  refresh()

  const lifecycle = api as unknown as { lifecycle?: { onDispose(cleanup: () => void): void } }
  lifecycle.lifecycle?.onDispose(() => {
    if (timer) {
      clearTimeout(timer)
    }

    for (const stop of unsubscribe) {
      stop()
    }
  })
}

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  const typoRules = await loadTypoRules()
  const typoLengths = typoRuleLengths(typoRules)
  useNativeUsageColor(api)
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
        run(context) {
          if (insertDelimiterAndCorrect(activePromptRef, delimiter.value, typoRules, typoLengths) === false) {
            return
          }

          context.event.preventDefault()
          context.event.stopPropagation()
        },
      })),
    ],
    bindings: typoDelimiters.map((delimiter) => ({
        key: delimiter.key,
        cmd: `prompt-enhancements.insert-${delimiter.name}`,
        desc: delimiter.description ?? "Insert punctuation and fix prompt typo",
        preventDefault: false,
        fallthrough: true,
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
