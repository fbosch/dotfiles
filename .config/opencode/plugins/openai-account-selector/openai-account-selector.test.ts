import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import { generatedLabelFor } from "../../../fbb/lib/opencode-multi-auth/providers/codex.ts"
import type { AccountPaths, AccountUsage } from "../../../fbb/lib/opencode-multi-auth/types.ts"
import { OpenAIAccountSelectorPlugin } from "./openai-account-selector.ts"
import { readProfileState, removeProfileState, watchProfileState, writeProfileState } from "./profile-state.ts"
import {
  defaultRepositoryMappingPath,
  repositoryNameFallback,
  repositoryNameFromOrigin,
  selectRepositoryAccount,
  usageIsAvailable,
} from "./selection.ts"
import { createCodexFetch } from "./transport.ts"

const temporaryDirectories: string[] = []
const originalFetch = globalThis.fetch
const originalEnvironment = {
  OPENCODE_EXPERIMENTAL_WEBSOCKETS: process.env.OPENCODE_EXPERIMENTAL_WEBSOCKETS,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME,
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("derives stable repository names from common origin URLs", () => {
  expect(repositoryNameFromOrigin("https://github.com/org/pkdx.git")).toBe("pkdx")
  expect(repositoryNameFromOrigin("git@github.com:org/pkdx.git")).toBe("pkdx")
  expect(repositoryNameFromOrigin("ssh://git@host/org/pkdx")).toBe("pkdx")
  expect(repositoryNameFromOrigin("/srv/git/pkdx.git/")).toBe("pkdx")
  expect(repositoryNameFromOrigin("https://host/org/my%20repo.git")).toBe("my repo")
  expect(repositoryNameFallback("/work/pkdx-feature")).toBe("pkdx-feature")
})

test("resolves the default mapping path from XDG configuration", () => {
  expect(defaultRepositoryMappingPath({ HOME: "/home/test", XDG_CONFIG_HOME: "/config" })).toBe(
    "/config/fbb/data/opencode-repository-accounts.json",
  )
})

test("requires confirmed usage and rejects any exhausted reported window", () => {
  expect(usageIsAvailable(usage(70, 40))).toBe(true)
  expect(usageIsAvailable(usage(70, null))).toBe(true)
  expect(usageIsAvailable(usage(null, 40))).toBe(true)
  expect(usageIsAvailable(usage(0, 40))).toBe(false)
  expect(usageIsAvailable(usage(70, 0))).toBe(false)
  expect(usageIsAvailable(usage(null, null))).toBe(false)
})

test("selects the first configured alias with confirmed remaining usage", async () => {
  const fixture = await accountFixture({ repositoryAliases: ["jpb", "fbb"] })
  replaceGlobalFetch(async (_input, init) => {
    const accountId = new Headers(init?.headers).get("ChatGPT-Account-Id")
    return Response.json(usageResponse(accountId === fixture.accountIds.jpb ? 100 : 30, 20))
  })

  const selected = await selectRepositoryAccount({
    mappingPath: fixture.mapping,
    paths: fixture.paths,
    repository: "pkdx",
  })

  expect(selected?.source).toBe("mapped")
  expect(selected?.alias).toBe("fbb")
  expect(selected?.credential.accountId).toBe(fixture.accountIds.fbb)
  expect(selected?.warnings).toContain("configured OpenAI alias has no confirmed remaining usage: jpb")
})

test("falls back to the startup openai profile when no configured account is usable", async () => {
  const fixture = await accountFixture({ repositoryAliases: ["jpb"] })
  replaceGlobalFetch(async () => Response.json(usageResponse(100, 100)))

  const selected = await selectRepositoryAccount({
    mappingPath: fixture.mapping,
    paths: fixture.paths,
    repository: "pkdx",
  })

  expect(selected?.source).toBe("fallback")
  expect(selected?.profileKey).toBe("openai")
  expect(selected?.credential.accountId).toBe(fixture.accountIds.fbb)
})

test("rewrites Codex requests and replaces credential headers without changing the body", async () => {
  const requests: Array<{ body: string | null; headers: Headers; method: string | undefined; url: string }> = []
  const fetch = createCodexFetch({
    credential: credential("selected", Date.now() + 60_000),
    paths: pathsFor("/unused"),
    fetch: async (input, init) => {
      requests.push({
        body: init?.body ? await new Response(init.body).text() : null,
        headers: new Headers(init?.headers),
        method: init?.method,
        url: String(input),
      })
      return new Response("ok")
    },
  })
  const body = '{ "stream": true, "input": "æøå" }'

  await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    body,
    headers: { Authorization: "Bearer wrong", "x-opencode-title": "true", "session-id": "session-a" },
  })

  expect(requests).toHaveLength(1)
  expect(requests[0].url).toBe("https://chatgpt.com/backend-api/codex/responses")
  expect(requests[0].body).toBe(body)
  expect(requests[0].method).toBe("POST")
  expect(requests[0].headers.get("authorization")).toBe("Bearer access-selected")
  expect(requests[0].headers.get("ChatGPT-Account-Id")).toBe("selected")
  expect(requests[0].headers.get("session-id")).toBe("session-a")
  expect(requests[0].headers.has("x-opencode-title")).toBe(false)
})

