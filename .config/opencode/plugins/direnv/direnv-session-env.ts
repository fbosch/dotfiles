import type { Plugin } from "@opencode-ai/plugin"
import { loadDirenvEnvironment, type DirenvEnvironment } from "./direnv-environment"

export const DirenvSessionEnvironmentPlugin: Plugin = async ({ client, project, $ }) => {
  const sessions = new Map<string, DirenvEnvironment>()
  const handledSessions = new Set<string>()

  const showBlockedNotice = async () => {
    try {
      await client.tui.showToast({
        body: {
          message: "direnv: .envrc is blocked. Run `direnv allow` to enable it.",
          variant: "warning",
        },
      })
    } catch {
      // A missing TUI must not affect session creation.
    }
  }

  const hydrateSession = async (id: string, directory: string) => {
    if (handledSessions.has(id)) return
    handledSessions.add(id)

    const result = await loadDirenvEnvironment(directory, project.worktree, async (cwd) => {
      return (await $`direnv export json`.cwd(cwd).quiet()).text()
    })

    if (result.status === "blocked") await showBlockedNotice()
    if (result.status === "loaded") sessions.set(id, result.environment)
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        sessions.delete(event.properties.info.id)
        handledSessions.delete(event.properties.info.id)
        return
      }

      if (event.type !== "session.created") return

      const { id, directory } = event.properties.info
      await hydrateSession(id, directory)
    },
    "shell.env": async ({ cwd, sessionID }, output) => {
      if (!sessionID) return
      await hydrateSession(sessionID, cwd)
      const environment = sessions.get(sessionID)
      if (!environment) return

      for (const [name, value] of Object.entries(environment)) {
        if (value === null) delete output.env[name]
        else output.env[name] = value
      }
    },
  }
}
