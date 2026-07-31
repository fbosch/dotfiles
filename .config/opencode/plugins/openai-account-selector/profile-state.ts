import { createHash } from "node:crypto"
import { watch } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { readJsonObject, removeFile, writeJsonAtomic } from "../../../fbb/lib/opencode-multi-auth/storage.ts"

export type OpenAIProfileState = {
  profile: string
  repository: string
}

export async function writeProfileState(
  directory: string,
  serverUrl: string | URL,
  state: OpenAIProfileState & { owner: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  validateState(state)
  if (validLabel(state.owner) === false) throw new Error("invalid OpenAI profile display state owner")
  await writeJsonAtomic(profileStatePath(directory, serverUrl, env), state, 0o600, false)
}

export async function readProfileState(
  directory: string,
  serverUrl: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenAIProfileState | undefined> {
  try {
    const value = await readJsonObject(profileStatePath(directory, serverUrl, env))
    if (typeof value.profile !== "string" || typeof value.repository !== "string") return
    const state = { profile: value.profile, repository: value.repository }
    validateState(state)
    return state
  } catch {
    return
  }
}

export async function removeProfileState(
  directory: string,
  serverUrl: string | URL,
  owner?: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = profileStatePath(directory, serverUrl, env)
  if (owner) {
    const value = await readJsonObject(path).catch(() => undefined)
    if (value?.owner !== owner) return
  }
  await removeFile(path)
}

export async function watchProfileState(
  directory: string,
  serverUrl: string | URL,
  onChange: () => void,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = profileStatePath(directory, serverUrl, env)
  await mkdir(dirname(path), { recursive: true })
  const watcher = watch(dirname(path), (_event, filename) => {
    if (filename?.toString() === basename(path)) onChange()
  })
  return () => watcher.close()
}

function profileStatePath(directory: string, serverUrl: string | URL, env: NodeJS.ProcessEnv) {
  const home = env.HOME || ""
  // This file is shared by the OpenCode server and TUI processes. Runtime
  // directories can differ between those processes, especially on macOS.
  const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state")
  // The server plugin and TUI plugin run in different processes. Their state
  // key must describe the OpenCode instance, not either process ID.
  const identity = `${resolve(directory)}\0${normalizedServerUrl(serverUrl)}`
  const key = createHash("sha256").update(identity).digest("hex").slice(0, 16)
  return join(stateHome, "fbb", "opencode-account-selector", `${key}.json`)
}

function normalizedServerUrl(value: string | URL) {
  const url = new URL(value)
  if (url.hostname === "opencode.internal") return "internal"
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (loopback && url.port === "4096") {
    return "internal"
  }
  if (loopback) url.hostname = "localhost"

  url.hash = ""
  url.search = ""
  url.pathname = url.pathname.replace(/\/+$/, "") || "/"
  return url.toString()
}

function validateState(value: OpenAIProfileState) {
  if (validLabel(value.profile) === false || validLabel(value.repository) === false) {
    throw new Error("invalid OpenAI profile display state")
  }
}

function validLabel(value: string) {
  return value.length > 0 && value.length <= 128 && /[\u0000-\u001f\u007f-\u009f]/.test(value) === false
}
