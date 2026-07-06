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

function recordingRunnerWithHypr(states: Record<string, string>[], commands: string[] = ["grim"]) {
  const calls: { command: string; args: string[] }[] = []
  const hyprRequests: string[] = []
  const requestCounts: Record<string, number> = {}

  const runner: CommandRunner = {
    async execFile(command, args) {
      calls.push({ command, args })
      return { stdout: `${command} ${args.join(" ")}`, stderr: "" }
    },
    async commandExists(command) {
      return commands.includes(command)
    },
    async hyprQuery(request) {
      hyprRequests.push(request)
      const count = requestCounts[request] ?? 0
      requestCounts[request] = count + 1
      const state = states[Math.min(count, states.length - 1)]
      return state[request] ?? ""
    },
  }

  return { runner, calls, hyprRequests }
}

function recordingRunnerWithExec(
  states: Record<string, string>[],
  commands: string[],
  exec: (command: string, args: string[]) => { stdout?: string; stderr?: string } | undefined,
) {
  const calls: { command: string; args: string[] }[] = []
  const hyprRequests: string[] = []
  const requestCounts: Record<string, number> = {}

  const runner: CommandRunner = {
    async execFile(command, args) {
      calls.push({ command, args })
      const result = exec(command, args)
      return { stdout: result?.stdout ?? `${command} ${args.join(" ")}`, stderr: result?.stderr ?? "" }
    },
    async commandExists(command) {
      return commands.includes(command)
    },
    async hyprQuery(request) {
      hyprRequests.push(request)
      const count = requestCounts[request] ?? 0
      requestCounts[request] = count + 1
      const state = states[Math.min(count, states.length - 1)]
      return state[request] ?? ""
    },
  }

  return { runner, calls, hyprRequests }
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

const notesActiveWindow = JSON.stringify({
  address: "0xdef",
  class: "NotesApp",
  title: "Planning Notes",
})

const notesClients = JSON.stringify([
  {
    address: "0xdef",
    stableId: "stable-def",
    class: "NotesApp",
    title: "Planning Notes",
    pid: 456,
    at: [50, 60],
    size: [900, 700],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const notesHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": notesActiveWindow,
  "j/clients": notesClients,
}

const gameActiveWindow = JSON.stringify({
  address: "0x999",
  class: "steam_app_default",
  title: "infinitefusion",
})

const gameClients = JSON.stringify([
  {
    address: "0x999",
    stableId: "stable-game",
    class: "steam_app_default",
    title: "infinitefusion",
    pid: 2302472,
    at: [300, 400],
    size: [1280, 720],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const gameHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": gameActiveWindow,
  "j/clients": gameClients,
}

const terminalActiveGameClients = JSON.stringify([
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
  {
    address: "0x999",
    stableId: "stable-game",
    class: "steam_app_default",
    title: "infinitefusion",
    pid: 2302472,
    at: [300, 400],
    size: [1280, 720],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const terminalActiveGameHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": activeWindow,
  "j/clients": terminalActiveGameClients,
}

const driftedGameClients = JSON.stringify([
  {
    address: "0x999",
    stableId: "stable-game",
    class: "DifferentGame",
    title: "infinitefusion",
    pid: 2302472,
    at: [300, 400],
    size: [1280, 720],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const driftedGameHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": gameActiveWindow,
  "j/clients": driftedGameClients,
}

const xwaylandTerminalActiveGameClients = JSON.stringify([
  {
    address: "0xabc",
    stableId: "stable-abc",
    class: "SomeXwaylandApp",
    title: "Other XWayland Window",
    pid: 123,
    at: [10, 20],
    size: [800, 600],
    workspace: { id: 1, name: "1" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
    xwayland: true,
  },
  {
    address: "0x999",
    stableId: "stable-game",
    class: "steam_app_default",
    title: "infinitefusion",
    pid: 2302472,
    at: [300, 400],
    size: [1280, 720],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
    xwayland: true,
  },
])

const xwaylandGameClients = JSON.stringify([
  {
    address: "0x999",
    stableId: "stable-game",
    class: "steam_app_default",
    title: "infinitefusion",
    pid: 2302472,
    at: [300, 400],
    size: [1280, 720],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
    xwayland: true,
  },
])

const xwaylandGameHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": gameActiveWindow,
  "j/clients": xwaylandGameClients,
}

const xwaylandTerminalActiveGameHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": activeWindow,
  "j/clients": xwaylandTerminalActiveGameClients,
}

const approvedGameTarget = {
  stableId: "stable-game",
  address: "999",
  class: "steam_app_default",
  title: "infinitefusion",
  workspace: { id: 2, name: "2" },
  monitor: 0,
  monitorName: "DP-1",
}

const ambiguousNotesClients = JSON.stringify([
  {
    address: "0xdef",
    stableId: "stable-def",
    class: "NotesApp",
    title: "Planning Notes",
    pid: 456,
    at: [50, 60],
    size: [900, 700],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
  {
    address: "0x123",
    stableId: "stable-123",
    class: "NotesApp",
    title: "Scratch Notes",
    pid: 457,
    at: [80, 90],
    size: [900, 700],
    workspace: { id: 2, name: "2" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const ambiguousNotesHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": notesActiveWindow,
  "j/clients": ambiguousNotesClients,
}

const opencodeActiveWindow = JSON.stringify({
  address: "0xaaa",
  class: "OpenCode",
  title: "OpenCode Tool Permission",
})

const opencodeClients = JSON.stringify([
  {
    address: "0xaaa",
    stableId: "stable-aaa",
    class: "OpenCode",
    title: "OpenCode Tool Permission",
    pid: 789,
    at: [100, 120],
    size: [1000, 800],
    workspace: { id: 3, name: "3" },
    monitor: 0,
    mapped: true,
    floating: true,
    fullscreen: 0,
  },
])

const opencodeHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": opencodeActiveWindow,
  "j/clients": opencodeClients,
}

const polkitActiveWindow = JSON.stringify({
  address: "0xbbb",
  class: "Polkit-gnome-authentication-agent-1",
  title: "Authentication Required",
})

const polkitClients = JSON.stringify([
  {
    address: "0xbbb",
    stableId: "stable-bbb",
    class: "Polkit-gnome-authentication-agent-1",
    title: "Authentication Required",
    pid: 987,
    at: [140, 160],
    size: [520, 260],
    workspace: { id: 3, name: "3" },
    monitor: 0,
    mapped: true,
    floating: true,
    fullscreen: 0,
  },
])

const polkitHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": polkitActiveWindow,
  "j/clients": polkitClients,
}

const zenActiveWindow = JSON.stringify({
  address: "0xccc",
  class: "app.zen_browser.zen",
  title: "Example Page — Zen Browser",
})

const zenClients = JSON.stringify([
  {
    address: "0xccc",
    stableId: "stable-ccc",
    class: "app.zen_browser.zen",
    title: "Example Page — Zen Browser",
    pid: 654,
    at: [200, 220],
    size: [1200, 900],
    workspace: { id: 4, name: "4" },
    monitor: 0,
    mapped: true,
    floating: false,
    fullscreen: 0,
  },
])

const zenHyprOutputs = {
  ...hyprOutputs,
  "j/activewindow": zenActiveWindow,
  "j/clients": zenClients,
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

test("keyboard mode rejects free-form text before Hyprland or backend access", async () => {
  const { runner, calls, hyprRequests } = recordingRunnerWithHypr([gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    { mode: "keyboard", text: "hello world" },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("text-input-unsupported")
  expect(calls.length).toBe(0)
  expect(hyprRequests.length).toBe(0)
})

test("keyboard mode rejects unsupported chords before Hyprland or backend access", async () => {
  const { runner, calls, hyprRequests } = recordingRunnerWithHypr([gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    { mode: "keyboard", chord: "Hyper+S" },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("unsupported-key")
  expect(calls.length).toBe(0)
  expect(hyprRequests.length).toBe(0)
})

test("keyboard mode requires explicit one-turn approval for unknown game targets", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-keyboard-approval-test-"))
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      evidenceDir,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("approval-required")
  const details = result.error.details as Record<string, unknown>
  expect(String(details.reason)).toBe("approval-required")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_shortcut"))).toBe(false)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state"))).toBe(false)

  if (!("evidence" in result)) throw new Error("expected rejection evidence")
  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "approval-required"')
  expect(evidence).toContain('"state": "ask"')
  expect(evidence).not.toContain("data:image")
})

test("keyboard mode rejects denied terminal targets before backend invocation", async () => {
  const { runner, calls } = recordingRunnerWithHypr([hyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "Enter",
      approvedTarget: {
        stableId: "stable-abc",
        address: "abc",
        class: "Alacritty",
        title: "Shell",
        workspace: { id: 1, name: "1" },
        monitor: 0,
        monitorName: "DP-1",
      },
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send Enter to the terminal",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("rejected-side-effect")
  const details = result.error.details as Record<string, unknown>
  expect(String(details.reason)).toBe("terminal-gui")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_shortcut"))).toBe(false)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state"))).toBe(false)
})

test("keyboard mode rejects unsafe approval states before backend invocation", async () => {
  const cases = [
    {
      outputs: opencodeHyprOutputs,
      reason: "self-target",
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "approve the tool permission dialog",
    },
    {
      outputs: polkitHyprOutputs,
      reason: "privileged-prompt",
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "enter the password",
    },
    {
      outputs: zenHyprOutputs,
      reason: "browser-page-interaction",
      requestedRoute: "browser page interaction",
      actionSummary: "navigate to a page",
    },
    {
      outputs: notesHyprOutputs,
      reason: "sensitive-context",
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "update the account payment method",
    },
  ]

  for (const testCase of cases) {
    const { runner, calls } = recordingRunnerWithHypr([testCase.outputs], ["grim", "hyprctl"])
    const result = await executeReadonlyTool(
      {
        mode: "keyboard",
        key: "Enter",
        requestedRoute: testCase.requestedRoute,
        actionSummary: testCase.actionSummary,
      },
      { runner },
    )

    expect(result.ok).toBe(false)
    if (result.ok === true) throw new Error("expected failure")
    expect(result.error.code).toBe("rejected-side-effect")
    const details = result.error.details as Record<string, unknown>
    expect(String(details.reason)).toBe(testCase.reason)
    expect(calls.some((call) => call.command === "hyprctl")).toBe(false)
  }
})

test("keyboard mode fails closed when the Hyprland keyboard backend is unavailable", async () => {
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs, gameHyprOutputs], ["grim"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("no-input-backend")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_shortcut"))).toBe(false)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state"))).toBe(false)
  expect(calls.some((call) => call.command === "grim")).toBe(true)
})

test("keyboard mode rejects missing approved target before backend invocation", async () => {
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs, hyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("target-drift")
  const details = result.error.details
  if (!("reason" in details)) throw new Error("expected reason detail")
  expect(String(details.reason)).toBe("missing-target")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_shortcut"))).toBe(false)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state"))).toBe(false)
})

test("keyboard mode rejects approved target identity drift before backend invocation", async () => {
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs, driftedGameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("target-drift")
  const details = result.error.details
  if (!("reason" in details)) throw new Error("expected reason detail")
  expect(String(details.reason)).toBe("target-drift")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_shortcut"))).toBe(false)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state"))).toBe(false)
})

test("keyboard mode dispatches to approved target even when another window is active", async () => {
  const { runner, calls } = recordingRunnerWithHypr([terminalActiveGameHyprOutputs, gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("keyboard" in result)) throw new Error("expected keyboard success")
  const keyboard = result.keyboard
  if (!keyboard) throw new Error("expected keyboard result")
  expect(keyboard.target.class).toBe("steam_app_default")
  expect(keyboard.selector).toBe("stableid:stable-game")

  const hyprctlCalls = calls.filter((call) => call.command === "hyprctl")
  expect(hyprctlCalls.length).toBe(2)
  expect(hyprctlCalls[0]?.args.join(" ")).toContain("hl.dsp.focus")
  expect(hyprctlCalls[1]?.args.join(" ")).toContain("hl.dsp.send_shortcut")
  expect(hyprctlCalls.every((call) => call.args.join(" ").includes('window = "stableid:stable-game"'))).toBe(true)
})

test("keyboard mode rejects XWayland targets when hyprctl is unavailable", async () => {
  const { runner, calls } = recordingRunnerWithHypr([xwaylandGameHyprOutputs, xwaylandTerminalActiveGameHyprOutputs], ["grim"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("no-input-backend")
  const details = result.error.details
  if (!("reason" in details)) throw new Error("expected reason detail")
  expect(String(details.reason)).toBe("no-input-backend")
  expect(calls.some((call) => call.command === "hyprctl")).toBe(false)
})

test("keyboard mode focuses XWayland targets and sends key-state down/up", async () => {
  const { runner, calls } = recordingRunnerWithExec(
    [xwaylandTerminalActiveGameHyprOutputs, xwaylandGameHyprOutputs],
    ["grim", "hyprctl"],
    () => ({ stdout: "" }),
  )

  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "W",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send W to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("keyboard" in result)) throw new Error("expected keyboard success")
  const keyboard = result.keyboard
  if (!keyboard) throw new Error("expected keyboard result")
  expect(keyboard.backend).toBe("hyprland-key-state")
  expect(keyboard.selector).toBe("stableid:stable-game")
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes("hl.dsp.focus"))).toBe(true)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes('state = "down"'))).toBe(true)
  expect(calls.some((call) => call.command === "hyprctl" && call.args.join(" ").includes('state = "up"'))).toBe(true)
  expect(calls.some((call) => call.command === "wtype" || call.command === "xdotool")).toBe(false)
})