test("rejects unknown OpenAI OAuth destinations before sending credentials", async () => {
  let requested = false
  const fetch = createCodexFetch({
    credential: credential("selected", Date.now() + 60_000),
    paths: pathsFor("/unused"),
    fetch: async () => {
      requested = true
      return new Response()
    },
  })

  expect(fetch("https://example.com/models")).rejects.toThrow("unsupported OpenAI OAuth request destination")
  expect(requested).toBe(false)
})

test("enables OpenAI only after installing an isolated fallback transport", async () => {
  const fixture = await pluginFixture()
  const serverUrl = new URL("http://127.0.0.1:43123")
  const plugin = await OpenAIAccountSelectorPlugin({
    $: originShell("git@github.com:org/pkdx.git"),
    client: { app: { log: async () => Promise.reject(new Error("logging unavailable")) } },
    directory: fixture.worktree,
    project: { worktree: fixture.worktree },
    serverUrl,
  } as never)
  const config: {
    disabled_providers: string[]
    provider: Record<string, { options: Record<string, unknown> }>
  } = {
    disabled_providers: ["github-models", "openai"],
    provider: { openai: { options: { preserved: true } } },
  }

  await plugin.config?.(config as never)

  expect(config.disabled_providers).toEqual(["github-models"])
  expect(config.provider.openai.options.preserved).toBe(true)
  expect(config.provider.openai.options.apiKey).toBe("opencode-oauth-dummy-key")
  expect(config.provider.openai.options.fetch).toBeFunction()
  expect(await readProfileState(fixture.worktree, "http://localhost:43123/")).toEqual({
    profile: "default",
    repository: "pkdx",
  })
  await plugin.dispose?.()
  expect(await readProfileState(fixture.worktree, serverUrl)).toBeUndefined()
})

test("keeps OpenAI disabled when WebSocket transport is requested", async () => {
  process.env.OPENCODE_EXPERIMENTAL_WEBSOCKETS = "true"
  const plugin = await OpenAIAccountSelectorPlugin({
    $: originShell("git@github.com:org/pkdx.git"),
    client: { app: { log: async () => undefined } },
    directory: "/work/pkdx",
    project: { worktree: "/work/pkdx" },
    serverUrl: new URL("http://127.0.0.1:43124"),
  } as never)
  const config = { disabled_providers: [] as string[] }

  await plugin.config?.(config as never)

  expect(config.disabled_providers).toEqual(["openai"])
})

test("publishes internal TUI profile updates with ownership-safe cleanup", async () => {
  const root = await temporaryDirectory()
  const directory = join(root, "project")
  process.env.XDG_RUNTIME_DIR = join(root, "runtime")
  await mkdir(directory, { recursive: true })
  let resolveChange: (() => void) | undefined
  const changed = new Promise<void>((resolve) => {
    resolveChange = resolve
  })
  const stopWatching = await watchProfileState(directory, "http://opencode.internal", () => resolveChange?.())

  await writeProfileState(directory, "http://localhost:4096", {
    owner: "owner-a",
    profile: "jpb",
    repository: "pkdx",
  })
  await changed

  expect(await readProfileState(directory, "http://opencode.internal")).toEqual({ profile: "jpb", repository: "pkdx" })
  await removeProfileState(directory, "http://localhost:4096", "owner-b")
  expect(await readProfileState(directory, "http://opencode.internal")).toEqual({ profile: "jpb", repository: "pkdx" })
  await removeProfileState(directory, "http://localhost:4096", "owner-a")
  expect(await readProfileState(directory, "http://opencode.internal")).toBeUndefined()
  stopWatching()
})

test("preserves Request input method, body, and headers", async () => {
  const requests: Array<{ body: string; headers: Headers; method: string | undefined }> = []
  const fetch = createCodexFetch({
    credential: credential("selected", Date.now() + 60_000),
    paths: pathsFor("/unused"),
    fetch: async (_input, init) => {
      requests.push({
        body: init?.body ? await new Response(init.body).text() : "",
        headers: new Headers(init?.headers),
        method: init?.method,
      })
      return new Response("ok")
    },
  })

  await fetch(
    new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      body: "request-body",
      headers: { "content-type": "application/json", "x-request": "preserved" },
    }),
  )

  expect(requests[0].method).toBe("POST")
  expect(requests[0].body).toBe("request-body")
  expect(requests[0].headers.get("content-type")).toBe("application/json")
  expect(requests[0].headers.get("x-request")).toBe("preserved")
})

