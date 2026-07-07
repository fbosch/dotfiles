import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Plugin } from "@opencode-ai/plugin"

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")

type OpenCodeAuth = {
  openai?: {
    access?: string
    expires?: number
    type?: string
  }
}

async function getOpenAIAccessToken() {
  const auth = JSON.parse(await readFile(AUTH_PATH, "utf8")) as OpenCodeAuth
  const openai = auth.openai
  if (openai?.type !== "oauth" || typeof openai.access !== "string" || openai.access === "") {
    throw new Error("OpenAI OAuth credentials are missing from opencode auth.json")
  }

  if (typeof openai.expires === "number" && openai.expires <= Math.floor(Date.now() / 1000)) {
    throw new Error("OpenAI OAuth access token is expired; refresh it with opencode auth")
  }

  return openai.access
}

function isOpenAIRequest(input: unknown) {
  if (!input || typeof input !== "object") return false

  const record = input as Record<string, unknown>
  if (record.providerID === "openai") return true
  if (record.providerID === "headroom") return true
  if (record.provider === "openai") return true
  if (record.provider === "headroom") return true

  const provider = record.provider
  if (provider && typeof provider === "object") {
    const providerRecord = provider as Record<string, unknown>
    return (
      providerRecord.id === "openai" ||
      providerRecord.id === "headroom" ||
      providerRecord.providerID === "openai" ||
      providerRecord.providerID === "headroom"
    )
  }

  return false
}

export const HeadroomOpenAIOAuthPlugin: Plugin = async () => ({
  "chat.headers": async (input, output) => {
    if (!isOpenAIRequest(input)) return

    output.headers = {
      ...output.headers,
      authorization: `Bearer ${await getOpenAIAccessToken()}`,
    }
  },
})

export default HeadroomOpenAIOAuthPlugin
