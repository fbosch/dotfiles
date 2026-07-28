import type { Plugin } from "@opencode-ai/plugin"
import net from "node:net"

const source = "herdr:opencode"
const agent = "opencode"
let sequence = Date.now() * 1000
const childSessions = new Set<string>()

function sessionId(properties: Record<string, unknown>) {
  return typeof properties.sessionID === "string" && properties.sessionID !== ""
    ? properties.sessionID
    : undefined
}

function stateFromStatus(status: unknown) {
  const kind = typeof status === "string"
    ? status
    : typeof status === "object" && status !== null && "type" in status
      ? status.type
      : undefined
  if (typeof kind !== "string") return
  if (kind.toLowerCase() === "idle") return "idle"
  if (["active", "busy", "pending", "running", "streaming", "working", "retry"].includes(kind.toLowerCase())) {
    return "working"
  }
}

function report(state: "idle" | "working" | "blocked") {
  const paneId = process.env.OPENCODE_NVIM_HERDR_PANE_ID
  const socketPath = process.env.HERDR_SOCKET_PATH
  if (process.env.HERDR_ENV !== "1" || !paneId || !socketPath) return Promise.resolve()

  sequence += 1
  const payload = JSON.stringify({
    id: `${source}:${sequence}`,
    method: "pane.report_agent",
    params: { pane_id: paneId, source, agent, seq: sequence, state },
  })

  return new Promise<void>((resolve) => {
    const client = net.createConnection(socketPath, () => client.write(`${payload}\n`))
    const finish = () => {
      client.destroy()
      resolve()
    }
    client.setTimeout(500, finish)
    client.on("data", finish)
    client.on("error", finish)
    client.on("end", finish)
    client.on("close", resolve)
  })
}

export const NeovimHerdrAgentPlugin: Plugin = async () => {
  if (!process.env.OPENCODE_NVIM_HERDR_PANE_ID) return {}

  return {
    "chat.message": async ({ sessionID }) => {
      if (!sessionID || childSessions.has(sessionID) === false) await report("working")
    },
    event: async ({ event }) => {
      const properties = event.properties as Record<string, unknown>
      const id = sessionId(properties)
      const info = properties.info
      if (typeof info === "object" && info !== null && "id" in info && "parentID" in info) {
        if (typeof info.id === "string" && info.parentID) childSessions.add(info.id)
      }

      if (id && childSessions.has(id)) {
        if (event.type === "permission.asked" || event.type === "question.asked") await report("blocked")
        if (["permission.replied", "question.replied", "question.rejected"].includes(event.type)) {
          await report("working")
        }
        return
      }

      if (event.type === "session.status") {
        const state = stateFromStatus(properties.status)
        if (state) await report(state)
        return
      }
      if (["permission.asked", "question.asked", "session.error"].includes(event.type)) {
        await report("blocked")
        return
      }
      if (event.type === "session.idle") {
        await report("idle")
        return
      }
      if (
        [
          "session.created",
          "tool.execute.before",
          "tool.execute.after",
          "permission.replied",
          "question.replied",
          "question.rejected",
          "session.compacted",
        ].includes(event.type)
      ) {
        await report("working")
      }
    },
  }
}

export default NeovimHerdrAgentPlugin