test("keyboard-plan mode runs approved XWayland steps with captures", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-keyboard-plan-test-"))
  const { runner, calls } = recordingRunnerWithExec(
    [
      xwaylandGameHyprOutputs,
      xwaylandGameHyprOutputs,
      xwaylandGameHyprOutputs,
      xwaylandGameHyprOutputs,
      xwaylandGameHyprOutputs,
      xwaylandGameHyprOutputs,
    ],
    ["grim", "hyprctl"],
    () => ({ stdout: "" }),
  )

  const result = await executeReadonlyTool(
    {
      mode: "keyboard-plan",
      approvedTarget: approvedGameTarget,
      targetHint: "infinitefusion",
      evidenceDir,
      steps: [
        { action: "next tab", key: "ArrowRight", waitMs: 1 },
        { action: "next tab", key: "ArrowRight", waitMs: 1 },
      ],
    },
    { runner },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("plan" in result)) throw new Error("expected keyboard plan success")
  const plan = result.plan
  if (!plan) throw new Error("expected keyboard plan result")
  expect(plan.steps.length).toBe(2)
  expect(plan.steps[0]?.keyboard.backend).toBe("hyprland-key-state")
  expect(calls.filter((call) => call.command === "grim").length).toBe(4)
  expect(calls.filter((call) => call.command === "hyprctl" && call.args.join(" ").includes("send_key_state")).length).toBe(4)

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"operation": "keyboard-plan"')
  expect(evidence).toContain('"action": "next tab"')
})

