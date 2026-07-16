import { MAX_READ_BYTES, MAX_READ_LINES, NvimContextBridge, type BridgeFailure, type BridgeResult, type BufferInventoryResult, type BufferReadOptions, type BufferReadResult, type DiagnosticsResult, type FocusContextResult, type VisibleWindowsResult } from "./neovim-bridge"
import { isNumber, isRecord, isString, type JsonRecord } from "./nvim-utils"

const TOOL_NAME = "nvim_context"
const VISIBLE_WINDOWS_TOOL_NAME = "nvim_visible_windows"
const LIST_BUFFERS_TOOL_NAME = "nvim_list_buffers"
const READ_BUFFER_TOOL_NAME = "nvim_read_buffer"
const DIAGNOSTICS_TOOL_NAME = "nvim_diagnostics"
const FOCUS_CONTEXT_TOOL_NAME = "nvim_focus_context"
const PROTOCOL_VERSION = "2025-06-18"
const READ_OPTION_NAMES = new Set(["buffer", "startLine", "endLine"])

type ToolResult = BridgeResult | VisibleWindowsResult | BufferInventoryResult | BufferReadResult | DiagnosticsResult | FocusContextResult
type ToolHandler = (params: JsonRecord, bridge: NvimContextBridge) => Promise<ToolResult>

export { NvimContextBridge } from "./neovim-bridge"

function bridgeError(code: BridgeFailure["error"]["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function toolResult(result: ToolResult) {
	if ("error" in result) return errorToolResult(result.error)
	return successToolResult(Object.values(result)[1])
}

function errorToolResult(error: BridgeFailure["error"]) {
	return { content: [{ type: "text", text: JSON.stringify({ error }) }], isError: true }
}

function successToolResult(value: unknown) {
	return { content: [{ type: "text", text: JSON.stringify(value) }] }
}

function optionalPositiveInteger(value: unknown): number | undefined | null {
	if (value === undefined) return undefined
	return positiveInteger(value)
}

function positiveInteger(value: unknown): number | null {
	if (isNumber(value) === false) return null
	if (Number.isInteger(value) === false) return null
	if (value < 1) return null
	return value
}

function parseReadOptions(params: JsonRecord): BufferReadOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	const unsupportedArgument = Object.keys(arguments_).find(function(key) { return READ_OPTION_NAMES.has(key) === false })
	if (unsupportedArgument) return bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported buffer read argument: ${unsupportedArgument}`)
	const options = readOptions(arguments_)
	return Object.values(options).includes(null) ? bridgeError("NVIM_INVALID_ARGUMENT", "Buffer and line values must be positive integers") : options
}

function readArguments(params: JsonRecord): JsonRecord | BridgeFailure {
	if (params.arguments === undefined) return {}
	return isRecord(params.arguments) ? params.arguments : bridgeError("NVIM_INVALID_ARGUMENT", "Buffer read arguments must be an object")
}

function readOptions(arguments_: JsonRecord): BufferReadOptions {
	return { buffer: optionalPositiveInteger(arguments_.buffer), startLine: optionalPositiveInteger(arguments_.startLine), endLine: optionalPositiveInteger(arguments_.endLine) }
}

function diagnosticBuffer(params: JsonRecord): number | undefined | null {
	return optionalPositiveInteger(isRecord(params.arguments) ? params.arguments.buffer : undefined)
}

function jsonRpcError(id: unknown, code: number, message: string): JsonRecord {
	return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

function jsonRpcResult(id: unknown, result: unknown): JsonRecord {
	return { jsonrpc: "2.0", id: id ?? null, result }
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
	[TOOL_NAME]: async function(_, bridge) { return bridge.context() },
	[VISIBLE_WINDOWS_TOOL_NAME]: async function(_, bridge) { return bridge.visibleWindows() },
	[LIST_BUFFERS_TOOL_NAME]: async function(_, bridge) { return bridge.bufferInventory() },
	[READ_BUFFER_TOOL_NAME]: async function(params, bridge) {
		const options = parseReadOptions(params)
		return "error" in options ? options : bridge.readBuffer(options)
	},
	[DIAGNOSTICS_TOOL_NAME]: async function(params, bridge) {
		const buffer = diagnosticBuffer(params)
		return buffer === null ? bridgeError("NVIM_INVALID_ARGUMENT", "Buffer must be a positive integer") : bridge.diagnostics(buffer)
	},
	[FOCUS_CONTEXT_TOOL_NAME]: async function(_, bridge) { return bridge.focusContext() },
}

const REQUEST_HANDLERS: Record<string, (id: unknown) => JsonRecord | undefined> = {
	"notifications/initialized": function() { return undefined },
	initialize: function(id) { return jsonRpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, instructions: "Use these tools only when live Neovim state is relevant. Prefer nvim_focus_context for ambiguous references to this file or this code. Use nvim_visible_windows or nvim_list_buffers to discover buffers, nvim_read_buffer for bounded live or unsaved text, and nvim_diagnostics for editor diagnostics. Results are read-only point-in-time snapshots from one bound Neovim instance; do not infer another editor instance or on-disk state.", serverInfo: { name: "neovim-context", version: "0.1.0" } }) },
	"tools/list": function(id) { return jsonRpcResult(id, { tools: tools() }) },
}

export async function handleMessage(message: unknown, bridge: NvimContextBridge): Promise<JsonRecord | undefined> {
	if (isRequest(message) === false) return jsonRpcError(null, -32600, "Invalid Request")
	const handler = REQUEST_HANDLERS[message.method]
	if (handler) return handler(message.id)
	if (message.method !== "tools/call") return jsonRpcError(message.id, -32601, "Method not found")
	return callTool(message.id, requestParams(message), bridge)
}

function isRequest(value: unknown): value is JsonRecord & { method: string } {
	return isRecord(value) && isString(value.method)
}

function requestParams(message: JsonRecord): JsonRecord {
	return isRecord(message.params) ? message.params : {}
}

async function callTool(id: unknown, params: JsonRecord, bridge: NvimContextBridge): Promise<JsonRecord> {
	const toolName = String(params.name)
	const handler = TOOL_HANDLERS[toolName]
	if (handler === undefined) return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`)
	return jsonRpcResult(id, toolResult(await handler(params, bridge)))
}

