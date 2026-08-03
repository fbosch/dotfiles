import { describe, expect, test } from "bun:test"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { attachHerdrLifecycle } from "../herdr-lifecycle"
import type { AgentState } from "../herdr-integration"

function setup() {
  const handlers = new Map<string, (event: { properties?: unknown }) => void>()
  const states: AgentState[] = []
  const titles: (string | null)[] = []
  const api = {
    route: { current: { name: "session", params: { sessionID: "visible" } } },
    event: {
      on(type: string, handler: (event: { properties?: unknown }) => void) {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
    },
    state: {
      session: {
        get: () => ({ title: "Initial title" }),
        status: () => ({ type: "idle" }),
      },
    },
  } as TuiPluginApi
  const cleanup = attachHerdrLifecycle(api, {
    reportState(state) {
      states.push(state)
      return Promise.resolve()
    },
    reportTitle(title) {
      titles.push(title)
      return Promise.resolve()
    },
  })
  return { cleanup, handlers, states, titles }
}

describe("Herdr lifecycle", () => {
  test("tracks the visible session through all event shapes", () => {
    const { handlers, states, titles } = setup()
    handlers.get("session.status")?.({ properties: { sessionID: "visible", status: { type: "busy" } } })
    handlers.get("message.updated")?.({ properties: { info: { sessionID: "visible" } } })
    handlers.get("permission.asked")?.({ properties: { sessionID: "visible" } })
    handlers.get("session.idle")?.({ properties: { sessionID: "visible" } })
    handlers.get("session.updated")?.({ properties: { info: { id: "visible", title: "Updated title" } } })
    expect(states).toEqual(["idle", "working", "working", "blocked", "idle"])
    expect(titles).toEqual(["Initial title", "Updated title"])
  })

  test("ignores background sessions and unsubscribes", () => {
    const { cleanup, handlers, states } = setup()
    handlers.get("session.status")?.({ properties: { sessionID: "background", status: { type: "busy" } } })
    cleanup()
    expect(states).toEqual(["idle"])
    expect(handlers.size).toBe(0)
  })
})
