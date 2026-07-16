const TOOL_NAME = "nvim_context"
const VISIBLE_WINDOWS_TOOL_NAME = "nvim_visible_windows"
const LIST_BUFFERS_TOOL_NAME = "nvim_list_buffers"
const READ_BUFFER_TOOL_NAME = "nvim_read_buffer"
const DIAGNOSTICS_TOOL_NAME = "nvim_diagnostics"
const PROTOCOL_VERSION = "2025-06-18"
const REQUEST_TIMEOUT_MS = 1000
const MAX_READ_LINES = 500
const MAX_READ_BYTES = 32 * 1024

const ACTIVE_CONTEXT_EXPRESSION = [
	"json_encode({",
	"'pid': getpid(),",
	"'cwd': getcwd(),",
	"'mode': mode(1),",
	"'buffer': {",
	"'number': bufnr('%'),",
	"'name': bufname('%'),",
	"'filetype': &filetype,",
	"'modified': &modified == 1,",
	"'loaded': bufloaded(bufnr('%')) == 1",
	"},",
	"'cursor': {'line': line('.'), 'column': col('.')},",
	"'selection': index(['v', 'V', nr2char(22)], mode(1)) >= 0",
	"? {",
	"'mode': mode(1),",
	"'start': {'line': getpos(\"'<\")[1], 'column': getpos(\"'<\")[2]},",
	"'end': {'line': getpos(\"'>\")[1], 'column': getpos(\"'>\")[2]}",
	"}",
	": v:null",
	"})",
].join(" ")

const VISIBLE_WINDOWS_EXPRESSION = [
	"json_encode({'windows': map(nvim_list_wins(), {_, win -> {",
	"'window': win,",
	"'buffer': nvim_win_get_buf(win),",
	"'name': nvim_buf_get_name(nvim_win_get_buf(win)),",
	"'filetype': getbufvar(nvim_win_get_buf(win), '&filetype'),",
	"'buftype': getbufvar(nvim_win_get_buf(win), '&buftype'),",
	"'topline': line('w0', win),",
	"'botline': line('w$', win)",
	"}})})",
].join(" ")

const BUFFER_INVENTORY_EXPRESSION = [
	"json_encode({'buffers': map(getbufinfo({'buflisted': 1}), {_, info -> {",
	"'number': info.bufnr,",
	"'name': bufname(info.bufnr),",
	"'filetype': getbufvar(info.bufnr, '&filetype'),",
	"'buftype': getbufvar(info.bufnr, '&buftype'),",
	"'loaded': bufloaded(info.bufnr) == 1,",
	"'modified': getbufvar(info.bufnr, '&modified') == 1",
	"}})})",
].join(" ")

type JsonRecord = Record<string, unknown>

export type BridgeError = {
	code: "NVIM_SOCKET_MISSING" | "NVIM_UNAVAILABLE" | "NVIM_INVALID_RESPONSE" | "NVIM_INVALID_ARGUMENT" | "NVIM_CONTENT_LIMIT"
	message: string
}

export type ActiveContext = {
	instance: {
		socket: string
		pid: number
		cwd: string
	}
	mode: string
	activeBuffer: {
		number: number
		name: string
		filetype: string
		modified: boolean
		loaded: boolean
	}
	cursor: {
		line: number
		column: number
	}
	selection: null | {
		mode: string
		start: { line: number; column: number }
		end: { line: number; column: number }
	}
}

export type BridgeFailure = { ok: false; error: BridgeError }

export type BridgeResult = { ok: true; context: ActiveContext } | BridgeFailure

export type VisibleWindow = {
	window: number
	buffer: number
	name: string
	filetype: string
	buftype: string
	topline: number
	botline: number
}

export type VisibleWindows = {
	instance: ActiveContext["instance"]
	activeBuffer: ActiveContext["activeBuffer"]
	windows: VisibleWindow[]
	sourceWindows: VisibleWindow[]
}

export type VisibleWindowsResult = { ok: true; visibleWindows: VisibleWindows } | BridgeFailure

