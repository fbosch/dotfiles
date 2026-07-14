import { afterEach, describe, expect, test } from "bun:test"
import { appendFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ContextImagesStats } from "./stats"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function stats(worktree: string) {
  const directory = await mkdtemp(join(tmpdir(), "context-images-stats-test-"))
  temporaryDirectories.push(directory)
  const file = join(directory, "stats.jsonl")
  return { file, stats: new ContextImagesStats({ file, repoID: worktree, worktree }) }
}

describe("ContextImagesStats", () => {
  test("aggregates session, repo, and total estimates", async () => {
    const first = await stats("/repo/first")
    await first.stats.recordReplacement({
      kind: "ambient",
      requestID: "request-1",
      sessionID: "session-1",
      packages: [{ imageTokens: 20, plaintextTokens: 100, promptTokens: 30, sourcePath: "/repo/first/AGENTS.md" }],
    })
    await first.stats.recordReplacement({
      kind: "scoped",
      requestID: "request-2",
      sessionID: "session-2",
      packages: [{ imageTokens: 30, plaintextTokens: 40, promptTokens: 20, sourcePath: "/repo/first/nested/AGENTS.md" }],
    })
    await first.stats.recordFallback({
      kind: "ambient",
      reason: "cache-miss",
      requestID: "request-3",
      sessionID: "session-1",
    })
    const second = new ContextImagesStats({ file: first.file, repoID: "repo-2", worktree: "/repo/second" })
    await second.recordReplacement({
      kind: "ambient",
      requestID: "request-4",
      sessionID: "session-3",
      packages: [{ imageTokens: 50, plaintextTokens: 200, promptTokens: 50, sourcePath: "/repo/second/AGENTS.md" }],
    })
    await appendFile(first.file, '{"type":"replacement","kind":"invalid"}\nnot-json\n')

    expect(await first.stats.report("session", "session-1")).toContain("Net saved: 50 tokens (50.0%)")
    expect(await first.stats.report("repo", "session-1")).toContain("Net saved: 40 tokens (28.6%)")
    expect(await first.stats.report("total", "session-1")).toContain("Plaintext fallback groups: 1")
    expect(await first.stats.report("total", "session-1")).toContain("Net saved: 140 tokens (41.2%)")
    expect(await first.stats.report("repo", "session-1")).toContain("/repo/first/nested/AGENTS.md: -10 tokens")
    expect(await first.stats.report("total", "session-1")).toContain("Skipped incompatible records: 1")
    expect(await first.stats.report("total", "session-1")).toContain("Skipped corrupt records: 1")
    expect((await stat(first.file)).mode & 0o777).toBe(0o600)
  })

  test("reports an empty scope without creating state", async () => {
    const value = await stats("/repo/first")

    expect(await value.stats.report("session", "missing")).toContain("No statistics recorded")
  })

  test("deduplicates requests containing multiple replacement groups", async () => {
    const value = await stats("/repo/first")
    const packages = [{ imageTokens: 20, plaintextTokens: 100, promptTokens: 30, sourcePath: "/repo/first/AGENTS.md" }]
    await value.stats.recordReplacement({ kind: "ambient", packages, requestID: "request-1", sessionID: "session-1" })
    await value.stats.recordReplacement({ kind: "scoped", packages, requestID: "request-1", sessionID: "session-1" })

    const report = await value.stats.report("session", "session-1")
    expect(report).toContain("Requests transformed: 1")
    expect(report).toContain("Replacement groups: 2")
  })

  test("discloses recording failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "context-images-stats-test-"))
    temporaryDirectories.push(directory)
    const blocker = join(directory, "not-a-directory")
    await writeFile(blocker, "blocked")
    const value = new ContextImagesStats({ file: join(blocker, "stats.jsonl"), repoID: "repo-1", worktree: "/repo" })

    await value.recordFallback({
      kind: "ambient",
      reason: "not-ready",
      requestID: "request-1",
      sessionID: "session-1",
    })

    expect(await value.report("session", "session-1")).toContain("Recording warning: events may be incomplete")
  })
})
