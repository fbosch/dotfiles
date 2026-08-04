import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HerdrIntegration } from "../herdr-integration"

type Request = { method: string; params: { source: string; state?: string } }

describe("HerdrIntegration", () => {
  test("claims lifecycle authority during initialization", async () => {
    const directory = await mkdtemp(join(tmpdir(), "herdr-integration-"))
    const socketPath = join(directory, "herdr.sock")
    const requests: Request[] = []
    const server = net.createServer((socket) => {
      socket.on("data", (data) => {
        requests.push(JSON.parse(data.toString()))
        socket.write("{}\n")
      })
    })
    const environment = {
      HERDR_ENV: process.env.HERDR_ENV,
      HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
      OPENCODE_NVIM_HERDR_PANE_ID: process.env.OPENCODE_NVIM_HERDR_PANE_ID,
    }

    try {
      await new Promise<void>((resolve, reject) => server.listen(socketPath, resolve).once("error", reject))
      process.env.HERDR_ENV = "1"
      process.env.HERDR_SOCKET_PATH = socketPath
      process.env.OPENCODE_NVIM_HERDR_PANE_ID = "w1:p1"

      const integration = HerdrIntegration.fromEnvironment()
      expect(integration).toBeDefined()
      await integration?.initialize()

      expect(requests.map((request) => request.method)).toEqual([
        "pane.report_metadata",
        "pane.report_metadata",
        "pane.report_metadata",
        "pane.report_agent",
      ])
      expect(requests.at(-1)?.params.source).toBe("custom:neovim-opencode")
      expect(requests.at(-1)?.params.state).toBe("idle")
    } finally {
      for (const [key, value] of Object.entries(environment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { force: true, recursive: true })
    }
  })
})
