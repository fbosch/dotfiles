import { DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS, DEFAULT_DISCOVERY_ITEMS, DEFAULT_HIGHLIGHT_DURATION_MS, MAX_DIAGNOSTIC_SUMMARY_ITEMS, MAX_DISCOVERY_ITEMS, MAX_HIGHLIGHT_DURATION_MS, MAX_HIGHLIGHT_LINES, MAX_READ_BYTES, MAX_READ_LINES, NvimContextBridge, type BridgeFailure, type BridgeResult, type BufferInventoryResult, type BufferReadOptions, type BufferReadResult, type ClearHighlightOptions, type ClearHighlightResult, type DiagnosticSummaryOptions, type DiagnosticSummaryResult, type DiagnosticsResult, type FocusContextResult, type HighlightOptions, type HighlightResult, type QuickfixOptions, type QuickfixResult, type RevealOptions, type RevealResult, type SelectionResult, type VisibleWindowsResult } from "./neovim-bridge"
import { isNumber, isRecord, isString, type JsonRecord } from "./nvim-utils"

const TOOL_NAME = "nvim_context"
const VISIBLE_WINDOWS_TOOL_NAME = "nvim_visible_windows"
const LIST_BUFFERS_TOOL_NAME = "nvim_list_buffers"
const READ_BUFFER_TOOL_NAME = "nvim_read_buffer"
const DIAGNOSTICS_TOOL_NAME = "nvim_diagnostics"
const DIAGNOSTIC_SUMMARY_TOOL_NAME = "nvim_diagnostic_summary"
const FOCUS_CONTEXT_TOOL_NAME = "nvim_focus_context"
const SELECTION_TOOL_NAME = "nvim_selection"
const QUICKFIX_TOOL_NAME = "nvim_quickfix"
const REVEAL_TOOL_NAME = "nvim_reveal"
const HIGHLIGHT_TOOL_NAME = "nvim_highlight"
const CLEAR_HIGHLIGHT_TOOL_NAME = "nvim_clear_highlight"
const PROTOCOL_VERSION = "2025-06-18"
const READ_OPTION_NAMES = new Set(["buffer", "startLine", "endLine"])
const DIAGNOSTIC_SUMMARY_OPTION_NAMES = new Set(["buffer", "maxItems"])
const QUICKFIX_OPTION_NAMES = new Set(["kind", "maxItems"])
const REVEAL_OPTION_NAMES = new Set(["buffer", "line", "column", "focus", "split"])
const HIGHLIGHT_OPTION_NAMES = new Set(["buffer", "path", "startLine", "startColumn", "endLine", "endColumn", "durationMs", "reveal"])
const CLEAR_HIGHLIGHT_OPTION_NAMES = new Set(["buffer", "highlightId"])
const REVEAL_SPLITS = new Set(["none", "horizontal", "vertical"])

type ToolResult = BridgeResult | VisibleWindowsResult | BufferInventoryResult | BufferReadResult | ClearHighlightResult | DiagnosticSummaryResult | DiagnosticsResult | FocusContextResult | HighlightResult | QuickfixResult | RevealResult | SelectionResult
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
	return isRecord(params.arguments) ? params.arguments : bridgeError("NVIM_INVALID_ARGUMENT", "Tool arguments must be an object")
}

function optionalBoolean(value: unknown): boolean | undefined | null {
	if (value === undefined) return undefined
	return typeof value === "boolean" ? value : null
}

function readOptions(arguments_: JsonRecord): BufferReadOptions {
	return { buffer: optionalPositiveInteger(arguments_.buffer), startLine: optionalPositiveInteger(arguments_.startLine), endLine: optionalPositiveInteger(arguments_.endLine) }
}

function diagnosticBuffer(params: JsonRecord): number | undefined | null {
	return optionalPositiveInteger(isRecord(params.arguments) ? params.arguments.buffer : undefined)
}

function parseDiagnosticSummaryOptions(params: JsonRecord): DiagnosticSummaryOptions | BridgeFailure {
	return parseBoundedBufferOptions(params, DIAGNOSTIC_SUMMARY_OPTION_NAMES, "diagnostic summary", DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS, MAX_DIAGNOSTIC_SUMMARY_ITEMS)
}