test("refreshes the selected identity in place after profile keys move", async () => {
  const root = await temporaryDirectory()
  const paths = pathsFor(root)
  await mkdir(join(root, "state"), { recursive: true })
  await writeFile(
    paths.auth,
    JSON.stringify({
      openai: authEntry("other", Date.now() + 60_000),
      openai_1: authEntry("selected", 0),
      anthropic: { type: "api", key: "preserved" },
    }),
  )
  await chmod(paths.auth, 0o644)
  let refreshes = 0
  const requests: Headers[] = []
  const fetch = createCodexFetch({
    credential: credential("selected", 0),
    paths,
    now: () => 1_000,
    fetch: async (input, init) => {
      if (String(input).includes("oauth/token")) {
        refreshes += 1
        return Response.json({
          access_token: jwt("selected"),
          refresh_token: "refresh-selected-new",
          expires_in: 3600,
        })
      }
      requests.push(new Headers(init?.headers))
      return new Response("ok")
    },
  })

  await Promise.all([
    fetch("https://api.openai.com/v1/responses", { method: "POST" }),
    fetch("https://api.openai.com/v1/responses", { method: "POST" }),
  ])

  expect(refreshes).toBe(1)
  expect(requests).toHaveLength(2)
  expect(requests.every((headers) => headers.get("ChatGPT-Account-Id") === "selected")).toBe(true)
  const persisted = JSON.parse(await readFile(paths.auth, "utf8"))
  expect(persisted.openai.accountId).toBe("other")
  expect(persisted.openai_1.accountId).toBe("selected")
  expect(persisted.openai_1.refresh).toBe("refresh-selected-new")
  expect(persisted.anthropic).toEqual({ type: "api", key: "preserved" })
  expect((await stat(paths.auth)).mode & 0o777).toBe(0o600)
})

test("coordinates refresh between independent process-local transports", async () => {
  const root = await temporaryDirectory()
  const paths = pathsFor(root)
  await mkdir(join(root, "state"), { recursive: true })
  await writeFile(paths.auth, JSON.stringify({ openai: authEntry("selected", 0) }))
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })
  let refreshes = 0
  const request = async (input: RequestInfo | URL) => {
    if (String(input).includes("oauth/token")) {
      refreshes += 1
      await refreshGate
      return Response.json({
        access_token: jwt("selected"),
        refresh_token: "refresh-selected-new",
        expires_in: 3600,
      })
    }
    return new Response("ok")
  }
  const first = createCodexFetch({ credential: credential("selected", 0), paths, fetch: request, now: () => 1_000 })
  const second = createCodexFetch({ credential: credential("selected", 0), paths, fetch: request, now: () => 1_000 })

  const firstRequest = first("https://api.openai.com/v1/responses", { method: "POST" })
  await waitFor(() => refreshes === 1)
  const secondRequest = second("https://api.openai.com/v1/responses", { method: "POST" })
  releaseRefresh?.()

  expect((await Promise.all([firstRequest, secondRequest])).map((response) => response.status)).toEqual([200, 200])
  expect(refreshes).toBe(1)
})

test("continues with a refreshed in-memory credential when persistence fails", async () => {
  const root = await temporaryDirectory()
  const paths = pathsFor(root)
  await mkdir(join(root, "state"), { recursive: true })
  await writeFile(paths.auth, JSON.stringify({ openai: authEntry("selected", 0) }))
  const warnings: string[] = []
  let refreshes = 0
  let requests = 0
  const fetch = createCodexFetch({
    credential: credential("selected", 0),
    paths,
    now: () => 1_000,
    onWarning: (message) => {
      warnings.push(message)
    },
    fetch: async (input) => {
      if (String(input).includes("oauth/token")) {
        refreshes += 1
        await chmod(root, 0o500)
        return Response.json({
          access_token: jwt("selected"),
          refresh_token: "refresh-selected-new",
          expires_in: 3600,
        })
      }
      requests += 1
      return new Response("ok")
    },
  })

  try {
    await fetch("https://api.openai.com/v1/responses", { method: "POST" })
    await fetch("https://api.openai.com/v1/responses", { method: "POST" })
  } finally {
    await chmod(root, 0o700)
  }

  expect(refreshes).toBe(1)
  expect(requests).toBe(2)
  expect(warnings.some((warning) => warning.includes("persistence failed"))).toBe(true)
})

