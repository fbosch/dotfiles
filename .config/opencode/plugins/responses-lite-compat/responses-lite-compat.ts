import { tool, type Plugin } from "@opencode-ai/plugin"
import { createCodexOAuthFetch, isOAuthAuth } from "./adapter"

type AuthGetter = () => Promise<unknown>

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
    // OpenCode otherwise rejects hosted OpenAI tool_search calls before the
    // provider-loaded schema result can be applied. adapter.ts replaces this
    // sentinel with OpenAI's native descriptor on the wire.
    tool: {
      tool_search: tool({
        description: "Internal OpenAI native tool-search compatibility bridge. Never call directly.",
        args: {
          arguments: tool.schema.unknown().optional(),
          call_id: tool.schema.string().nullable().optional(),
        },
        async execute() {
          throw new Error("tool_search must be executed by the OpenAI provider")
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const id = event.properties.info.id
      if (typeof id === "string") sessionIDs.delete(id)
    },
  }
}

export default ResponsesLiteCompatibilityPlugin
