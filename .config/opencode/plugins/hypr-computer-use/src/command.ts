import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import { Socket } from "node:net"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type CommandRunner = {
  execFile(command: string, args: string[], options?: { timeout?: number }): Promise<{ stdout: string; stderr: string }>
  commandExists(command: string): Promise<boolean>
  hyprQuery(request: string): Promise<string>
}

async function queryHyprSocket(request: string): Promise<string> {
  const runtimeDir = process.env.XDG_RUNTIME_DIR
  const signature = process.env.HYPRLAND_INSTANCE_SIGNATURE
  if (!runtimeDir || !signature) {
    return ""
  }

  const socketPath = `${runtimeDir}/hypr/${signature}/.socket.sock`
  try {
    await access(socketPath)
  } catch {
    return ""
  }

  return await new Promise((resolve) => {
    const socket = new Socket()
    let output = ""
    let settled = false

    const finish = (value: string) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(750)
    socket.on("data", (chunk) => {
      output += chunk.toString("utf8")
    })
    socket.on("error", () => finish(""))
    socket.on("timeout", () => finish(""))
    socket.on("close", () => finish(output))
    socket.connect(socketPath, () => {
      socket.end(request)
    })
  })
}

export const nodeCommandRunner: CommandRunner = {
  async execFile(command, args, options) {
    const result = await execFileAsync(command, args, {
      timeout: options?.timeout ?? 3000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    })

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  },

  async commandExists(command) {
    try {
      await execFileAsync("command", ["-v", command], {
        shell: "/bin/sh",
        timeout: 1000,
        windowsHide: true,
      })
      return true
    } catch {
      return false
    }
  },

  async hyprQuery(request) {
    const socketResult = await queryHyprSocket(request)
    if (socketResult.trim()) {
      return socketResult
    }

    const hyprctlArgs: Record<string, string[]> = {
      "j/activewindow": ["activewindow", "-j"],
      "j/clients": ["clients", "-j"],
      "j/monitors": ["monitors", "-j"],
      "j/workspaces": ["workspaces", "-j"],
    }

    const args = hyprctlArgs[request]
    if (!args) {
      return ""
    }

    try {
      const result = await this.execFile("hyprctl", args, { timeout: 1500 })
      return result.stdout
    } catch {
      return ""
    }
  },
}