test("keyboard-plan mode rejects plans above one hundred steps before Hyprland or backend access", async () => {
  const { runner, calls, hyprRequests } = recordingRunnerWithHypr([gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard-plan",
      approvedTarget: approvedGameTarget,
      steps: Array.from({ length: 101 }, () => ({ key: "ArrowRight" })),
    },
    { runner },
  )

  expect(result.ok).toBe(false)
  if (result.ok === true) throw new Error("expected failure")
  expect(result.error.code).toBe("unsupported-key")
  const details = result.error.details
  if (!("maxPlanSteps" in details)) throw new Error("expected maxPlanSteps detail")
  expect(details.maxPlanSteps).toBe(100)
  expect(calls.length).toBe(0)
  expect(hyprRequests.length).toBe(0)
})

test("keyboard mode dispatches one approved key to the stable target", async () => {
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs, gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      key: "ArrowUp",
      approvedTarget: approvedGameTarget,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send ArrowUp to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("keyboard" in result)) throw new Error("expected keyboard success")
  const keyboard = result.keyboard
  if (!keyboard) throw new Error("expected keyboard result")
  expect(keyboard.input.kind).toBe("key")
  expect(keyboard.dispatch.strokes.length).toBe(1)
  expect(keyboard.dispatch.strokes[0]?.key).toBe("UP")
  expect(keyboard.selector).toBe("stableid:stable-game")

  const hyprctlCalls = calls.filter((call) => call.command === "hyprctl")
  expect(hyprctlCalls.length).toBe(2)
  expect(hyprctlCalls[0]?.args.join(" ")).toContain("hl.dsp.focus")
  expect(hyprctlCalls[1]?.args.join(" ")).toContain('key = "UP"')
  expect(calls.filter((call) => call.command === "grim").length).toBe(2)
})

