import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ERROR, HyprComputerUseError } from "./errors"
import type { TargetSnapshot } from "./types"

export type ControlBinding = {
  action: string
  keys: string[]
  note?: string | null
}

export type ControlsUpdate = {
  source?: string | null
  notes?: string | null
  bindings?: ControlBinding[]
}

export type ControlProfile = {
  cacheKey: string
  target: {
    class: string | null
    title: string | null
  }
  source: string | null
  notes: string | null
  updatedAt: string
  bindings: ControlBinding[]
}

type ControlsCache = {
  version: 1
  profiles: ControlProfile[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function stringArray(value: unknown): string[] | null {
  if (Array.isArray(value) === false) return null
  const strings = value.filter((item) => typeof item === "string" && item.length > 0)
  return strings.length === value.length ? strings : null
}

function errorCode(error: unknown): string | null {
  if (isObject(error) === false) return null
  return optionalString(error.code)
}

function controlBindingFromUnknown(value: unknown): ControlBinding | null {
  if (isObject(value) === false) return null
  const action = optionalString(value.action)
  const keys = stringArray(value.keys)
  if (!action || !keys || keys.length === 0) return null
  return {
    action,
    keys,
    note: optionalString(value.note),
  }
}

function controlProfileFromUnknown(value: unknown): ControlProfile | null {
  if (isObject(value) === false || isObject(value.target) === false) return null
  const cacheKey = optionalString(value.cacheKey)
  const bindings = Array.isArray(value.bindings)
    ? value.bindings.map(controlBindingFromUnknown)
    : []
  if (!cacheKey || bindings.some((binding) => binding === null)) return null

  return {
    cacheKey,
    target: {
      class: optionalString(value.target.class),
      title: optionalString(value.target.title),
    },
    source: optionalString(value.source),
    notes: optionalString(value.notes),
    updatedAt: optionalString(value.updatedAt) ?? new Date(0).toISOString(),
    bindings: bindings.filter((binding) => binding !== null),
  }
}

function controlsCacheFromUnknown(value: unknown): ControlsCache | null {
  if (isObject(value) === false || value.version !== 1 || Array.isArray(value.profiles) === false) return null
  const profiles = value.profiles.map(controlProfileFromUnknown)
  if (profiles.some((profile) => profile === null)) return null
  return {
    version: 1,
    profiles: profiles.filter((profile) => profile !== null),
  }
}

function defaultControlsCachePath(): string {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateHome, "hypr-computer-use", "controls.json")
}

function controlsCacheKey(target: Pick<TargetSnapshot, "class" | "title">): string {
  const className = target.class?.toLowerCase() ?? ""
  const title = target.title?.toLowerCase() ?? ""
  return `class:${className}|title:${title}`
}

async function readControlsCache(cachePath = defaultControlsCachePath()): Promise<ControlsCache> {
  let raw = ""
  try {
    raw = await readFile(cachePath, "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { version: 1, profiles: [] }
    }
    throw new HyprComputerUseError(ERROR.controlsCacheInvalid, "Unable to read controls cache", {
      cachePath,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    const cache = controlsCacheFromUnknown(parsed)
    if (!cache) {
      throw new Error("Invalid controls cache shape")
    }
    return cache
  } catch (error) {
    throw new HyprComputerUseError(ERROR.controlsCacheInvalid, "Controls cache is invalid", {
      cachePath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function writeControlsCache(cache: ControlsCache, cachePath = defaultControlsCachePath()): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8")
}

function normalizedBindings(update: ControlsUpdate): ControlBinding[] {
  const bindings = update.bindings ?? []
  const normalized = bindings.map((binding) => ({
    action: binding.action.trim(),
    keys: binding.keys.map((key) => key.trim()).filter((key) => key.length > 0),
    note: binding.note?.trim() || null,
  })).filter((binding) => binding.action.length > 0 && binding.keys.length > 0)

  if (normalized.length !== bindings.length || normalized.length === 0) {
    throw new HyprComputerUseError(ERROR.controlsCacheInvalid, "Controls cache update requires at least one valid binding", {
      bindings,
    })
  }

  return normalized
}

export async function lookupControls(target: TargetSnapshot, cachePath?: string): Promise<ControlProfile | null> {
  const cache = await readControlsCache(cachePath)
  const cacheKey = controlsCacheKey(target)
  return cache.profiles.find((profile) => profile.cacheKey === cacheKey) ?? null
}

export async function upsertControls(target: TargetSnapshot, update: ControlsUpdate, cachePath?: string): Promise<ControlProfile> {
  const cache = await readControlsCache(cachePath)
  const cacheKey = controlsCacheKey(target)
  const profile: ControlProfile = {
    cacheKey,
    target: {
      class: target.class,
      title: target.title,
    },
    source: update.source?.trim() || null,
    notes: update.notes?.trim() || null,
    updatedAt: new Date().toISOString(),
    bindings: normalizedBindings(update),
  }

  await writeControlsCache({
    version: 1,
    profiles: [
      ...cache.profiles.filter((existing) => existing.cacheKey !== cacheKey),
      profile,
    ],
  }, cachePath)

  return profile
}
