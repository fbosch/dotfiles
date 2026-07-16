import { attach, type Buffer, type NeovimClient } from "neovim"
import { hasProperties, isNumber, isRecord, isString } from "./nvim-utils"
import { bufferInfo, isDiagnostic, isSourceBuffer, windowInfo } from "./neovim-metadata"

const REQUEST_TIMEOUT_MS = 1000
export const MAX_READ_LINES = 500
export const MAX_READ_BYTES = 32 * 1024

const DIAGNOSTICS_LUA = `
local diagnostics = vim.diagnostic.get(...)
return vim.tbl_map(function(diagnostic)
  return {
    line = diagnostic.lnum,
    column = diagnostic.col,
    endLine = diagnostic.end_lnum or diagnostic.lnum,
    endColumn = diagnostic.end_col or diagnostic.col,
    severity = diagnostic.severity,
    message = diagnostic.message,
    source = diagnostic.source or "",
  }
end, diagnostics)
`

const BUFFER_INVENTORY_LUA = `
local listed = {}
for _, info in ipairs(vim.fn.getbufinfo({ buflisted = 1 })) do
  listed[info.bufnr] = true
end

local buffers = {}
for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
  if listed[buffer] then
    local options = vim.bo[buffer]
    table.insert(buffers, {
      number = buffer,
      name = vim.api.nvim_buf_get_name(buffer),
      loaded = vim.api.nvim_buf_is_loaded(buffer),
      filetype = options.filetype,
      buftype = options.buftype,
      modified = options.modified,
    })
  end
end
return buffers
`

const VISIBLE_WINDOWS_LUA = `
local windows = {}
for _, window in ipairs(vim.api.nvim_list_wins()) do
  local buffer = vim.api.nvim_win_get_buf(window)
  local options = vim.bo[buffer]
  local viewport = vim.fn.getwininfo(window)[1]
  table.insert(windows, {
    window = window,
    buffer = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    topline = viewport.topline,
    botline = viewport.botline,
  })
end
return windows
`

const BUFFER_INFO_GUARDS = { number: isNumber, name: isString, filetype: isString, buftype: isString, loaded: isBoolean, modified: isBoolean }
const VISIBLE_WINDOW_GUARDS = { window: isNumber, buffer: isNumber, name: isString, filetype: isString, buftype: isString, topline: isNumber, botline: isNumber }

export type BridgeError = {
	code: "NVIM_SOCKET_MISSING" | "NVIM_UNAVAILABLE" | "NVIM_INVALID_RESPONSE" | "NVIM_INVALID_ARGUMENT" | "NVIM_CONTENT_LIMIT"
	message: string
}

export type ActiveContext = {
	instance: { socket: string; pid: number; cwd: string }
	mode: string
	activeBuffer: BufferInfo
	cursor: { line: number; column: number }
	selection: null | { mode: string; start: { line: number; column: number }; end: { line: number; column: number } }
}

export type BridgeFailure = { ok: false; error: BridgeError }
export type BridgeResult = { ok: true; context: ActiveContext } | BridgeFailure
export type VisibleWindow = { window: number; buffer: number; name: string; filetype: string; buftype: string; topline: number; botline: number }
export type VisibleWindows = { instance: ActiveContext["instance"]; activeBuffer: BufferInfo; windows: VisibleWindow[]; sourceWindows: VisibleWindow[] }
export type VisibleWindowsResult = { ok: true; visibleWindows: VisibleWindows } | BridgeFailure
export type BufferInfo = { number: number; name: string; filetype: string; buftype: string; loaded: boolean; modified: boolean }
export type BufferInventory = { instance: ActiveContext["instance"]; buffers: BufferInfo[]; sourceBuffers: BufferInfo[] }
export type BufferInventoryResult = { ok: true; bufferInventory: BufferInventory } | BridgeFailure
export type BufferRead = { instance: ActiveContext["instance"]; buffer: BufferInfo; startLine: number; endLine: number; totalLines: number; lines: string[] }
export type BufferReadResult = { ok: true; bufferRead: BufferRead } | BridgeFailure
export type BufferReadOptions = { buffer?: number; startLine?: number; endLine?: number }
export type Diagnostic = { line: number; column: number; endLine: number; endColumn: number; severity: number; message: string; source: string }
export type DiagnosticsResult = { ok: true; diagnostics: { instance: ActiveContext["instance"]; buffer: BufferInfo; diagnostics: Diagnostic[] } } | BridgeFailure
export type FocusContextResult = { ok: true; focusContext: { instance: ActiveContext["instance"]; buffer: BufferInfo; cursor: { line: number; column: number } } } | BridgeFailure
export type NvimClientFactory = (socket: string) => NeovimClient

