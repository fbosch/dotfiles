import { tool } from "@opencode-ai/plugin/tool"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type McpServer = {
  type: "local" | "remote"
  command?: string[]
  environment?: Record<string, string>
}

type ToolboxConfig = {
  mcp: Record<string, McpServer>
  settings?: {
    connection?: {
      connectTimeout?: number
      requestTimeout?: number
    }
  }
}

type CatalogTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

type ServerResult = {
  name: string
  tools: CatalogTool[]
  error?: string
}

function stripJsonc(text: string): string {
  const output: string[] = []
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]

    if (inString) {
      output.push(character)
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      output.push(character)
      continue
    }

    if (character === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        index += 1
      }
      output.push("\n")
      continue
    }

    if (character === "/" && next === "*") {
      index += 2
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        index += 1
      }
      index += 1
      continue
    }

    if (character === ",") {
      let lookahead = index + 1
      while (lookahead < text.length && /\s/u.test(text[lookahead])) {
        lookahead += 1
      }
      if (text[lookahead] === "}" || text[lookahead] === "]") {
        continue
      }
    }

    output.push(character)
  }

  return output.join("")
}

function loadConfig(): ToolboxConfig {
  const configPath = process.env.OPENCODE_TOOLBOX_CONFIG ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode", "toolbox.jsonc")
  return JSON.parse(stripJsonc(readFileSync(configPath, "utf8"))) as ToolboxConfig
}

function expandEnvironment(value: string): string {
  return value.replace(/\{env:([A-Z0-9_]+)\}/gu, (_, name: string) => process.env[name] ?? "")
}

function withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function listTools(name: string, server: McpServer, cwd: string, timeout: number, signal: AbortSignal): Promise<ServerResult> {
  if (server.type !== "local" || server.command === undefined || server.command.length === 0) {
    return { name, tools: [], error: "Only local MCP servers are supported." }
  }

  const [command, ...args] = server.command
  const environment = Object.fromEntries(
    Object.entries(server.environment ?? {}).map(([key, value]) => [key, expandEnvironment(value)]),
  )
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  })
  let buffer = ""
  let requestId = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>()

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      request.reject(error)
    }
    pending.clear()
  }

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
        if (message.id === undefined) {
          continue
        }
        const request = pending.get(message.id)
        if (request === undefined) {
          continue
        }
        pending.delete(message.id)
        if (message.error !== undefined) {
          request.reject(new Error(message.error.message ?? "MCP request failed."))
        } else {
          request.resolve(message.result)
        }
      } catch {
        // MCP servers occasionally emit diagnostics on stdout before protocol messages.
      }
    }
  })
  child.once("error", (error) => rejectPending(error))
  child.once("close", (code) => rejectPending(new Error(`MCP server exited with code ${code ?? "unknown"}.`)))

  const request = (method: string, params: Record<string, unknown>) =>
    withTimeout(
      new Promise<unknown>((resolve, reject) => {
        requestId += 1
        pending.set(requestId, { resolve, reject })
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`)
      }),
      timeout,
      `${name} timed out while handling ${method}.`,
    )

  const abort = () => child.kill()
  signal.addEventListener("abort", abort, { once: true })

  try {
    await request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "opencode-tool-search", version: "1.0.0" },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)

    const tools: CatalogTool[] = []
    let cursor: string | undefined
    do {
      const result = (await request("tools/list", cursor === undefined ? {} : { cursor })) as { tools?: CatalogTool[]; nextCursor?: string }
      tools.push(...(result.tools ?? []))
      cursor = result.nextCursor
    } while (cursor !== undefined)

    return { name, tools }
  } catch (error) {
    return { name, tools: [], error: error instanceof Error ? error.message : String(error) }
  } finally {
    signal.removeEventListener("abort", abort)
    child.kill()
  }
}

function isRegex(query: string): boolean {
  return /[\\^$.*+?()[\]{}|]/u.test(query)
}

function scoreTool(toolName: string, description: string, query: string, regex: boolean): number | null {
  const searchable = `${toolName} ${description}`.toLowerCase()
  if (regex) {
    try {
      return new RegExp(query, "iu").test(searchable) ? 1 : null
    } catch {
      return null
    }
  }

  const terms = query.toLowerCase().match(/[a-z0-9]+/gu) ?? []
  if (terms.length === 0 || terms.some((term) => searchable.includes(term) === false)) {
    return null
  }

  return terms.reduce((score, term) => score + (toolName.toLowerCase().includes(term) ? 2 : 1), 0)
}

export default tool({
  description: "Search configured MCP tools by name, regular expression, or capability. Returns tool IDs and input schemas without executing them.",
  args: {
    query: tool.schema.string().describe("Tool name, regex pattern, or capability keywords to search for"),
    limit: tool.schema.number().optional().describe("Maximum number of matches to return (default: 5, maximum: 20)"),
  },
  async execute(args, context) {
    let config: ToolboxConfig
    try {
      config = loadConfig()
    } catch (error) {
      return `ERROR: Could not load toolbox configuration: ${error instanceof Error ? error.message : String(error)}`
    }

    const timeout = config.settings?.connection?.requestTimeout ?? config.settings?.connection?.connectTimeout ?? 30_000
    const results = await Promise.all(
      Object.entries(config.mcp).map(([name, server]) => listTools(name, server, context.directory, timeout, context.abort)),
    )
    const regex = isRegex(args.query)
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 5), 1), 20)
    const matches = results
      .flatMap((server) =>
        server.tools.flatMap((catalogTool) => {
          const description = catalogTool.description ?? ""
          const score = scoreTool(catalogTool.name, description, args.query, regex)
          if (score === null) {
            return []
          }
          return [{ toolId: `${server.name}_${catalogTool.name}`, name: catalogTool.name, description, score, schema: catalogTool.inputSchema ?? null }]
        }),
      )
      .sort((left, right) => right.score - left.score || left.toolId.localeCompare(right.toolId))
      .slice(0, limit)

    return JSON.stringify(
      {
        count: matches.length,
        tools: matches,
        errors: results.flatMap((server) => (server.error === undefined ? [] : [{ server: server.name, error: server.error }])),
        usage: "Use the matching native tool directly when available, or toolbox_execute with the returned toolId.",
      },
      null,
      2,
    )
  },
})
