import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { executeReadonlyTool } from "./core"
import type { CommandRunner } from "./command"

function runnerWithHypr(outputs: Record<string, string>, commands: string[] = ["grim"]): CommandRunner {
  return {
    async execFile(command, args) {
      return { stdout: `${command} ${args.join(" ")}`, stderr: "" }
    },
    async commandExists(command) {
      return commands.includes(command)
    },
    async hyprQuery(request) {
      return outputs[request] ?? ""
    },
  }
}

const activeWindow = JSON.stringify({
  address: "0xabc",
  class: "Alacritty",
  title: "Shell",
})

const clients = JSON.stringify([
  {
    address: "0xabc",
    stableId: "stable-abc",
    class: "Alacritty",
    title: "Shell",
    pid: 123,
    at: [10, 20],
    size: [800, 600],
    workspace: { id: 1, name: "1" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const monitors = JSON.stringify([
  {
    id: 0,
    name: "DP-1",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scale: 1,
    focused: true,
    activeWorkspace: { id: 1, name: "1" },
  },
])

const workspaces = JSON.stringify([{ id: 1, name: "1" }])

const hyprOutputs = {
  "j/activewindow": activeWindow,
  "j/clients": clients,
  "j/monitors": monitors,
  "j/workspaces": workspaces,
}

test("state mode returns read-only Hyprland state and metadata evidence", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-test-"))
  const result = await executeReadonlyTool(
    { mode: "state", evidenceDir },
    { runner: runnerWithHypr(hyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("state" in result)) throw new Error("expected state success")
  const state = result.state
  if (!state) throw new Error("expected state")
  expect(state.clients[0]?.address).toBe("abc")
  expect(result.evidence.target?.class).toBe("Alacritty")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"operation": "state"')
  expect(evidence).not.toContain("data:image")
})

test("snapshot mode fails closed when active window is absent", async () => {
  const result = await executeReadonlyTool(
    { mode: "snapshot" },
    {
      runner: runnerWithHypr({
        ...hyprOutputs,
        "j/activewindow": "{}",
      }),
    },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("target" in result)) throw new Error("expected snapshot success")
  expect(result.target).toBeNull()
})

test("capture mode rejects region capture without explicit geometry", async () => {
  const result = await executeReadonlyTool(
    { mode: "capture", scope: "region" },
    { runner: runnerWithHypr(hyprOutputs) },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("region-required")
})

test("capture mode rejects full desktop without explicit opt-in", async () => {
  const result = await executeReadonlyTool(
    { mode: "capture", scope: "full" },
    { runner: runnerWithHypr(hyprOutputs) },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("full-capture-not-allowed")
})

test("side-effecting modes are rejected", async () => {
  const result = await executeReadonlyTool(
    { mode: "click" },
    { runner: runnerWithHypr(hyprOutputs) },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("rejected-side-effect")
})

describe("capture backend detection", () => {
  test("missing grim returns missing-backend", async () => {
    const result = await executeReadonlyTool(
      { mode: "capture", scope: "active-window" },
      { runner: runnerWithHypr(hyprOutputs, []) },
    )

    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error("expected failure")
    expect(result.error.code).toBe("missing-backend")
  })
})