export type BufferInfo = {
	number: number
	name: string
	filetype: string
	buftype: string
	loaded: boolean
	modified: boolean
}

export type BufferInventory = {
	instance: ActiveContext["instance"]
	buffers: BufferInfo[]
	sourceBuffers: BufferInfo[]
}

export type BufferInventoryResult = { ok: true; bufferInventory: BufferInventory } | BridgeFailure

export type BufferRead = {
	instance: ActiveContext["instance"]
	buffer: BufferInfo
	startLine: number
	endLine: number
	totalLines: number
	lines: string[]
}

export type BufferReadResult = { ok: true; bufferRead: BufferRead } | BridgeFailure

export type BufferReadOptions = {
	buffer?: number
	startLine?: number
	endLine?: number
}

export type Diagnostic = {
	line: number
	column: number
	endLine: number
	endColumn: number
	severity: number
	message: string
	source: string
}

export type DiagnosticsResult = { ok: true; diagnostics: { instance: ActiveContext["instance"]; buffer: BufferInfo; diagnostics: Diagnostic[] } } | BridgeFailure

type BufferMetadata = BufferInfo & { totalLines: number }

export type RemoteExpressionRunner = (socket: string, expression: string) => Promise<string>

function bridgeError(code: BridgeError["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null
}

function isNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function isString(value: unknown): value is string {
	return typeof value === "string"
}

function booleanValue(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value
	}

	if (value === 0) {
		return false
	}

	if (value === 1) {
		return true
	}
}

function isPosition(value: unknown): value is { line: number; column: number } {
	return isRecord(value) && isNumber(value.line) && isNumber(value.column)
}

function isSelection(value: unknown): value is NonNullable<ActiveContext["selection"]> {
	return isRecord(value) && isString(value.mode) && isPosition(value.start) && isPosition(value.end)
}

function parseActiveContext(socket: string, output: string): BridgeResult {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid context data")
	}

	if (isRecord(decoded) === false || isRecord(decoded.buffer) === false || isRecord(decoded.cursor) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned incomplete context data")
	}

	const { buffer, cursor, selection } = decoded
	const modified = booleanValue(buffer.modified)
	const loaded = booleanValue(buffer.loaded)
	if (
		isNumber(decoded.pid) === false ||
		isString(decoded.cwd) === false ||
		isString(decoded.mode) === false ||
		isNumber(buffer.number) === false ||
		isString(buffer.name) === false ||
		isString(buffer.filetype) === false ||
		modified === undefined ||
		loaded === undefined ||
		isPosition(cursor) === false
	) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid context fields")
	}

	if (selection !== null && isSelection(selection) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid selection data")
	}

	return {
		ok: true,
		context: {
			instance: { socket, pid: decoded.pid, cwd: decoded.cwd },
			mode: decoded.mode,
			activeBuffer: {
				number: buffer.number,
				name: buffer.name,
				filetype: buffer.filetype,
				modified,
				loaded,
			},
			cursor,
			selection: selection === null ? null : selection,
		},
	}
}

function isVisibleWindow(value: unknown): value is VisibleWindow {
	return (
		isRecord(value) &&
		isNumber(value.window) &&
		isNumber(value.buffer) &&
		isString(value.name) &&
		isString(value.filetype) &&
		isString(value.buftype) &&
		isNumber(value.topline) &&
		isNumber(value.botline)
	)
}

function parseBufferInfo(value: unknown): BufferInfo | undefined {
	if (isRecord(value) === false || isNumber(value.number) === false || isString(value.name) === false || isString(value.filetype) === false || isString(value.buftype) === false) {
		return undefined
	}

	const loaded = booleanValue(value.loaded)
	const modified = booleanValue(value.modified)
	if (loaded === undefined || modified === undefined) {
		return undefined
	}

	return {
		number: value.number,
		name: value.name,
		filetype: value.filetype,
		buftype: value.buftype,
		loaded,
		modified,
	}
}

function isSourceBuffer(buffer: BufferInfo) {
	return buffer.name !== "" && buffer.buftype === "" && buffer.filetype !== "opencode" && buffer.filetype !== "opencode_terminal"
}

