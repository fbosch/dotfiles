import type { Plugin } from "@opencode-ai/plugin"
import { createCodexOAuthFetch, isOAuthAuth } from "./adapter"

type AuthGetter = () => Promise<unknown>
type SessionDeletedEvent = {
  event: {
    type: string
    properties?: {
      info?: {
        id?: unknown
      }
    }
  }
}

export const ResponsesLiteCompatibilityPlugin: Plugin = async (input) => {
  const sessionIDs = new Map<string, string>()

  return {
    auth: {
      provider: "openai",
      async loader(getAuth: AuthGetter) {
        const auth = await getAuth()
        if (!isOAuthAuth(auth)) return {}

        return {
          apiKey: "opencode-oauth-dummy-key",
          fetch: createCodexOAuthFetch({
            getAuth,
            setAuth: (auth) =>
              input.client.auth.set({
                path: { id: "openai" },
                body: auth,
              }),
            sessionIDs,
          }),
        }
      },
    },
    event: async ({ event }: SessionDeletedEvent) => {
      if (event.type !== "session.deleted") return
      const id = event.properties?.info?.id
      if (typeof id === "string") sessionIDs.delete(id)
    },
  }
}

export default ResponsesLiteCompatibilityPlugin
