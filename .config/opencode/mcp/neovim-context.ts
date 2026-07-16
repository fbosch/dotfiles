import { MAX_READ_BYTES, MAX_READ_LINES, NvimContextBridge, type BridgeFailure, type BridgeResult, type BufferInventoryResult, type BufferReadOptions, type BufferReadResult, type DiagnosticsResult, type VisibleWindowsResult } from "./neovim-bridge"
import { isNumber, isRecord, isString, type JsonRecord } from "./nvim-utils"

const TOOL_NAME = "nvim_context"
const VISIBLE_WINDOWS_TOOL_NAME = "nvim_visible_windows"
const LIST_BUFFERS_TOOL_NAME = "nvim_list_buffers"
const READ_BUFFER_TOOL_NAME = "nvim_read_buffer"
const DIAGNOSTICS_TOOL_NAME = "nvim_diagnostics"
const PROTOCOL_VERSION = "2025-06-18"

export { NvimContextBridge } from "./neovim-bridge"

function bridgeError(code: BridgeFailure["error"]["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function toolResult(result: BridgeResult | VisibleWindowsResult | BufferInventoryResult | BufferReadResult | DiagnosticsResult) {
	if ("error" in result) return { content: [{ type: "text", text: JSON.stringify({ error: result.error }) }], isError: true }
	if ("context" in result) return { content: [{ type: "text", text: JSON.stringify(result.context) }] }
	if ("visibleWindows" in result) return { content: [{ type: "text", text: JSON.stringify(result.visibleWindows) }] }
	if ("bufferInventory" in result) return { content: [{ type: "text", text: JSON.stringify(result.bufferInventory) }] }
	if ("bufferRead" in result) return { content: [{ type: "text", text: JSON.stringify(result.bufferRead) }] }
	return { content: [{ type: "text", text: JSON.stringify(result.diagnostics) }] }
}

function optionalPositiveInteger(value: unknown): number | undefined | null {
	if (value === undefined) return undefined
	return isNumber(value) && Number.isInteger(value) && value >= 1 ? value : null
}

function parseReadOptions(params: unknown): BufferReadOptions | BridgeFailure {
	if (isRecord(params) === false || params.arguments === undefined) return {}
	if (isRecord(params.arguments) === false) return bridgeError("NVIM_INVALID_ARGUMENT", "Buffer read arguments must be an object")
	for (const key of Object.keys(params.arguments)) {
		if (["buffer", "startLine", "endLine"].includes(key) === false) return bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported buffer read argument: ${key}`)
	}
	const buffer = optionalPositiveInteger(params.arguments.buffer)
	const startLine = optionalPositiveInteger(params.arguments.startLine)
	const endLine = optionalPositiveInteger(params.arguments.endLine)
	if (buffer === null || startLine === null || endLine === null) return bridgeError("NVIM_INVALID_ARGUMENT", "Buffer and line values must be positive integers")
	return { buffer, startLine, endLine }
}

function jsonRpcError(id: unknown, code: number, message: string) {
	return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

export async function handleMessage(message: unknown, bridge: NvimContextBridge): Promise<JsonRecord | undefined> {
	if (isRecord(message) === false || isString(message.method) === false) return jsonRpcError(null, -32600, "Invalid Request")
	const id = message.id
	if (message.method === "notifications/initialized") return undefined
	if (message.method === "initialize") return { jsonrpc: "2.0", id: id ?? null, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: "neovim-context", version: "0.1.0" } } }
	if (message.method === "tools/list") return { jsonrpc: "2.0", id: id ?? null, result: { tools: tools() } }
	if (message.method !== "tools/call") return jsonRpcError(id, -32601, "Method not found")

	const params = isRecord(message.params) ? message.params : {}
	if (params.name === TOOL_NAME) return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.context()) }
	if (params.name === VISIBLE_WINDOWS_TOOL_NAME) return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.visibleWindows()) }
	if (params.name === LIST_BUFFERS_TOOL_NAME) return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.bufferInventory()) }
	if (params.name === READ_BUFFER_TOOL_NAME) {
		const options = parseReadOptions(params)
		return { jsonrpc: "2.0", id: id ?? null, result: toolResult("error" in options ? options : await bridge.readBuffer(options)) }
	}
	if (params.name === DIAGNOSTICS_TOOL_NAME) {
		const buffer = optionalPositiveInteger(isRecord(params.arguments) ? params.arguments.buffer : undefined)
		return { jsonrpc: "2.0", id: id ?? null, result: toolResult(buffer === null ? bridgeError("NVIM_INVALID_ARGUMENT", "Buffer must be a positive integer") : await bridge.diagnostics(buffer)) }
	}
	return jsonRpcError(id, -32602, `Unknown tool: ${String(params.name)}`)
}

function tools() {
	return [
		{ name: TOOL_NAME, description: "Get live context from the Neovim instance bound to this OpenCode server.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: VISIBLE_WINDOWS_TOOL_NAME, description: "Get visible Neovim windows and the source buffers visible beside OpenCode.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: LIST_BUFFERS_TOOL_NAME, description: "List buffers from the Neovim instance bound to this OpenCode server.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: READ_BUFFER_TOOL_NAME, description: `Read up to ${MAX_READ_LINES} lines or ${MAX_READ_BYTES} bytes from a loaded source buffer in Neovim memory.`, inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, additionalProperties: false } },
		{ name: DIAGNOSTICS_TOOL_NAME, description: "Get current diagnostics and their source buffer from the bound Neovim instance.", inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 } }, additionalProperties: false } },
	]
}

async function runHealthCheck(bridge: NvimContextBridge) {
	const result = await bridge.context()
	process.stdout.write(`${JSON.stringify(result)}\n`)
	process.exitCode = result.ok ? 0 : 1
}

async function runStdioServer(bridge: NvimContextBridge) {
	const reader = Bun.stdin.stream().getReader()
	const decoder = new TextDecoder()
	let pending = ""
	while (true) {
		const { done, value } = await reader.read()
		if (done) return
		pending += decoder.decode(value, { stream: true })
		let newline = pending.indexOf("\n")
		while (newline >= 0) {
			const line = pending.slice(0, newline).trim()
			pending = pending.slice(newline + 1)
			newline = pending.indexOf("\n")
			if (line === "") continue
			try {
				const response = await handleMessage(JSON.parse(line), bridge)
				if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
			} catch {
				process.stdout.write(`${JSON.stringify(jsonRpcError(null, -32700, "Parse error"))}\n`)
			}
		}
	}
}

if (import.meta.main) {
	const bridge = new NvimContextBridge(process.env.NVIM_CONTEXT_SOCKET)
	if (Bun.argv.includes("--health")) await runHealthCheck(bridge)
	else {
		await bridge.initialize()
		await runStdioServer(bridge)
	}
}