function parseVisibleWindows(context: ActiveContext, output: string): VisibleWindowsResult {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid window data")
	}

	if (isRecord(decoded) === false || Array.isArray(decoded.windows) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned incomplete window data")
	}

	const windows = decoded.windows.filter(isVisibleWindow)
	if (windows.length !== decoded.windows.length) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid window data")
	}

	const sourceWindows = windows.filter(function(window) {
		return window.name !== "" && window.buftype === "" && window.filetype !== "opencode" && window.filetype !== "opencode_terminal"
	})

	return {
		ok: true,
		visibleWindows: {
			instance: context.instance,
			activeBuffer: context.activeBuffer,
			windows,
			sourceWindows,
		},
	}
}

function parseBufferInventory(context: ActiveContext, output: string): BufferInventoryResult {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid buffer data")
	}

	if (isRecord(decoded) === false || Array.isArray(decoded.buffers) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned incomplete buffer data")
	}

	const parsedBuffers = decoded.buffers.map(parseBufferInfo)
	if (parsedBuffers.some(function(buffer) { return buffer === undefined })) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid buffer data")
	}
	const buffers = parsedBuffers.filter(function(buffer): buffer is BufferInfo { return buffer !== undefined })

	return {
		ok: true,
		bufferInventory: {
			instance: context.instance,
			buffers,
			sourceBuffers: buffers.filter(isSourceBuffer),
		},
	}
}

function bufferMetadataExpression(buffer: number) {
	return `json_encode(bufexists(${buffer}) && bufloaded(${buffer}) ? {'number': ${buffer}, 'name': bufname(${buffer}), 'filetype': getbufvar(${buffer}, '&filetype'), 'buftype': getbufvar(${buffer}, '&buftype'), 'loaded': bufloaded(${buffer}) == 1, 'modified': getbufvar(${buffer}, '&modified') == 1, 'totalLines': nvim_buf_line_count(${buffer})} : v:null)`
}

function parseBufferMetadata(output: string): BufferMetadata | undefined {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return undefined
	}

	const buffer = parseBufferInfo(decoded)
	if (buffer === undefined || isRecord(decoded) === false || isNumber(decoded.totalLines) === false) {
		return undefined
	}

	return { ...buffer, totalLines: decoded.totalLines }
}

function bufferLinesExpression(buffer: number, startLine: number, endLine: number) {
	return `json_encode({'lines': nvim_buf_get_lines(${buffer}, ${startLine - 1}, ${endLine}, v:false)})`
}

function diagnosticsExpression(buffer: number) {
	return `json_encode(bufexists(${buffer}) && bufloaded(${buffer}) ? {'buffer': {'number': ${buffer}, 'name': bufname(${buffer}), 'filetype': getbufvar(${buffer}, '&filetype'), 'buftype': getbufvar(${buffer}, '&buftype'), 'loaded': bufloaded(${buffer}) == 1, 'modified': getbufvar(${buffer}, '&modified') == 1}, 'diagnostics': luaeval("vim.tbl_map(function(d) return {line=d.lnum, column=d.col, endLine=d.end_lnum or d.lnum, endColumn=d.end_col or d.col, severity=d.severity, message=d.message, source=d.source or ''} end, vim.diagnostic.get(_A))", ${buffer})} : v:null)`
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return isRecord(value) && isNumber(value.line) && isNumber(value.column) && isNumber(value.endLine) && isNumber(value.endColumn) && isNumber(value.severity) && isString(value.message) && isString(value.source)
}

function parseDiagnostics(context: ActiveContext, output: string): DiagnosticsResult {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
	}

	if (isRecord(decoded) === false || Array.isArray(decoded.diagnostics) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned incomplete diagnostic data")
	}

	const buffer = parseBufferInfo(decoded.buffer)
	if (buffer === undefined || decoded.diagnostics.every(isDiagnostic) === false) {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
	}

	return { ok: true, diagnostics: { instance: context.instance, buffer, diagnostics: decoded.diagnostics } }
}

