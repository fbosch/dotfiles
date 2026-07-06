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