test("rejects refresh expiries outside the supported lifetime", async () => {
  const root = await temporaryDirectory()
  const paths = pathsFor(root)
  await mkdir(join(root, "state"), { recursive: true })
  await writeFile(paths.auth, JSON.stringify({ openai: authEntry("selected", 0) }))
  const fetch = createCodexFetch({
    credential: credential("selected", 0),
    paths,
    now: () => 1_000,
    fetch: async () =>
      Response.json({
        access_token: jwt("selected"),
        refresh_token: "refresh-selected-new",
        expires_in: Number.MAX_VALUE,
      }),
  })

  expect(fetch("https://api.openai.com/v1/responses", { method: "POST" })).rejects.toThrow(
    "OpenAI OAuth refresh returned an invalid expiry",
  )
})

function usage(primary: number | null, secondary: number | null): AccountUsage {
  return {
    primary: { remainingPercent: primary, resetAt: null },
    secondary: { remainingPercent: secondary, resetAt: null },
  }
}

function usageResponse(primaryUsed: number, secondaryUsed: number) {
  return {
    rate_limit: {
      primary_window: { used_percent: primaryUsed, reset_after_seconds: 60 },
      secondary_window: { used_percent: secondaryUsed, reset_after_seconds: 120 },
    },
  }
}

async function accountFixture({ repositoryAliases }: { repositoryAliases: string[] }) {
  const root = await temporaryDirectory()
  const paths = pathsFor(root)
  const accountIds = { fbb: "00000000-0000-0000-0000-00000000fbb0", jpb: "00000000-0000-0000-0000-00000000jpb0" }
  await mkdir(join(root, "state"), { recursive: true })
  await writeFile(paths.auth, JSON.stringify({ openai: authEntry(accountIds.fbb), openai_1: authEntry(accountIds.jpb) }))
  await writeFile(
    paths.aliases,
    JSON.stringify({
      openai: {
        [generatedLabelFor(accountIds.fbb)]: "fbb",
        [generatedLabelFor(accountIds.jpb)]: "jpb",
      },
    }),
  )
  const mapping = join(root, "mapping.json")
  await writeFile(mapping, JSON.stringify({ pkdx: repositoryAliases }))
  return { accountIds, mapping, paths }
}

async function pluginFixture() {
  const root = await temporaryDirectory()
  const data = join(root, "data")
  const config = join(root, "config")
  const state = join(root, "state")
  const cache = join(root, "cache")
  const worktree = join(root, "worktree")
  process.env.XDG_DATA_HOME = data
  process.env.XDG_CONFIG_HOME = config
  process.env.XDG_STATE_HOME = state
  process.env.XDG_CACHE_HOME = cache
  process.env.XDG_RUNTIME_DIR = join(root, "runtime")
  await Promise.all([
    mkdir(join(data, "opencode"), { recursive: true }),
    mkdir(join(config, "fbb", "data"), { recursive: true }),
    mkdir(worktree, { recursive: true }),
  ])
  const accountId = "00000000-0000-0000-0000-00000000fbb0"
  await writeFile(join(data, "opencode", "auth.json"), JSON.stringify({ openai: authEntry(accountId) }))
  await writeFile(
    join(config, "fbb", "data", "account-aliases.json"),
    JSON.stringify({ openai: { [generatedLabelFor(accountId)]: "fbb" } }),
  )
  await writeFile(join(config, "fbb", "data", "opencode-repository-accounts.json"), JSON.stringify({ pkdx: [] }))
  return { worktree }
}

function originShell(origin: string) {
  return () => ({
    cwd: () => ({
      quiet: () => ({ text: () => origin }),
    }),
  })
}

function pathsFor(root: string): AccountPaths {
  return {
    auth: join(root, "auth.json"),
    aliases: join(root, "aliases.json"),
    state: join(root, "state", "transaction.json"),
    queryCacheDirectory: join(root, "cache"),
  }
}

function authEntry(accountId: string, expires = Date.now() + 60_000) {
  return { type: "oauth", accountId, access: jwt(accountId), refresh: `refresh-${accountId}`, expires }
}

function credential(accountId: string, expires: number) {
  return { accountId, access: `access-${accountId}`, refresh: `refresh-${accountId}`, expires }
}

function jwt(accountId: string) {
  const claims = { "https://api.openai.com/auth": { chatgpt_account_id: accountId } }
  return `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openai-account-selector-"))
  temporaryDirectories.push(directory)
  return directory
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000
  while (predicate() === false) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for condition")
    await Bun.sleep(1)
  }
}

function replaceGlobalFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(handler, { preconnect: () => undefined })
}