function parseBufferLines(output: string): string[] | undefined {
	let decoded: unknown

	try {
		decoded = JSON.parse(output)
	} catch {
		return undefined
	}

	if (isRecord(decoded) === false || Array.isArray(decoded.lines) === false || decoded.lines.every(isString) === false) {
		return undefined
	}

	return decoded.lines
}

export async function runRemoteExpression(socket: string, expression: string): Promise<string> {
	const process = Bun.spawn(["nvim", "--server", socket, "--remote-expr", expression], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const timeout = setTimeout(() => process.kill(), REQUEST_TIMEOUT_MS)
	const [exitCode, stdout, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	])
	clearTimeout(timeout)

	if (exitCode !== 0) {
		const detail = stderr.trim()
		throw new Error(detail === "" ? "Neovim RPC request failed" : detail)
	}

	return stdout.trim()
}

export class NvimContextBridge {
	readonly #socket: string | undefined
	readonly #run: RemoteExpressionRunner
	#unavailable: BridgeError | undefined

	constructor(socket: string | undefined, run: RemoteExpressionRunner = runRemoteExpression) {
		this.#socket = socket
		this.#run = run
	}

	async context(): Promise<BridgeResult> {
		if (this.#unavailable) {
			return { ok: false, error: this.#unavailable }
		}

		if (typeof this.#socket !== "string" || this.#socket === "") {
			this.#unavailable = {
				code: "NVIM_SOCKET_MISSING",
				message: "NVIM_CONTEXT_SOCKET is required; no Neovim instance can be selected",
			}
			return { ok: false, error: this.#unavailable }
		}

		try {
			const output = await this.#run(this.#socket, ACTIVE_CONTEXT_EXPRESSION)
			const result = parseActiveContext(this.#socket, output)
			if (result.ok === false) {
				this.#unavailable = result.error
			}
			return result
		} catch {
			this.#unavailable = {
				code: "NVIM_UNAVAILABLE",
				message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
			}
			return { ok: false, error: this.#unavailable }
		}
	}

	async initialize(): Promise<BridgeResult> {
		return this.context()
	}

	async visibleWindows(): Promise<VisibleWindowsResult> {
		const context = await this.context()
		if (context.ok === false) {
			return context
		}

		try {
			const output = await this.#run(context.context.instance.socket, VISIBLE_WINDOWS_EXPRESSION)
			const result = parseVisibleWindows(context.context, output)
			if (result.ok === false) {
				this.#unavailable = result.error
			}
			return result
		} catch {
			this.#unavailable = {
				code: "NVIM_UNAVAILABLE",
				message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
			}
			return { ok: false, error: this.#unavailable }
		}
	}

	async bufferInventory(): Promise<BufferInventoryResult> {
		const context = await this.context()
		if (context.ok === false) {
			return context
		}

		try {
			const output = await this.#run(context.context.instance.socket, BUFFER_INVENTORY_EXPRESSION)
			const result = parseBufferInventory(context.context, output)
			if (result.ok === false) {
				this.#unavailable = result.error
			}
			return result
		} catch {
			this.#unavailable = {
				code: "NVIM_UNAVAILABLE",
				message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
			}
			return { ok: false, error: this.#unavailable }
		}
	}

	async readBuffer(options: BufferReadOptions): Promise<BufferReadResult> {
		const context = await this.context()
		if (context.ok === false) {
			return context
		}

		const bufferNumber = options.buffer ?? context.context.activeBuffer.number
		try {
			const metadataOutput = await this.#run(context.context.instance.socket, bufferMetadataExpression(bufferNumber))
			const buffer = parseBufferMetadata(metadataOutput)
			if (buffer === undefined || isSourceBuffer(buffer) === false) {
				return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows")
			}

			const startLine = options.startLine ?? 1
			const endLine = options.endLine ?? Math.min(buffer.totalLines, startLine + MAX_READ_LINES - 1)
			if (startLine > buffer.totalLines || endLine < startLine || endLine > buffer.totalLines) {
				return bridgeError("NVIM_INVALID_ARGUMENT", `Choose a line range within 1-${buffer.totalLines}`)
			}
			if (endLine - startLine + 1 > MAX_READ_LINES) {
				return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_LINES} lines; narrow the requested range`)
			}

			const linesOutput = await this.#run(context.context.instance.socket, bufferLinesExpression(bufferNumber, startLine, endLine))
			const lines = parseBufferLines(linesOutput)
			if (lines === undefined) {
				this.#unavailable = {
					code: "NVIM_INVALID_RESPONSE",
					message: "The bound Neovim instance returned invalid buffer content",
				}
				return { ok: false, error: this.#unavailable }
			}
			if (new TextEncoder().encode(lines.join("\n")).byteLength > MAX_READ_BYTES) {
				return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_BYTES} bytes; narrow the requested range`)
			}

			return {
				ok: true,
				bufferRead: {
					instance: context.context.instance,
					buffer,
					startLine,
					endLine,
					totalLines: buffer.totalLines,
					lines,
				},
			}
		} catch {
			this.#unavailable = {
				code: "NVIM_UNAVAILABLE",
				message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
			}
			return { ok: false, error: this.#unavailable }
		}
	}