function parseBoundedBufferOptions(params: JsonRecord, names: Set<string>, label: string, defaultMaxItems: number, maximumMaxItems: number): DiagnosticSummaryOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	return boundedBufferOptions(arguments_, names, label, defaultMaxItems, maximumMaxItems)
}

function boundedBufferOptions(arguments_: JsonRecord, names: Set<string>, label: string, defaultMaxItems: number, maximumMaxItems: number): DiagnosticSummaryOptions | BridgeFailure {
	const unsupportedArgument = Object.keys(arguments_).find(function(key) { return names.has(key) === false })
	if (unsupportedArgument) return bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported ${label} argument: ${unsupportedArgument}`)
	return boundedBufferValues(arguments_, label, defaultMaxItems, maximumMaxItems)
}

function boundedBufferValues(arguments_: JsonRecord, label: string, defaultMaxItems: number, maximumMaxItems: number): DiagnosticSummaryOptions | BridgeFailure {
	const buffer = optionalPositiveInteger(arguments_.buffer)
	const maxItems = optionalPositiveInteger(arguments_.maxItems)
	if ([buffer, maxItems].includes(null)) return bridgeError("NVIM_INVALID_ARGUMENT", "Buffer and maxItems values must be positive integers")
	return boundedBufferLimit(buffer, maxItems, label, defaultMaxItems, maximumMaxItems)
}

function boundedBufferLimit(buffer: number | undefined, maxItems: number | undefined, label: string, defaultMaxItems: number, maximumMaxItems: number): DiagnosticSummaryOptions | BridgeFailure {
	const requestedMaxItems = maxItems ?? defaultMaxItems
	if (requestedMaxItems > maximumMaxItems) return bridgeError("NVIM_INVALID_ARGUMENT", `Request at most ${maximumMaxItems} ${label} items`)
	return { buffer, maxItems: requestedMaxItems }
}

function parseQuickfixOptions(params: JsonRecord): QuickfixOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	return quickfixOptions(arguments_)
}

function quickfixOptions(arguments_: JsonRecord): QuickfixOptions | BridgeFailure {
	const unsupportedArgument = Object.keys(arguments_).find(function(key) { return QUICKFIX_OPTION_NAMES.has(key) === false })
	if (unsupportedArgument) return bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported quickfix argument: ${unsupportedArgument}`)
	const maxItems = optionalPositiveInteger(arguments_.maxItems)
	if (maxItems === null) return bridgeError("NVIM_INVALID_ARGUMENT", "maxItems must be a positive integer")
	return quickfixKind(arguments_.kind, maxItems)
}

function quickfixKind(value: unknown, maxItems: number | undefined): QuickfixOptions | BridgeFailure {
	const kind = value ?? "quickfix"
	if (kind !== "quickfix" && kind !== "location") return bridgeError("NVIM_INVALID_ARGUMENT", "kind must be quickfix or location")
	return quickfixLimit(kind, maxItems)
}

function quickfixLimit(kind: "quickfix" | "location", maxItems: number | undefined): QuickfixOptions | BridgeFailure {
	const requestedMaxItems = maxItems ?? DEFAULT_DISCOVERY_ITEMS
	if (requestedMaxItems > MAX_DISCOVERY_ITEMS) return bridgeError("NVIM_INVALID_ARGUMENT", `Request at most ${MAX_DISCOVERY_ITEMS} quickfix items`)
	return { kind, maxItems: requestedMaxItems }
}

function parseRevealOptions(params: JsonRecord): RevealOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	return revealOptions(arguments_)
}

function revealOptions(arguments_: JsonRecord): RevealOptions | BridgeFailure {
	const unsupportedArgument = unsupportedPresentationArgument(arguments_, REVEAL_OPTION_NAMES, "reveal")
	if (unsupportedArgument) return unsupportedArgument
	const positions = presentationPositions(arguments_, ["buffer", "line", "column"], "Specify buffer, line, and column for a reveal")
	if ("error" in positions) return positions
	return revealSettings(arguments_, positions)
}