function bridgeError(code: BridgeError["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean"
}

function withTimeout<T>(request: Promise<T>): Promise<T> {
	return Promise.race([request, new Promise<never>(function(_, reject) { setTimeout(function() { reject(new Error("Neovim RPC request timed out")) }, REQUEST_TIMEOUT_MS) })])
}

function position(value: [number, number]): { line: number; column: number } {
	return { line: value[0], column: value[1] + 1 }
}

function readRange(options: BufferReadOptions, totalLines: number): { startLine: number; endLine: number } | BridgeFailure {
	const { startLine, endLine } = requestedRange(options, totalLines)
	if ([startLine > totalLines, endLine < startLine, endLine > totalLines].some(Boolean)) return bridgeError("NVIM_INVALID_ARGUMENT", `Choose a line range within 1-${totalLines}`)
	if (endLine - startLine + 1 > MAX_READ_LINES) return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_LINES} lines; narrow the requested range`)
	return { startLine, endLine }
}

function requestedRange(options: BufferReadOptions, totalLines: number): { startLine: number; endLine: number } {
	const startLine = options.startLine ?? 1
	return { startLine, endLine: options.endLine ?? Math.min(totalLines, startLine + MAX_READ_LINES - 1) }
}

function readSize(lines: string[]): BridgeFailure | undefined {
	if (new TextEncoder().encode(lines.join("\n")).byteLength <= MAX_READ_BYTES) return undefined
	return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_BYTES} bytes; narrow the requested range`)
}

function isReadableBuffer(metadata: BufferInfo) {
	return [metadata.loaded, isSourceBuffer(metadata)].every(Boolean)
}

function hasDiagnostics(value: unknown): value is Diagnostic[] {
	return Array.isArray(value) && value.every(isDiagnostic)
}

function isBufferInfo(value: unknown): value is BufferInfo {
	return hasProperties(value, BUFFER_INFO_GUARDS)
}

function isVisibleWindow(value: unknown): value is VisibleWindow {
	return hasProperties(value, VISIBLE_WINDOW_GUARDS)
}

function focusState(value: unknown): { buffer: number; cursor: { line: number; column: number } } | undefined {
	if (isRecord(value) === false || isNumber(value.buffer) === false) return undefined
	const cursor = focusCursor(value.cursor)
	return cursor === undefined ? undefined : { buffer: value.buffer, cursor }
}

function focusCursor(value: unknown): { line: number; column: number } | undefined {
	if (isRecord(value) === false) return undefined
	if (isNumber(value.line) === false || isNumber(value.column) === false) return undefined
	return { line: value.line, column: value.column }
}

export class NvimContextBridge {
	readonly #socket: string | undefined
	readonly #createClient: NvimClientFactory
	#client: NeovimClient | undefined
	#unavailable: BridgeError | undefined

	constructor(socket: string | undefined, createClient: NvimClientFactory = function(socket) { return attach({ socket }) }) {
		this.#socket = socket
		this.#createClient = createClient
	}