function tools() {
	return [
		{ name: TOOL_NAME, description: "Get live context from the Neovim instance bound to this OpenCode server.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: VISIBLE_WINDOWS_TOOL_NAME, description: "Get visible Neovim windows and the source buffers visible beside OpenCode.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: LIST_BUFFERS_TOOL_NAME, description: "List buffers from the Neovim instance bound to this OpenCode server.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: READ_BUFFER_TOOL_NAME, description: `Read up to ${MAX_READ_LINES} lines or ${MAX_READ_BYTES} bytes from a loaded source buffer in Neovim memory.`, inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, startLine: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 } }, additionalProperties: false } },
		{ name: DIAGNOSTICS_TOOL_NAME, description: "Get current diagnostics and their source buffer from the bound Neovim instance.", inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 } }, additionalProperties: false } },
		{ name: FOCUS_CONTEXT_TOOL_NAME, description: "Get the most recently focused source buffer before focus entered OpenCode or another special buffer.", inputSchema: { type: "object", additionalProperties: false } },
	]
}

async function runHealthCheck(bridge: NvimContextBridge) {
	const result = await bridge.context()
	process.stdout.write(`${JSON.stringify(result)}\n`)
	process.exitCode = result.ok ? 0 : 1
}

function pendingLines(pending: string): { lines: string[]; pending: string } {
	const lines = pending.split("\n")
	return { lines: lines.slice(0, -1), pending: lines.at(-1)! }
}

async function handleLine(line: string, bridge: NvimContextBridge): Promise<JsonRecord> {
	try {
		const response = await handleMessage(JSON.parse(line), bridge)
		return response ?? {}
	} catch {
		return jsonRpcError(null, -32700, "Parse error")
	}
}

async function writeResponse(line: string, bridge: NvimContextBridge) {
	if (line.trim() === "") return
	const response = await handleLine(line, bridge)
	if (Object.keys(response).length > 0) process.stdout.write(`${JSON.stringify(response)}\n`)
}

async function runStdioServer(bridge: NvimContextBridge) {
	const reader = Bun.stdin.stream().getReader()
	const decoder = new TextDecoder()
	let pending = ""
	while (true) {
		const { done, value } = await reader.read()
		if (done) return
		const chunk = pendingLines(pending + decoder.decode(value, { stream: true }))
		pending = chunk.pending
		for (const line of chunk.lines) await writeResponse(line, bridge)
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