function revealSettings(arguments_: JsonRecord, positions: number[]): RevealOptions | BridgeFailure {
	const focus = optionalBoolean(arguments_.focus)
	if (focus === null) return bridgeError("NVIM_INVALID_ARGUMENT", "focus must be a boolean")
	const split = revealSplit(arguments_.split)
	if ("error" in split) return split
	return { buffer: positions[0], line: positions[1], column: positions[2], focus: focus ?? false, split }
}

function parseHighlightOptions(params: JsonRecord): HighlightOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	return highlightOptions(arguments_)
}

function highlightOptions(arguments_: JsonRecord): HighlightOptions | BridgeFailure {
	const unsupportedArgument = unsupportedPresentationArgument(arguments_, HIGHLIGHT_OPTION_NAMES, "highlight")
	if (unsupportedArgument) return unsupportedArgument
	const target = highlightTarget(arguments_)
	if ("error" in target) return target
	const startLine = positiveInteger(arguments_.startLine)
	if (startLine === null) return bridgeError("NVIM_INVALID_ARGUMENT", "startLine must be a positive integer")
	return highlightSettings(arguments_, target, startLine)
}

function highlightTarget(arguments_: JsonRecord): Pick<HighlightOptions, "buffer" | "path"> | BridgeFailure {
	const buffer = optionalPositiveInteger(arguments_.buffer)
	if (buffer === null) return bridgeError("NVIM_INVALID_ARGUMENT", "buffer must be a positive integer")
	const path = highlightPath(arguments_.path)
	if (typeof path !== "string" && path !== undefined) return path
	return selectHighlightTarget(buffer, path)
}

function highlightPath(value: unknown): string | undefined | BridgeFailure {
	if (value === undefined) return undefined
	if (isString(value) && value !== "") return value
	return bridgeError("NVIM_INVALID_ARGUMENT", "path must be a non-empty string")
}

function selectHighlightTarget(buffer: number | undefined, path: string | undefined): Pick<HighlightOptions, "buffer" | "path"> | BridgeFailure {
	if (buffer === undefined) return selectHighlightPath(path)
	return selectHighlightBuffer(buffer, path)
}

function selectHighlightPath(path: string | undefined): Pick<HighlightOptions, "path"> | BridgeFailure {
	return path === undefined ? bridgeError("NVIM_INVALID_ARGUMENT", "Specify exactly one of buffer or path for a highlight") : { path }
}

function selectHighlightBuffer(buffer: number, path: string | undefined): Pick<HighlightOptions, "buffer"> | BridgeFailure {
	return path === undefined ? { buffer } : bridgeError("NVIM_INVALID_ARGUMENT", "Specify exactly one of buffer or path for a highlight")
}

function highlightSettings(arguments_: JsonRecord, target: Pick<HighlightOptions, "buffer" | "path">, startLine: number): HighlightOptions | BridgeFailure {
	const durationMs = highlightDuration(arguments_.durationMs)
	if (typeof durationMs !== "number") return durationMs
	const range = highlightRange(arguments_)
	if ("error" in range) return range
	const reveal = highlightReveal(arguments_.reveal)
	if (typeof reveal !== "boolean") return reveal
	return { ...target, startLine, ...range, durationMs, reveal }
}

function highlightRange(arguments_: JsonRecord): Pick<HighlightOptions, "startColumn" | "endLine" | "endColumn"> | BridgeFailure {
	const values = [arguments_.startColumn, arguments_.endLine, arguments_.endColumn].map(optionalPositiveInteger)
	if (values.includes(null)) return bridgeError("NVIM_INVALID_ARGUMENT", "Highlight range values must be positive integers")
	return highlightRangeValues(values as Array<number | undefined>)
}

function highlightRangeValues([startColumn, endLine, endColumn]: Array<number | undefined>): Pick<HighlightOptions, "startColumn" | "endLine" | "endColumn"> {
	return { startColumn, endLine, endColumn }
}

function highlightReveal(value: unknown): boolean | BridgeFailure {
	const reveal = optionalBoolean(value)
	return reveal === null ? bridgeError("NVIM_INVALID_ARGUMENT", "reveal must be a boolean") : reveal ?? true
}