	async context(): Promise<BridgeResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const context = await this.#contextFrom(client.nvim)
			return { ok: true, context }
		} catch {
			return this.unavailable()
		}
	}

	async initialize(): Promise<BridgeResult> {
		return this.context()
	}

	async visibleWindows(): Promise<VisibleWindowsResult> {
		const context = await this.context()
		const client = this.client()
		if (context.ok === false) return context
		if ("error" in client) return client
		try {
			const windows = await this.visibleWindowSnapshot(client.nvim)
			return { ok: true, visibleWindows: { instance: context.context.instance, activeBuffer: context.context.activeBuffer, windows, sourceWindows: windows.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async bufferInventory(): Promise<BufferInventoryResult> {
		const context = await this.context()
		const client = this.client()
		if (context.ok === false) return context
		if ("error" in client) return client
		try {
			const buffers = await this.bufferInventorySnapshot(client.nvim)
			return { ok: true, bufferInventory: { instance: context.context.instance, buffers, sourceBuffers: buffers.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async readBuffer(options: BufferReadOptions): Promise<BufferReadResult> {
		const connection = await this.instanceConnection()
		if ("error" in connection) return connection
		try {
			const buffer = await this.selectedBuffer(connection.nvim, options.buffer)
			if (buffer === undefined) return this.invalidBuffer()
			return await this.readSelectedBuffer(connection.instance, buffer, options)
		} catch {
			return this.unavailable()
		}
	}

	async diagnostics(bufferNumber?: number): Promise<DiagnosticsResult> {
		const connection = await this.instanceConnection()
		if ("error" in connection) return connection
		try {
			const result = await this.diagnosticsFor(connection.nvim, bufferNumber)
			if ("error" in result) return result
			return { ok: true, diagnostics: { instance: connection.instance, ...result } }
		} catch {
			return this.unavailable()
		}
	}

	async focusContext(): Promise<FocusContextResult> {
		const connection = await this.instanceConnection()
		if ("error" in connection) return connection
		try {
			const focus = focusState(await withTimeout(connection.nvim.getVar("opencode_last_source_context")))
			if (focus === undefined) return this.missingFocusContext()
			return this.focusedSourceContext(connection.instance, connection.nvim, focus)
		} catch {
			return this.missingFocusContext()
		}
	}

	async #contextFrom(nvim: NeovimClient): Promise<ActiveContext> {
		const [pid, cwd, mode, activeBuffer, cursor] = await withTimeout(Promise.all([nvim.call("getpid"), nvim.call("getcwd"), nvim.mode, nvim.buffer.then(bufferInfo), nvim.window.then(function(window) { return window.cursor })]))
		if (isNumber(pid) === false || isString(cwd) === false || isString(mode.mode) === false) throw new Error("Neovim returned invalid context")
		const selection = await this.selection(nvim, mode.mode, activeBuffer)
		return { instance: { socket: this.#socket!, pid, cwd }, mode: mode.mode, activeBuffer, cursor: position(cursor), selection }
	}

	async instanceConnection(): Promise<{ instance: ActiveContext["instance"]; nvim: NeovimClient } | BridgeFailure> {
		const client = this.client()
		if ("error" in client) return client
		try {
			return { instance: await this.instance(client.nvim), nvim: client.nvim }
		} catch {
			return this.unavailable()
		}
	}

	async instance(nvim: NeovimClient): Promise<ActiveContext["instance"]> {
		const [pid, cwd] = await withTimeout(Promise.all([nvim.call("getpid"), nvim.call("getcwd")]))
		if (isNumber(pid) === false || isString(cwd) === false) throw new Error("Neovim returned invalid instance")
		return { socket: this.#socket!, pid, cwd }
	}

	async bufferInventorySnapshot(nvim: NeovimClient): Promise<BufferInfo[]> {
		const buffers = await withTimeout(nvim.executeLua(BUFFER_INVENTORY_LUA, []))
		if (Array.isArray(buffers) === false || buffers.every(isBufferInfo) === false) throw new Error("Neovim returned invalid buffer inventory")
		return buffers
	}

	async visibleWindowSnapshot(nvim: NeovimClient): Promise<VisibleWindow[]> {
		const windows = await withTimeout(nvim.executeLua(VISIBLE_WINDOWS_LUA, []))
		if (Array.isArray(windows) === false || windows.every(isVisibleWindow) === false) throw new Error("Neovim returned invalid visible windows")
		return windows
	}

	async selectedBuffer(nvim: NeovimClient, bufferNumber?: number): Promise<Buffer | undefined> {
		if (bufferNumber === undefined) return nvim.buffer
		return (await nvim.buffers).find(function(buffer) { return buffer.id === bufferNumber })
	}

	async diagnosticsFor(nvim: NeovimClient, bufferNumber?: number): Promise<{ buffer: BufferInfo; diagnostics: Diagnostic[] } | BridgeFailure> {
		const buffer = await this.selectedBuffer(nvim, bufferNumber)
		if (buffer === undefined) return this.invalidDiagnostics()
		const metadata = await withTimeout(bufferInfo(buffer))
		if (metadata.loaded === false) return this.invalidDiagnostics()
		const diagnostics = await withTimeout(nvim.executeLua(DIAGNOSTICS_LUA, [buffer.id]))
		return hasDiagnostics(diagnostics) ? { buffer: metadata, diagnostics } : this.invalidDiagnostics()
	}

	async readSelectedBuffer(instance: ActiveContext["instance"], buffer: Buffer, options: BufferReadOptions): Promise<BufferReadResult> {
		const [metadata, totalLines] = await withTimeout(Promise.all([bufferInfo(buffer), buffer.length]))
		if (isReadableBuffer(metadata) === false) return this.invalidBuffer()
		const range = readRange(options, totalLines)
		if ("error" in range) return range
		const lines = await withTimeout(buffer.getLines({ start: range.startLine - 1, end: range.endLine, strictIndexing: true }))
		const sizeError = readSize(lines)
		if (sizeError) return sizeError
		return { ok: true, bufferRead: { instance, buffer: metadata, startLine: range.startLine, endLine: range.endLine, totalLines, lines } }
	}

	async focusedSourceContext(instance: ActiveContext["instance"], nvim: NeovimClient, focus: { buffer: number; cursor: { line: number; column: number } }): Promise<FocusContextResult> {
		const buffer = await this.selectedBuffer(nvim, focus.buffer)
		if (buffer === undefined) return bridgeError("NVIM_INVALID_ARGUMENT", "The recent source buffer is no longer available")
		const metadata = await withTimeout(bufferInfo(buffer))
		if (isSourceBuffer(metadata) === false) return bridgeError("NVIM_INVALID_ARGUMENT", "The recent source buffer is no longer available")
		return { ok: true, focusContext: { instance, buffer: metadata, cursor: focus.cursor } }
	}

	#clientForSocket(): NeovimClient | BridgeFailure {
		if (typeof this.#socket !== "string" || this.#socket === "") {
			this.#unavailable = { code: "NVIM_SOCKET_MISSING", message: "NVIM_CONTEXT_SOCKET is required; no Neovim instance can be selected" }
			return { ok: false, error: this.#unavailable }
		}
		this.#client ??= this.#createClient(this.#socket)
		return this.#client
	}

	client(): { nvim: NeovimClient } | BridgeFailure {
		if (this.#unavailable) return { ok: false, error: this.#unavailable }
		const client = this.#clientForSocket()
		return "error" in client ? client : { nvim: client }
	}

	async selection(nvim: NeovimClient, mode: string, buffer: Buffer): Promise<ActiveContext["selection"]> {
		if (["v", "V", "\u0016"].includes(mode) === false) return null
		const [start, end] = await Promise.all([buffer.mark("<"), buffer.mark(">")])
		return { mode, start: position(start), end: position(end) }
	}

	invalidBuffer(): BridgeFailure {
		return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows")
	}

	invalidDiagnostics(): BridgeFailure {
		return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
	}

	missingFocusContext(): BridgeFailure {
		return bridgeError("NVIM_INVALID_ARGUMENT", "No recent source buffer is available")
	}

	unavailable(): BridgeFailure {
		this.#unavailable = { code: "NVIM_UNAVAILABLE", message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable" }
		return { ok: false, error: this.#unavailable }
	}
}