	async diagnostics(buffer?: number): Promise<DiagnosticsResult> {
		const context = await this.context()
		if (context.ok === false) {
			return context
		}

		try {
			const output = await this.#run(context.context.instance.socket, diagnosticsExpression(buffer ?? context.context.activeBuffer.number))
			const result = parseDiagnostics(context.context, output)
			if (result.ok === false) {
				this.#unavailable = result.error
			}
			return result
		} catch {
			this.#unavailable = {
				code: "NVIM_UNAVAILABLE",
				message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
			}
			return { ok: false, error: this.#unavailable }
		}
	}
}

function toolResult(result: BridgeResult | VisibleWindowsResult | BufferInventoryResult | BufferReadResult | DiagnosticsResult) {
	if ("error" in result) {
		return {
			content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
			isError: true,
		}
	}

	let data: unknown
	if ("context" in result) {
		data = result.context
	} else if ("visibleWindows" in result) {
		data = result.visibleWindows
	} else if ("bufferInventory" in result) {
		data = result.bufferInventory
	} else if ("bufferRead" in result) {
		data = result.bufferRead
	} else {
		data = result.diagnostics
	}
	return {
		content: [{ type: "text", text: JSON.stringify(data) }],
	}
}

function parseReadOptions(params: unknown): BufferReadOptions | BridgeFailure {
	if (isRecord(params) === false || params.arguments === undefined) {
		return {}
	}
	if (isRecord(params.arguments) === false) {
		return bridgeError("NVIM_INVALID_ARGUMENT", "Buffer read arguments must be an object")
	}

	for (const key of Object.keys(params.arguments)) {
		if (key !== "buffer" && key !== "startLine" && key !== "endLine") {
			return bridgeError("NVIM_INVALID_ARGUMENT", `Unsupported buffer read argument: ${key}`)
		}
	}

	const buffer = optionalPositiveInteger(params.arguments.buffer)
	const startLine = optionalPositiveInteger(params.arguments.startLine)
	const endLine = optionalPositiveInteger(params.arguments.endLine)
	if (buffer === null || startLine === null || endLine === null) {
		return bridgeError("NVIM_INVALID_ARGUMENT", "Buffer and line values must be positive integers")
	}

	return { buffer, startLine, endLine }
}

function optionalPositiveInteger(value: unknown): number | undefined | null {
	if (value === undefined) {
		return undefined
	}

	if (isNumber(value) && Number.isInteger(value) && value >= 1) {
		return value
	}

	return null
}

