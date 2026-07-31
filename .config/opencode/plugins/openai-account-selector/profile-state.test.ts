import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { readProfileState, writeProfileState } from "./profile-state"

test("shares profile state when server and TUI runtime directories differ", async () => {
  const root = await mkdtemp(join(tmpdir(), "openai-profile-state-"))
  const stateHome = join(root, "state")
  const serverRuntime = join(root, "server-runtime")
  const tuiRuntime = join(root, "tui-runtime")
  const directory = join(root, "project")
  const serverUrl = "http://127.0.0.1:43127"
  const serverEnv = {
    HOME: root,
    XDG_STATE_HOME: stateHome,
    XDG_RUNTIME_DIR: serverRuntime,
  }
  const tuiEnv = {
    HOME: root,
    XDG_STATE_HOME: stateHome,
    XDG_RUNTIME_DIR: tuiRuntime,
  }

  try {
    await writeProfileState(
      directory,
      serverUrl,
      { owner: "server", profile: "kk", repository: "KommuneKredit.Frontend" },
      serverEnv,
    )

    await expect(readProfileState(directory, serverUrl, tuiEnv)).resolves.toEqual({
      profile: "kk",
      repository: "KommuneKredit.Frontend",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