function parseClearHighlightOptions(params: JsonRecord): ClearHighlightOptions | BridgeFailure {
	const arguments_ = readArguments(params)
	if ("error" in arguments_) return arguments_
	const unsupportedArgument = unsupportedPresentationArgument(arguments_, CLEAR_HIGHLIGHT_OPTION_NAMES, "highlight clear")
	if (unsupportedArgument) return unsupportedArgument
	const values = presentationPositions(arguments_, ["buffer", "highlightId"], "Specify buffer and highlightId for a highlight clear")
	if ("error" in values) return values
	return { buffer: values[0], highlightId: values[1] }
}

function unsupportedPresentationArgument(arguments_: JsonRecord, names: Set<string>, label: string): BridgeFailure | undefined {
	const unsupportedArgument = Object.keys(arguments_).find(function(key) { return names.has(key) === false })
	return unsupportedArgument ? bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported ${label} argument: ${unsupportedArgument}`) : undefined
}

function presentationPositions(arguments_: JsonRecord, names: string[], missingMessage: string): number[] | BridgeFailure {
	const values = names.map(function(name) { return optionalPositiveInteger(arguments_[name]) })
	if (values.includes(null)) return bridgeError("NVIM_INVALID_ARGUMENT", "Presentation positions must be positive integers")
	if (values.includes(undefined)) return bridgeError("NVIM_INVALID_ARGUMENT", missingMessage)
	return values as number[]
}

function revealSplit(value: unknown): RevealOptions["split"] | BridgeFailure {
	if (value === undefined) return "none"
	if (isString(value) && REVEAL_SPLITS.has(value)) return value as RevealOptions["split"]
	return bridgeError("NVIM_INVALID_ARGUMENT", "split must be none, horizontal, or vertical")
}

function highlightDuration(value: unknown): number | BridgeFailure {
	const durationMs = optionalPositiveInteger(value)
	if (durationMs === null) return bridgeError("NVIM_INVALID_ARGUMENT", "durationMs must be a positive integer")
	const requestedDuration = durationMs ?? DEFAULT_HIGHLIGHT_DURATION_MS
	if (requestedDuration > MAX_HIGHLIGHT_DURATION_MS) return bridgeError("NVIM_INVALID_ARGUMENT", `Highlight duration must not exceed ${MAX_HIGHLIGHT_DURATION_MS} ms`)
	return requestedDuration
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
	[DIAGNOSTIC_SUMMARY_TOOL_NAME]: async function(params, bridge) {
		const options = parseDiagnosticSummaryOptions(params)
		return "error" in options ? options : bridge.diagnosticSummary(options)
	},
	[FOCUS_CONTEXT_TOOL_NAME]: async function(_, bridge) { return bridge.focusContext() },
	[SELECTION_TOOL_NAME]: async function(_, bridge) { return bridge.selection() },
	[QUICKFIX_TOOL_NAME]: async function(params, bridge) {
		const options = parseQuickfixOptions(params)
		return "error" in options ? options : bridge.quickfix(options)
	},
	[REVEAL_TOOL_NAME]: async function(params, bridge) {
		const options = parseRevealOptions(params)
		return "error" in options ? options : bridge.reveal(options)
	},
	[HIGHLIGHT_TOOL_NAME]: async function(params, bridge) {
		const options = parseHighlightOptions(params)
		return "error" in options ? options : bridge.highlight(options)
	},
	[CLEAR_HIGHLIGHT_TOOL_NAME]: async function(params, bridge) {
		const options = parseClearHighlightOptions(params)
		return "error" in options ? options : bridge.clearHighlight(options)
	},
}

const REQUEST_HANDLERS: Record<string, (id: unknown) => JsonRecord | undefined> = {
	"notifications/initialized": function() { return undefined },
	initialize: function(id) { return jsonRpcResult(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, instructions: "Use these tools only when live Neovim state is relevant. Prefer nvim_focus_context for ambiguous references to this file or this code. Use nvim_visible_windows or nvim_list_buffers to discover buffers, nvim_selection for active visual text, nvim_read_buffer for bounded live or unsaved text, nvim_diagnostic_summary to triage editor diagnostics, nvim_diagnostics for complete diagnostics, and nvim_quickfix for current problem lists. For a where-is request, search first, then use nvim_highlight with either its loaded buffer or its workspace-relative path plus line. It opens or reuses the file in a source window, highlights the whole line when columns are omitted, and does not steal focus. Use nvim_reveal when a position should be shown without a highlight. These presentation tools preserve buffer contents. Results are point-in-time snapshots or presentation changes in one bound Neovim instance; do not infer another editor instance or on-disk state.", serverInfo: { name: "neovim-context", version: "0.1.0" } }) },
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
		{ name: DIAGNOSTIC_SUMMARY_TOOL_NAME, description: `Summarize diagnostics and return up to ${DEFAULT_DIAGNOSTIC_SUMMARY_ITEMS} highest-priority items from the active or selected buffer.`, inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, maxItems: { type: "integer", minimum: 1, maximum: MAX_DIAGNOSTIC_SUMMARY_ITEMS } }, additionalProperties: false } },
		{ name: DIAGNOSTICS_TOOL_NAME, description: "Get current diagnostics and their source buffer from the bound Neovim instance.", inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 } }, additionalProperties: false } },
		{ name: FOCUS_CONTEXT_TOOL_NAME, description: "Get the most recently focused source buffer before focus entered OpenCode or another special buffer.", inputSchema: { type: "object", additionalProperties: false } },
		{ name: SELECTION_TOOL_NAME, description: `Get up to ${MAX_READ_LINES} lines or ${MAX_READ_BYTES} bytes of the active source visual selection from Neovim memory.`, inputSchema: { type: "object", additionalProperties: false } },
		{ name: QUICKFIX_TOOL_NAME, description: `Get up to ${DEFAULT_DISCOVERY_ITEMS} entries from the current quickfix or location list.`, inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["quickfix", "location"] }, maxItems: { type: "integer", minimum: 1, maximum: MAX_DISCOVERY_ITEMS } }, additionalProperties: false } },
		{ name: REVEAL_TOOL_NAME, description: "Reveal an existing source buffer at an exact position, optionally creating an explicit split. Focus remains unchanged unless requested.", inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, line: { type: "integer", minimum: 1 }, column: { type: "integer", minimum: 1 }, focus: { type: "boolean", default: false }, split: { type: "string", enum: ["none", "horizontal", "vertical"], default: "none" } }, required: ["buffer", "line", "column"], additionalProperties: false } },
		{ name: HIGHLIGHT_TOOL_NAME, description: `Temporarily open or reuse a workspace source file and highlight a line or exact range for up to ${MAX_HIGHLIGHT_DURATION_MS} ms without changing text. Specify exactly one of buffer or workspace-relative path. Omitting columns highlights the whole line.`, inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, path: { type: "string", minLength: 1 }, startLine: { type: "integer", minimum: 1 }, startColumn: { type: "integer", minimum: 1 }, endLine: { type: "integer", minimum: 1 }, endColumn: { type: "integer", minimum: 1 }, durationMs: { type: "integer", minimum: 1, maximum: MAX_HIGHLIGHT_DURATION_MS, default: DEFAULT_HIGHLIGHT_DURATION_MS }, reveal: { type: "boolean", default: true } }, required: ["startLine"], anyOf: [{ required: ["buffer"] }, { required: ["path"] }], additionalProperties: false } },
		{ name: CLEAR_HIGHLIGHT_TOOL_NAME, description: "Clear a temporary highlight previously returned by nvim_highlight.", inputSchema: { type: "object", properties: { buffer: { type: "integer", minimum: 1 }, highlightId: { type: "integer", minimum: 1 } }, required: ["buffer", "highlightId"], additionalProperties: false } },
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
	const parsed = parseMessage(line)
	if ("response" in parsed) return parsed.response
	return executeMessage(parsed.message, bridge)
}

function parseMessage(line: string): { message: unknown } | { response: JsonRecord } {
	try {
		return { message: JSON.parse(line) }
	} catch {
		return { response: jsonRpcError(null, -32700, "Parse error") }
	}
}

async function executeMessage(message: unknown, bridge: NvimContextBridge): Promise<JsonRecord> {
	try {
		const response = await handleMessage(message, bridge)
		return response ?? {}
	} catch {
		return jsonRpcError(isRecord(message) ? message.id : null, -32603, "Internal error")
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