test("keyboard mode dispatches approved key and chord sequence to the stable target", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-keyboard-success-test-"))
  const { runner, calls } = recordingRunnerWithHypr([gameHyprOutputs, gameHyprOutputs], ["grim", "hyprctl"])
  const result = await executeReadonlyTool(
    {
      mode: "keyboard",
      sequence: ["ArrowUp", "Ctrl+S"],
      approvedTarget: approvedGameTarget,
      evidenceDir,
      requestedRoute: "hyprland-native-keyboard",
      actionSummary: "send a short key sequence to the game",
    },
    { runner },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("keyboard" in result)) throw new Error("expected keyboard success")
  const keyboard = result.keyboard
  if (!keyboard) throw new Error("expected keyboard result")
  expect(keyboard.backend).toBe("hyprland-dispatcher")
  expect(keyboard.selector).toBe("stableid:stable-game")
  expect(keyboard.input.kind).toBe("sequence")
  expect(keyboard.dispatch.strokes.length).toBe(2)

  const hyprctlCalls = calls.filter((call) => call.command === "hyprctl")
  expect(hyprctlCalls.length).toBe(3)
  expect(hyprctlCalls[0]?.args.join(" ")).toContain("hl.dsp.focus")
  expect(hyprctlCalls[1]?.args.join(" ")).toContain("hl.dsp.send_shortcut")
  expect(hyprctlCalls[1]?.args.join(" ")).toContain('window = "stableid:stable-game"')
  expect(hyprctlCalls[2]?.args.join(" ")).toContain('mods = "CTRL"')

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"operation": "keyboard"')
  expect(evidence).toContain('"selector": "stableid:stable-game"')
  expect(evidence).toContain('"afterCapture"')
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode asks for unknown normal app with prompt metadata evidence", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-approval-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "hyprland-native",
      actionSummary: "focus the planning notes window",
    },
    { runner: runnerWithHypr(notesHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("NotesApp")
  expect(approval.identity?.confidence).toBe("partial")
  expect(approval.decision.state).toBe("ask")
  if (approval.decision.state !== "ask") throw new Error("expected ask decision")
  expect(approval.decision.prompt.requestedRoute).toBe("hyprland-native")
  expect(approval.decision.prompt.actionSummary).toBe("focus the planning notes window")
  expect(result.evidence.target?.class).toBe("NotesApp")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"operation": "approval"')
  expect(evidence).toContain('"state": "ask"')
  expect(evidence).not.toContain("data:image")
})

