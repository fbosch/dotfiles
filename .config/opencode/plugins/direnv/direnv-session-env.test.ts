import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, test } from "bun:test"
import * as direnvPlugin from "./direnv-session-env"
import { loadDirenvEnvironment } from "./direnv-environment"

const { DirenvSessionEnvironmentPlugin } = direnvPlugin

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const projectDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-direnv-"))
  directories.push(directory)
  return directory
}

test("exports only the plugin factory", () => {
  expect(Object.keys(direnvPlugin)).toEqual(["DirenvSessionEnvironmentPlugin"])
})

test("skips projects without an envrc without invoking direnv", async () => {
  const project = await projectDirectory()
  let invoked = false

  const result = await loadDirenvEnvironment(project, project, async () => {
    invoked = true
    throw new Error("direnv should not run")
  })

  expect(result).toEqual({ status: "missing" })
  expect(invoked).toBe(false)
})

test("silently skips when direnv is unavailable", async () => {
  const project = await projectDirectory()
  await writeFile(join(project, ".envrc"), "")

  const result = await loadDirenvEnvironment(project, project, async () => {
    throw new Error("direnv not found")
  })

  expect(result).toEqual({ status: "unavailable" })
})

test("reports blocked envrcs without exporting their environment", async () => {
  const project = await projectDirectory()
  await writeFile(join(project, ".envrc"), "")

  const result = await loadDirenvEnvironment(project, project, async () => {
    throw { stderr: "direnv: error .envrc is blocked" }
  })

  expect(result).toEqual({ status: "blocked" })
})

test("loads structured exports from the nearest envrc inside the project", async () => {
  const project = await projectDirectory()
  const child = join(project, "child")
  await mkdir(child)
  await writeFile(join(project, ".envrc"), "")

  let invokedFrom: string | undefined
  const result = await loadDirenvEnvironment(child, project, async (directory) => {
    invokedFrom = directory
    return JSON.stringify({ PROJECT_TOKEN: "test-value", REMOVED_VALUE: null })
  })

  expect(invokedFrom).toBe(project)
  expect(result).toEqual({
    status: "loaded",
    environment: { PROJECT_TOKEN: "test-value", REMOVED_VALUE: null },
  })
})

test("injects an allowed environment into the creating session's shells", async () => {
  const project = await projectDirectory()
  await writeFile(join(project, ".envrc"), "")

  const shell = () => ({
    cwd: () => ({
      quiet: () => ({ text: async () => JSON.stringify({ PROJECT_TOKEN: "test-value", REMOVED_VALUE: null }) }),
    }),
  })
  const plugin = await DirenvSessionEnvironmentPlugin({
    client: { tui: { showToast: async () => undefined } },
    project: { worktree: project },
    $: shell,
  } as never)

  await plugin.event?.({
    event: { type: "session.created", properties: { info: { id: "session-a", directory: project } } },
  } as never)

  const sessionEnvironment = { env: { REMOVED_VALUE: "inherited" } }
  await plugin["shell.env"]?.({ cwd: project, sessionID: "session-a" }, sessionEnvironment)
  expect(sessionEnvironment.env).toEqual({ PROJECT_TOKEN: "test-value" })

  const unscopedEnvironment = { env: {} }
  await plugin["shell.env"]?.({ cwd: project }, unscopedEnvironment)
  expect(unscopedEnvironment.env).toEqual({})
})

test("lazily loads the environment for a restored session", async () => {
  const project = await projectDirectory()
  await writeFile(join(project, ".envrc"), "")
  let exports = 0
  const shell = () => ({
    cwd: () => ({
      quiet: () => ({
        text: async () => {
          exports += 1
          return JSON.stringify({ DEVENV_ROOT: project })
        },
      }),
    }),
  })
  const plugin = await DirenvSessionEnvironmentPlugin({
    client: { tui: { showToast: async () => undefined } },
    project: { worktree: project },
    $: shell,
  } as never)

  const environment = { env: {} }
  await plugin["shell.env"]?.({ cwd: project, sessionID: "restored" }, environment)
  await plugin["shell.env"]?.({ cwd: project, sessionID: "restored" }, environment)

  expect(exports).toBe(1)
  expect(environment.env).toEqual({ DEVENV_ROOT: project })
})

test("notifies the user when an envrc is blocked without injecting it", async () => {
  const project = await projectDirectory()
  await writeFile(join(project, ".envrc"), "")
  const notices: unknown[] = []
  const shell = () => ({
    cwd: () => ({
      quiet: () => ({ text: async () => Promise.reject({ stderr: "direnv: error .envrc is blocked" }) }),
    }),
  })
  const plugin = await DirenvSessionEnvironmentPlugin({
    client: { tui: { showToast: async (notice: unknown) => notices.push(notice) } },
    project: { worktree: project },
    $: shell,
  } as never)

  await plugin.event?.({
    event: { type: "session.created", properties: { info: { id: "blocked", directory: project } } },
  } as never)

  expect(notices).toEqual([
    { body: { message: "direnv: .envrc is blocked. Run `direnv allow` to enable it.", variant: "warning" } },
  ])
  const environment = { env: {} }
  await plugin["shell.env"]?.({ cwd: project, sessionID: "blocked" }, environment)
  expect(environment.env).toEqual({})
})
