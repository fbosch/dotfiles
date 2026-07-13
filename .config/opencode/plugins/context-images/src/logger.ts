import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

export type ContextImagesEvent =
  | { event: "plugin_loaded" }
  | {
      event: "replacement_mismatch"
      missingSources: string[]
      modelID: string
      sessionID: string
    }
  | {
      event: "transform_failed"
      message: string
    }

export interface ContextImagesLogger {
  write(event: ContextImagesEvent): Promise<void>
}

function defaultLogFile() {
  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateRoot, "opencode", "context-images", "events.jsonl")
}

function resolveLogFile(path = defaultLogFile()) {
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

export class JsonlLogger implements ContextImagesLogger {
  readonly #file: string
  #ready?: Promise<void>
  #warned = false

  constructor(file = defaultLogFile()) {
    this.#file = resolveLogFile(file)
  }

  async write(event: ContextImagesEvent) {
    try {
      this.#ready ??= mkdir(dirname(this.#file), { recursive: true }).then(() => undefined)
      await this.#ready
      await appendFile(this.#file, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`)
    } catch (error) {
      if (this.#warned) return
      this.#warned = true
      const detail = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[context-images] failed to write log: ${detail}\n`)
    }
  }
}
