import { createReadStream } from "node:fs"
import { access, appendFile, chmod, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"

export type StatsScope = "repo" | "session" | "total"
export type ReplacementKind = "ambient" | "read-result" | "scoped"

export type PackageEstimate = {
  imageTokens: number
  plaintextTokens: number
  promptTokens: number
  sourcePath: string
}

type ReplacementEvent = {
  kind: ReplacementKind
  packages: PackageEstimate[]
  repoID: string
  requestID: string
  sessionID: string
  timestamp: string
  type: "replacement"
  worktree: string
}

type FallbackEvent = {
  kind: ReplacementKind
  reason: string
  repoID: string
  requestID: string
  sessionID: string
  timestamp: string
  type: "fallback"
  worktree: string
}

type StatsEvent = FallbackEvent | ReplacementEvent
const MAX_TOKEN_ESTIMATE = 100_000_000

function defaultStatsFile() {
  const root = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(root, "opencode", "context-images", "stats.jsonl")
}

function isStatsEvent(value: unknown): value is StatsEvent {
  if (typeof value !== "object" || value === null) return false
  const event = value as Record<string, unknown>
  const common =
    (event.kind === "ambient" || event.kind === "read-result" || event.kind === "scoped") &&
    typeof event.repoID === "string" &&
    event.repoID.length > 0 &&
    typeof event.requestID === "string" &&
    event.requestID.length > 0 &&
    typeof event.sessionID === "string" &&
    event.sessionID.length > 0 &&
    typeof event.timestamp === "string" &&
    new Date(event.timestamp).toISOString() === event.timestamp &&
    typeof event.worktree === "string" &&
    event.worktree.length > 0
  if (!common) return false
  if (event.type === "fallback") return typeof event.reason === "string"
  if (event.type !== "replacement" || Array.isArray(event.packages) === false || event.packages.length === 0) return false
  return event.packages.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      Number.isSafeInteger(item.imageTokens) &&
      item.imageTokens > 0 &&
      item.imageTokens <= MAX_TOKEN_ESTIMATE &&
      Number.isSafeInteger(item.plaintextTokens) &&
      item.plaintextTokens > 0 &&
      item.plaintextTokens <= MAX_TOKEN_ESTIMATE &&
      Number.isSafeInteger(item.promptTokens) &&
      item.promptTokens > 0 &&
      item.promptTokens <= MAX_TOKEN_ESTIMATE &&
      typeof item.sourcePath === "string" &&
      item.sourcePath.length > 0,
  )
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

function checkedAdd(left: number, right: number) {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error("statistics totals exceeded the safe integer range")
  return result
}

export class ContextImagesStats {
  readonly #file: string
  readonly #repoID: string
  readonly #worktree: string
  #writeError?: string
  #writes = Promise.resolve()

  constructor(input: { file?: string; repoID: string; worktree: string }) {
    this.#file = input.file ?? defaultStatsFile()
    this.#repoID = input.repoID
    this.#worktree = input.worktree
  }

  #append(event: StatsEvent) {
    this.#writes = this.#writes
      .then(async () => {
        await mkdir(dirname(this.#file), { recursive: true, mode: 0o700 })
        await chmod(dirname(this.#file), 0o700)
        await appendFile(this.#file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 })
        await chmod(this.#file, 0o600)
      })
      .catch((error) => {
        this.#writeError = error instanceof Error ? error.message : String(error)
      })
    return this.#writes
  }

  recordReplacement(input: {
    kind: ReplacementKind
    packages: PackageEstimate[]
    requestID: string
    sessionID: string
  }) {
    if (input.packages.length === 0) return Promise.resolve()
    return this.#append({
      ...input,
      repoID: this.#repoID,
      timestamp: new Date().toISOString(),
      type: "replacement",
      worktree: this.#worktree,
    })
  }

  recordFallback(input: { kind: ReplacementKind; reason: string; requestID: string; sessionID: string }) {
    return this.#append({
      ...input,
      repoID: this.#repoID,
      timestamp: new Date().toISOString(),
      type: "fallback",
      worktree: this.#worktree,
    })
  }

  async report(scope: StatsScope, sessionID: string) {
    await this.#writes
    try {
      await access(this.#file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [
          `Context image statistics (${scope}, estimated)`,
          "",
          "No statistics recorded for this scope.",
          ...(this.#writeError ? [`Recording warning: events may be incomplete (${this.#writeError})`] : []),
        ].join("\n")
      }
      const message = error instanceof Error ? error.message : String(error)
      return [
        `Context image statistics (${scope}, estimated)`,
        "",
        `Statistics unavailable: ${message}`,
        ...(this.#writeError ? [`Recording warning: events may be incomplete (${this.#writeError})`] : []),
      ].join("\n")
    }

    const requestIDs = new Set<string>()
    const kindSavings: Record<ReplacementKind, number> = { ambient: 0, scoped: 0, "read-result": 0 }
    const negativeBySource = new Map<string, number>()
    let fallbackGroups = 0
    let firstTimestamp: number | undefined
    let imagePackageTokens = 0
    let matched = 0
    let plaintextTokens = 0
    let replacementGroups = 0
    let corrupt = 0
    let incompatible = 0
    const lines = createInterface({ input: createReadStream(this.#file, { encoding: "utf8" }), crlfDelay: Infinity })
    try {
      for await (const line of lines) {
        if (!line) continue
        let event: StatsEvent
        try {
          const value: unknown = JSON.parse(line)
          if (!isStatsEvent(value)) {
            incompatible += 1
            continue
          }
          event = value
        } catch {
          corrupt += 1
          continue
        }
        if (scope === "session" && event.sessionID !== sessionID) continue
        if (scope === "repo" && event.repoID !== this.#repoID) continue
        matched += 1
        const timestamp = Date.parse(event.timestamp)
        if (firstTimestamp === undefined || timestamp < firstTimestamp) firstTimestamp = timestamp
        if (event.type === "fallback") {
          fallbackGroups += 1
          continue
        }
        replacementGroups += 1
        requestIDs.add(`${event.sessionID}:${event.requestID}`)
        for (const item of event.packages) {
          const packaged = item.promptTokens + item.imageTokens
          const saved = item.plaintextTokens - packaged
          plaintextTokens = checkedAdd(plaintextTokens, item.plaintextTokens)
          imagePackageTokens = checkedAdd(imagePackageTokens, packaged)
          kindSavings[event.kind] = checkedAdd(kindSavings[event.kind], saved)
          if (saved < 0) negativeBySource.set(item.sourcePath, checkedAdd(negativeBySource.get(item.sourcePath) ?? 0, saved))
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Context image statistics (${scope}, estimated)\n\nStatistics unavailable: ${message}`
    }
    if (matched === 0) {
      return [
        `Context image statistics (${scope}, estimated)`,
        "",
        "No statistics recorded for this scope.",
        ...(incompatible > 0 ? [`Skipped incompatible records: ${formatNumber(incompatible)}`] : []),
        ...(corrupt > 0 ? [`Skipped corrupt records: ${formatNumber(corrupt)}`] : []),
        ...(this.#writeError ? [`Recording warning: events may be incomplete (${this.#writeError})`] : []),
      ].join("\n")
    }
    const saved = plaintextTokens - imagePackageTokens
    const percent = plaintextTokens === 0 ? 0 : (saved / plaintextTokens) * 100
    const kinds: ReplacementKind[] = ["ambient", "scoped", "read-result"]
    const breakdown = kinds.map((kind) => `- ${kind}: ${formatNumber(kindSavings[kind])} tokens`)
    const allNegative = [...negativeBySource.entries()]
      .map(([sourcePath, sourceSaved]) => ({ sourcePath, saved: sourceSaved }))
      .sort((left, right) => left.saved - right.saved)
    const negative = allNegative.slice(0, 5).map((item) => `- ${item.sourcePath}: ${formatNumber(item.saved)} tokens`)
    return [
      `Context image statistics (${scope}, estimated)`,
      "",
      `- Requests transformed: ${formatNumber(requestIDs.size)}`,
      `- Replacement groups: ${formatNumber(replacementGroups)}`,
      `- Plaintext estimate: ${formatNumber(plaintextTokens)} tokens`,
      `- Image-package estimate: ${formatNumber(imagePackageTokens)} tokens`,
      `- Net saved: ${formatNumber(saved)} tokens (${percent.toFixed(1)}%)`,
      `- Plaintext fallback groups: ${formatNumber(fallbackGroups)}`,
      `- Recording since: ${new Date(firstTimestamp!).toISOString()}`,
      ...(incompatible > 0 ? [`- Skipped incompatible records: ${formatNumber(incompatible)}`] : []),
      ...(corrupt > 0 ? [`- Skipped corrupt records: ${formatNumber(corrupt)}`] : []),
      ...(this.#writeError ? [`- Recording warning: events may be incomplete (${this.#writeError})`] : []),
      "",
      "Breakdown",
      ...breakdown,
      "",
      `Worst negative-saving packages (${Math.min(5, allNegative.length)} of ${allNegative.length})`,
      ...(negative.length > 0 ? negative : ["- None"]),
    ].join("\n")
  }
}
