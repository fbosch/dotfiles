import { expect, test } from "bun:test"
import {
  browserTargetReport,
  discoverDefaultBrowser,
  inferBrowserFamily,
  matchBrowserTargets,
  normalizeBrowserIdentity,
  parseDesktopEntry,
} from "./browser"
import { executeReadonlyTool } from "./core"
import type { CommandRunner } from "./command"
import type { HyprlandState } from "./types"

function runner(options: {
  commands?: Record<string, string | Error>
  hypr?: Record<string, string>
}): CommandRunner {
  return {
    async execFile(command, args) {
      const key = `${command} ${args.join(" ")}`
      const value = options.commands?.[key]
      if (value instanceof Error) throw value
      return { stdout: value ?? "", stderr: "" }
    },
    async commandExists() {
      return true
    },
    async hyprQuery(request) {
      return options.hypr?.[request] ?? ""
    },
  }
}

const env = {
  HOME: "/home/test",
  XDG_DATA_HOME: "/home/test/.local/share",
  XDG_DATA_DIRS: "/usr/share:/var/lib/flatpak/exports/share",
}

const zenDesktop = `[Desktop Entry]
Name=Zen Browser
Exec=flatpak run --branch=stable --arch=x86_64 --command=launch-script.sh --file-forwarding app.zen_browser.zen @@u %u @@
StartupWMClass=zen
MimeType=text/html;x-scheme-handler/http;x-scheme-handler/https;
Categories=Network;WebBrowser;
`

const state: HyprlandState = {
  timestamp: "2026-07-03T00:00:00.000Z",
  activeWindow: null,
  monitors: [
    {
      id: 1,
      name: "DP-2",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      scale: 1,
      focused: true,
      activeWorkspace: { id: 2, name: "2" },
    },
  ],
  workspaces: [],
  clients: [
    {
      address: "abc",
      stableId: "stable",
      class: "app.zen_browser.zen",
      title: "Start — Zen Browser",
      pid: 123,
      workspace: { id: 2, name: "2" },
      monitor: 1,
      mapped: true,
      floating: false,
      fullscreen: false,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    },
  ],
}

test("default browser discovery falls back to mimeapps", async () => {
  const result = await discoverDefaultBrowser(
    runner({
      commands: {
        "xdg-settings get default-web-browser": new Error("missing"),
        "xdg-mime query default x-scheme-handler/https": "",
      },
    }),
    {
      env,
      async readFile(path) {
        if (path.endsWith("mimeapps.list")) {
          return `[Default Applications]\nx-scheme-handler/https=app.zen_browser.zen.desktop;\n`
        }
        throw new Error(`unexpected path ${path}`)
      },
    },
  )

  expect(result.desktopId).toBe("app.zen_browser.zen.desktop")
  expect(result.source?.includes("mimeapps:")).toBe(true)
})

test("desktop entry parsing preserves raw exec placeholders", () => {
  const entry = parseDesktopEntry(zenDesktop, "app.zen_browser.zen.desktop", "/apps/app.zen_browser.zen.desktop")

  expect(entry?.name).toBe("Zen Browser")
  expect(entry?.exec).toContain("@@u %u @@")
  expect(entry?.startupWMClass).toBe("zen")
  expect(entry?.mimeTypes.includes("x-scheme-handler/https")).toBe(true)
})

test("browser identity includes flatpak and startup class candidates", () => {
  const entry = parseDesktopEntry(zenDesktop, "app.zen_browser.zen.desktop", "/apps/app.zen_browser.zen.desktop")
  const identity = normalizeBrowserIdentity({ desktopId: "app.zen_browser.zen.desktop", source: "xdg-settings" }, entry)

  expect(identity?.flatpakId).toBe("app.zen_browser.zen")
  expect(identity?.classCandidates.includes("app.zen_browser.zen")).toBe(true)
  expect(identity?.classCandidates.includes("zen")).toBe(true)
})

test("browser identity matches Hyprland clients", () => {
  const entry = parseDesktopEntry(zenDesktop, "app.zen_browser.zen.desktop", "/apps/app.zen_browser.zen.desktop")
  const identity = normalizeBrowserIdentity({ desktopId: "app.zen_browser.zen.desktop", source: "xdg-settings" }, entry)
  const matches = matchBrowserTargets(identity, state)

  expect(matches?.length).toBe(1)
  expect(matches?.[0]?.monitorName).toBe("DP-2")
})