function jsonRpcError(id: unknown, code: number, message: string) {
	return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

export async function handleMessage(message: unknown, bridge: NvimContextBridge): Promise<JsonRecord | undefined> {
	if (isRecord(message) === false || isString(message.method) === false) {
		return jsonRpcError(null, -32600, "Invalid Request")
	}

	const id = message.id
	if (message.method === "notifications/initialized") {
		return undefined
	}

	if (message.method === "initialize") {
		return {
			jsonrpc: "2.0",
			id: id ?? null,
			result: {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: { name: "neovim-context", version: "0.1.0" },
			},
		}
	}

	if (message.method === "tools/list") {
		return {
			jsonrpc: "2.0",
			id: id ?? null,
			result: {
				tools: [
					{
						name: TOOL_NAME,
						description: "Get live context from the Neovim instance bound to this OpenCode server.",
						inputSchema: { type: "object", additionalProperties: false },
					},
					{
						name: VISIBLE_WINDOWS_TOOL_NAME,
						description: "Get visible Neovim windows and the source buffers visible beside OpenCode.",
						inputSchema: { type: "object", additionalProperties: false },
					},
					{
						name: LIST_BUFFERS_TOOL_NAME,
						description: "List buffers from the Neovim instance bound to this OpenCode server.",
						inputSchema: { type: "object", additionalProperties: false },
					},
					{
						name: READ_BUFFER_TOOL_NAME,
						description: `Read up to ${MAX_READ_LINES} lines or ${MAX_READ_BYTES} bytes from a loaded source buffer in Neovim memory.`,
						inputSchema: {
							type: "object",
							properties: {
								buffer: { type: "integer", minimum: 1 },
								startLine: { type: "integer", minimum: 1 },
								endLine: { type: "integer", minimum: 1 },
							},
							additionalProperties: false,
						},
					},
					{
						name: DIAGNOSTICS_TOOL_NAME,
						description: "Get current diagnostics and their source buffer from the bound Neovim instance.",
						inputSchema: {
							type: "object",
							properties: { buffer: { type: "integer", minimum: 1 } },
							additionalProperties: false,
						},
					},
				],
			},
		}
	}

	if (message.method === "tools/call") {
		const name = isRecord(message.params) ? message.params.name : undefined
		if (name === TOOL_NAME) {
			return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.context()) }
		}

		if (name === VISIBLE_WINDOWS_TOOL_NAME) {
			return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.visibleWindows()) }
		}

		if (name === LIST_BUFFERS_TOOL_NAME) {
			return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.bufferInventory()) }
		}

		if (name === READ_BUFFER_TOOL_NAME) {
			const options = parseReadOptions(isRecord(message.params) ? message.params : undefined)
			if ("error" in options) {
				return { jsonrpc: "2.0", id: id ?? null, result: toolResult(options) }
			}
			return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.readBuffer(options)) }
		}

		if (name === DIAGNOSTICS_TOOL_NAME) {
			const arguments_ = isRecord(message.params) && isRecord(message.params.arguments) ? message.params.arguments : {}
			const buffer = optionalPositiveInteger(arguments_.buffer)
			if (buffer === null) {
				return { jsonrpc: "2.0", id: id ?? null, result: toolResult(bridgeError("NVIM_INVALID_ARGUMENT", "Buffer must be a positive integer")) }
			}
			return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.diagnostics(buffer)) }
		}


		return jsonRpcError(id, -32602, `Unknown tool: ${String(name)}`)
	}

	return jsonRpcError(id, -32601, "Method not found")
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
		if (done) {
			return
		}

		pending += decoder.decode(value, { stream: true })
		let newline = pending.indexOf("\n")
		while (newline >= 0) {
			const line = pending.slice(0, newline).trim()
			pending = pending.slice(newline + 1)
			newline = pending.indexOf("\n")

			if (line === "") {
				continue
			}

			let response: JsonRecord | undefined
			try {
				response = await handleMessage(JSON.parse(line), bridge)
			} catch {
				response = jsonRpcError(null, -32700, "Parse error")
			}

			if (response) {
				process.stdout.write(`${JSON.stringify(response)}\n`)
			}
		}
	}
}

if (import.meta.main) {
	const bridge = new NvimContextBridge(process.env.NVIM_CONTEXT_SOCKET)
	if (Bun.argv.includes("--health")) {
		await runHealthCheck(bridge)
	} else {
		await bridge.initialize()
		await runStdioServer(bridge)
	}
}