test("controls-cache mode saves controls for a resolved target", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-controls-test-"))
  const controlsCachePath = join(cacheDir, "controls.json")
  const result = await executeReadonlyTool(
    {
      mode: "controls-cache",
      targetHint: "infinitefusion",
      controlsCachePath,
      controls: {
        source: "Essentials controls wiki and Infinite Fusion FAQ",
        notes: "Summary pages use page-up/page-down style bindings.",
        bindings: [
          { action: "summary.previousPage", keys: ["A"], note: "Input::JUMPUP" },
          { action: "summary.nextPage", keys: ["S"], note: "Input::JUMPDOWN" },
          { action: "confirm/use", keys: ["C", "Space", "Enter"] },
          { action: "back/cancel", keys: ["X", "Escape"] },
          { action: "openControls", keys: ["F1"] },
        ],
      },
    },
    { runner: runnerWithHypr(gameHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("controls" in result)) throw new Error("expected controls result")
  if (!result.controls) throw new Error("expected controls profile")
  expect(result.controls.target.class).toBe("steam_app_default")
  expect(result.controls.bindings.length).toBe(5)
  expect(result.controls.bindings[1]?.keys[0]).toBe("S")

  const cache = await readFile(controlsCachePath, "utf8")
  expect(cache).toContain('"cacheKey": "class:steam_app_default|title:infinitefusion"')
  expect(cache).toContain('"action": "summary.nextPage"')
})

test("app-approval mode returns cached controls for the resolved target", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-controls-lookup-test-"))
  const controlsCachePath = join(cacheDir, "controls.json")

  await executeReadonlyTool(
    {
      mode: "controls-cache",
      targetHint: "infinitefusion",
      controlsCachePath,
      controls: {
        source: "Essentials controls wiki",
        bindings: [
          { action: "summary.nextPage", keys: ["S"] },
        ],
      },
    },
    { runner: runnerWithHypr(gameHyprOutputs) },
  )

  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      targetHint: "infinitefusion",
      controlsCachePath,
    },
    { runner: runnerWithHypr(gameHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("controls" in result)) throw new Error("expected approval with controls")
  if (!result.controls) throw new Error("expected cached controls")
  expect(result.controls.bindings[0]?.action).toBe("summary.nextPage")
  expect(result.controls.bindings[0]?.keys[0]).toBe("S")
  expect(result.evidence.controls?.bindings).toBe(result.controls.bindings)
})