test("browser target report is conservative about automation protocols", async () => {
  const report = await browserTargetReport(
    runner({
      commands: {
        "xdg-settings get default-web-browser": "app.zen_browser.zen.desktop\n",
      },
    }),
    state,
    {
      env,
      async readFile(path) {
        if (path.endsWith("app.zen_browser.zen.desktop")) return zenDesktop
        throw new Error(`unexpected path ${path}`)
      },
    },
  )

  expect(report.capabilities.nativeWindowCapture).toBe("available")
  expect(report.capabilities.xdgOpen).toBe("available")
  expect(report.capabilities.family).toBe("firefox-gecko")
  expect(report.capabilities.protocols.cdp.support).toBe("unsupported")
  expect(report.capabilities.protocols.webdriverBidi.support).toBe("supported")
  expect(report.capabilities.protocols.webdriverBidi.endpoint).toBe("notConfigured")
  expect(report.capabilities.protocols.marionette.support).toBe("supported")
})

test("unknown browser family preserves unknown protocol support", () => {
  const entry = parseDesktopEntry("[Desktop Entry]\nName=Something\nExec=something %u\n", "something.desktop", "/apps/something.desktop")
  const identity = normalizeBrowserIdentity({ desktopId: "something.desktop", source: "fixture" }, entry)

  expect(inferBrowserFamily(identity)).toBe("unknown")
})

test("WebDriver BiDi endpoint probe rejects non-loopback endpoint", async () => {
  const entry = parseDesktopEntry(zenDesktop, "app.zen_browser.zen.desktop", "/apps/app.zen_browser.zen.desktop")
  const report = await browserTargetReport(
    runner({ commands: { "xdg-settings get default-web-browser": "app.zen_browser.zen.desktop\n" } }),
    state,
    {
      webdriverBidiEndpoint: "ws://example.com:9222/session",
      env,
      async readFile(path) {
        if (path.endsWith("app.zen_browser.zen.desktop")) return zenDesktop
        throw new Error(`unexpected path ${path}`)
      },
    },
  )

  expect(entry?.name).toBe("Zen Browser")
  expect(report.capabilities.protocols.webdriverBidi.endpoint).toBe("rejected")
})

test("WebDriver BiDi endpoint probe reports available on session.status response", async () => {
  class FakeWebSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    binaryType: BinaryType = "blob"
    bufferedAmount = 0
    extensions = ""
    protocol = ""
    readyState = 1
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
    url: string

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      queueMicrotask(() => this.dispatchEvent(new Event("open")))
    }

    close() {}

    send() {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: 1, result: { ready: true } }) }))
    }
  }

  const report = await browserTargetReport(
    runner({ commands: { "xdg-settings get default-web-browser": "app.zen_browser.zen.desktop\n" } }),
    state,
    {
      webdriverBidiEndpoint: "ws://127.0.0.1:9222/session",
      webSocketFactory: FakeWebSocket,
      env,
      async readFile(path) {
        if (path.endsWith("app.zen_browser.zen.desktop")) return zenDesktop
        throw new Error(`unexpected path ${path}`)
      },
    },
  )

  expect(report.capabilities.protocols.webdriverBidi.endpoint).toBe("available")
})

test("browser-targets tool mode returns matched browser report", async () => {
  const hypr = {
    "j/activewindow": "{}",
    "j/clients": JSON.stringify([
      {
        address: "0xabc",
        stableId: "stable",
        class: "app.zen_browser.zen",
        title: "Start — Zen Browser",
        pid: 123,
        at: [0, 0],
        size: [100, 100],
        workspace: { id: 2, name: "2" },
        monitor: 1,
      },
    ]),
    "j/monitors": JSON.stringify([{ id: 1, name: "DP-2", x: 0, y: 0, width: 1920, height: 1080, focused: true }]),
    "j/workspaces": "[]",
  }
  const result = await executeReadonlyTool(
    { mode: "browser-targets" },
    {
      runner: runner({
        commands: {
          "xdg-settings get default-web-browser": "app.zen_browser.zen.desktop\n",
        },
        hypr,
      }),
    },
  )

  expect(result.ok).toBe(true)
  if (result.ok === false || !("browser" in result) || result.mode !== "browser-targets") {
    throw new Error("expected browser target result")
  }
  expect(result.browser.matches?.length).toBe(1)
})