test("app-approval mode can capture the resolved target in the same call", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-approval-capture-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "hyprland-native",
      actionSummary: "inspect the planning notes window",
      includeCapture: true,
    },
    { runner: runnerWithHypr(notesHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.decision.state).toBe("ask")
  if (!("capture" in result)) throw new Error("expected capture result")
  expect(result.capture?.scope).toBe("region")
  expect(result.capture?.target?.class).toBe("NotesApp")
  expect(result.capture?.region?.x).toBe(50)
  expect(result.capture?.region?.y).toBe(60)
  expect(result.capture?.region?.width).toBe(900)
  expect(result.capture?.region?.height).toBe(700)

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"operation": "approval"')
  expect(evidence).toContain('"scope": "region"')
  expect(evidence).toContain('"width": 900')
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode denies terminal GUI automation with shell recommendation", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-terminal-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "gui-input",
      actionSummary: "type npm test into the terminal",
    },
    { runner: runnerWithHypr(hyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("Alacritty")
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("terminal-gui")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("shell tools")
  expect(approval.decision.matchedSignals).toContain("alacritty")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "terminal-gui"')
  expect(evidence).toContain("shell tools")
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode denies OpenCode self-target automation", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-self-target-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "gui-input",
      actionSummary: "approve the tool permission dialog",
    },
    { runner: runnerWithHypr(opencodeHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("OpenCode")
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("self-target")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("Do not automate OpenCode")
  expect(approval.decision.matchedSignals).toContain("opencode")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "self-target"')
  expect(evidence).toContain("tool-permission windows")
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode denies privileged prompts", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-privileged-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "gui-input",
      actionSummary: "enter the password",
    },
    { runner: runnerWithHypr(polkitHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("Polkit-gnome-authentication-agent-1")
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("privileged-prompt")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("human handling")
  expect(approval.decision.matchedSignals).toContain("polkit")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "privileged-prompt"')
  expect(evidence).toContain("human handling")
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode denies missing active targets", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-missing-target-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "hyprland-native",
      actionSummary: "focus the target app",
    },
    {
      runner: runnerWithHypr({
        ...hyprOutputs,
        "j/activewindow": "{}",
      }),
    },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.target).toBeNull()
  expect(approval.identity).toBeNull()
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("missing-target")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("Resolve an active app target")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "missing-target"')
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode denies ambiguous app hints with candidates", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-ambiguous-target-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      targetHint: "NotesApp",
      requestedRoute: "hyprland-native",
      actionSummary: "focus the notes app",
    },
    { runner: runnerWithHypr(ambiguousNotesHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.target).toBeNull()
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("ambiguous-target")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.candidates?.length).toBe(2)
  expect(approval.decision.recommendation).toContain("Choose one matching app target")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "ambiguous-target"')
  expect(evidence).toContain("Scratch Notes")
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode classifies sensitive request contexts", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-sensitive-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "hyprland-native",
      actionSummary: "update the account payment method",
    },
    { runner: runnerWithHypr(notesHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("NotesApp")
  expect(approval.decision.state).toBe("sensitive")
  expect(approval.decision.reason).toBe("sensitive-context")
  if (approval.decision.state !== "sensitive") throw new Error("expected sensitive decision")
  expect(approval.decision.matchedSignals).toContain("account")
  expect(approval.decision.matchedSignals).toContain("payment")
  expect(approval.decision.prompt.reason).toContain("requires a stronger gate")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"state": "sensitive"')
  expect(evidence).toContain('"payment"')
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode delegates browser page interaction outside the plugin", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-browser-boundary-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "browser page interaction",
      actionSummary: "navigate to a page and fill form fields",
    },
    { runner: runnerWithHypr(zenHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.identity?.class).toBe("app.zen_browser.zen")
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("browser-page-interaction")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("agent-browser")
  expect(approval.decision.matchedSignals).toContain("browser")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"reason": "browser-page-interaction"')
  expect(evidence).toContain("chrome-devtools")
  expect(evidence).not.toContain("data:image")
})

test("app-approval mode rejects persistent approval mutation", async () => {
  const evidenceDir = await mkdtemp(join(tmpdir(), "hypr-computer-use-persist-approval-test-"))
  const result = await executeReadonlyTool(
    {
      mode: "app-approval",
      evidenceDir,
      requestedRoute: "hyprland-native",
      actionSummary: "always allow notes automation",
      persistApproval: true,
    },
    { runner: runnerWithHypr(notesHyprOutputs) },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("approval" in result)) throw new Error("expected approval success")
  const approval = result.approval
  if (!approval) throw new Error("expected approval report")
  expect(approval.request.persistApproval).toBe(true)
  expect(approval.decision.state).toBe("denied")
  expect(approval.decision.reason).toBe("persistent-approval-unsupported")
  if (approval.decision.state !== "denied") throw new Error("expected denied decision")
  expect(approval.decision.recommendation).toContain("one-time approval")

  const evidence = await readFile(result.evidence.evidencePath, "utf8")
  expect(evidence).toContain('"persistApproval": true')
  expect(evidence).toContain('"reason": "persistent-approval-unsupported"')
  expect(evidence).not.toContain("data:image")
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
