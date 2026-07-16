import { attach, type Buffer, type NeovimClient } from "neovim"
import { hasProperties, isNumber, isRecord, isString } from "./nvim-utils"
import { bufferInfo, isDiagnostic, isSourceBuffer } from "./neovim-metadata"

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
local function buffer_info(buffer)
  local options = vim.bo[buffer]
  return {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = vim.api.nvim_buf_is_loaded(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  }
end

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
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  activeBuffer = buffer_info(vim.api.nvim_get_current_buf()),
  windows = windows,
}
`

const BUFFER_READ_LUA = `
local buffer, start_line, end_line, max_bytes = ...
local lines = vim.api.nvim_buf_get_lines(buffer, start_line, end_line, true)
local bytes = #lines - 1
for _, line in ipairs(lines) do
  bytes = bytes + #line
  if bytes > max_bytes then return { tooLarge = true } end
end
return { lines = lines }
`

const ACTIVE_CONTEXT_LUA = `
local buffer = vim.api.nvim_get_current_buf()
local options = vim.bo[buffer]
local mode = vim.api.nvim_get_mode().mode
local cursor = vim.api.nvim_win_get_cursor(0)
local selection = vim.NIL
if mode == "v" or mode == "V" or mode == string.char(22) then
  local start = vim.api.nvim_buf_get_mark(buffer, "<")
  local finish = vim.api.nvim_buf_get_mark(buffer, ">")
  selection = {
    mode = mode,
    start = { line = start[1], column = start[2] + 1 },
    ["end"] = { line = finish[1], column = finish[2] + 1 },
  }
end
return {
  pid = vim.fn.getpid(),
  cwd = vim.fn.getcwd(),
  mode = mode,
  activeBuffer = {
    number = buffer,
    name = vim.api.nvim_buf_get_name(buffer),
    loaded = vim.api.nvim_buf_is_loaded(buffer),
    filetype = options.filetype,
    buftype = options.buftype,
    modified = options.modified,
  },
  cursor = { line = cursor[1], column = cursor[2] + 1 },
  selection = selection,
}
`

const BUFFER_INFO_GUARDS = { number: isNumber, name: isString, filetype: isString, buftype: isString, loaded: isBoolean, modified: isBoolean }
const VISIBLE_WINDOW_GUARDS = { window: isNumber, buffer: isNumber, name: isString, filetype: isString, buftype: isString, topline: isNumber, botline: isNumber }
const VISIBLE_WINDOWS_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, activeBuffer: isBufferInfo, windows: isVisibleWindowList }
const POSITION_GUARDS = { line: isNumber, column: isNumber }
const SELECTION_GUARDS = { mode: isString, start: isPosition, end: isPosition }
const ACTIVE_CONTEXT_SNAPSHOT_GUARDS = { pid: isNumber, cwd: isString, mode: isString, activeBuffer: isBufferInfo, cursor: isPosition, selection: isSelection }

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
export type TimeoutObserver = { created(): void; cleared(): void; fired(): void }

function bridgeError(code: BridgeError["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean"
}

function withTimeout<T>(request: Promise<T>, observer?: TimeoutObserver): Promise<T> {
	let timer: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>(function(_, reject) {
		observer?.created()
		timer = setTimeout(function() {
			observer?.fired()
			reject(new Error("Neovim RPC request timed out"))
		}, REQUEST_TIMEOUT_MS)
	})
	return Promise.race([request, timeout]).finally(function() {
		clearTimeout(timer)
		observer?.cleared()
	})
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

function isVisibleWindowList(value: unknown): value is VisibleWindow[] {
	return Array.isArray(value) && value.every(isVisibleWindow)
}

function isVisibleWindowsSnapshot(value: unknown): value is { pid: number; cwd: string; activeBuffer: BufferInfo; windows: VisibleWindow[] } {
	return hasProperties(value, VISIBLE_WINDOWS_SNAPSHOT_GUARDS)
}

function isPosition(value: unknown): value is { line: number; column: number } {
	return hasProperties(value, POSITION_GUARDS)
}

function isSelection(value: unknown): value is ActiveContext["selection"] {
	return value === null || hasProperties(value, SELECTION_GUARDS)
}

function isActiveContextSnapshot(value: unknown): value is Omit<ActiveContext, "instance"> & { pid: number; cwd: string } {
	return hasProperties(value, ACTIVE_CONTEXT_SNAPSHOT_GUARDS)
}

function isOversizedRead(value: unknown) {
	return isRecord(value) && value.tooLarge === true
}

function hasReadLines(value: unknown): value is { lines: string[] } {
	return isRecord(value) && Array.isArray(value.lines) && value.lines.every(isString)
}

function readLines(value: unknown): string[] | BridgeFailure {
	if (isOversizedRead(value)) return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_BYTES} bytes; narrow the requested range`)
	if (hasReadLines(value)) return value.lines
	throw new Error("Neovim returned invalid buffer content")
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
	readonly #timeoutObserver: TimeoutObserver | undefined
	#client: NeovimClient | undefined
	#unavailable: BridgeError | undefined

	constructor(socket: string | undefined, createClient: NvimClientFactory = function(socket) { return attach({ socket }) }, timeoutObserver?: TimeoutObserver) {
		this.#socket = socket
		this.#createClient = createClient
		this.#timeoutObserver = timeoutObserver
	}

	async context(): Promise<BridgeResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const snapshot = await this.activeContextSnapshot(client.nvim)
			const context = { instance: { socket: this.#socket!, pid: snapshot.pid, cwd: snapshot.cwd }, mode: snapshot.mode, activeBuffer: snapshot.activeBuffer, cursor: snapshot.cursor, selection: snapshot.selection }
			return { ok: true, context }
		} catch {
			return this.unavailable()
		}
	}

	async initialize(): Promise<BridgeResult> {
		return this.context()
	}

	async visibleWindows(): Promise<VisibleWindowsResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const snapshot = await this.visibleWindowSnapshot(client.nvim)
			return { ok: true, visibleWindows: { instance: { socket: this.#socket!, pid: snapshot.pid, cwd: snapshot.cwd }, activeBuffer: snapshot.activeBuffer, windows: snapshot.windows, sourceWindows: snapshot.windows.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async bufferInventory(): Promise<BufferInventoryResult> {
		const client = this.client()
		if ("error" in client) return client
		try {
			const [instance, buffers] = await Promise.all([this.instance(client.nvim), this.bufferInventorySnapshot(client.nvim)])
			return { ok: true, bufferInventory: { instance, buffers, sourceBuffers: buffers.filter(isSourceBuffer) } }
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
			return await this.readSelectedBuffer(connection.instance, connection.nvim, buffer, options)
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
			const focus = focusState(await withTimeout(connection.nvim.getVar("opencode_last_source_context"), this.#timeoutObserver))
			if (focus === undefined) return this.missingFocusContext()
			return this.focusedSourceContext(connection.instance, connection.nvim, focus)
		} catch {
			return this.missingFocusContext()
		}
	}

	async activeContextSnapshot(nvim: NeovimClient): Promise<Omit<ActiveContext, "instance"> & { pid: number; cwd: string }> {
		const snapshot = await withTimeout(nvim.executeLua(ACTIVE_CONTEXT_LUA, []), this.#timeoutObserver)
		if (isActiveContextSnapshot(snapshot) === false) throw new Error("Neovim returned invalid context")
		return snapshot
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
		const [pid, cwd] = await withTimeout(Promise.all([nvim.call("getpid"), nvim.call("getcwd")]), this.#timeoutObserver)
		if (isNumber(pid) === false || isString(cwd) === false) throw new Error("Neovim returned invalid instance")
		return { socket: this.#socket!, pid, cwd }
	}

	async bufferInventorySnapshot(nvim: NeovimClient): Promise<BufferInfo[]> {
		const buffers = await withTimeout(nvim.executeLua(BUFFER_INVENTORY_LUA, []), this.#timeoutObserver)
		if (Array.isArray(buffers) === false || buffers.every(isBufferInfo) === false) throw new Error("Neovim returned invalid buffer inventory")
		return buffers
	}

	async visibleWindowSnapshot(nvim: NeovimClient): Promise<{ pid: number; cwd: string; activeBuffer: BufferInfo; windows: VisibleWindow[] }> {
		const snapshot = await withTimeout(nvim.executeLua(VISIBLE_WINDOWS_LUA, []), this.#timeoutObserver)
		if (isVisibleWindowsSnapshot(snapshot) === false) throw new Error("Neovim returned invalid visible windows")
		return snapshot
	}

	async selectedBuffer(nvim: NeovimClient, bufferNumber?: number): Promise<Buffer | undefined> {
		if (bufferNumber === undefined) return nvim.buffer
		return (await nvim.buffers).find(function(buffer) { return buffer.id === bufferNumber })
	}

	async diagnosticsFor(nvim: NeovimClient, bufferNumber?: number): Promise<{ buffer: BufferInfo; diagnostics: Diagnostic[] } | BridgeFailure> {
		const buffer = await this.selectedBuffer(nvim, bufferNumber)
		if (buffer === undefined) return this.invalidDiagnostics()
		const metadata = await withTimeout(bufferInfo(buffer), this.#timeoutObserver)
		if (metadata.loaded === false) return this.invalidDiagnostics()
		const diagnostics = await withTimeout(nvim.executeLua(DIAGNOSTICS_LUA, [buffer.id]), this.#timeoutObserver)
		return hasDiagnostics(diagnostics) ? { buffer: metadata, diagnostics } : this.invalidDiagnostics()
	}

	async readSelectedBuffer(instance: ActiveContext["instance"], nvim: NeovimClient, buffer: Buffer, options: BufferReadOptions): Promise<BufferReadResult> {
		const [metadata, totalLines] = await withTimeout(Promise.all([bufferInfo(buffer), buffer.length]), this.#timeoutObserver)
		if (isReadableBuffer(metadata) === false) return this.invalidBuffer()
		const range = readRange(options, totalLines)
		if ("error" in range) return range
		const lines = readLines(await withTimeout(nvim.executeLua(BUFFER_READ_LUA, [buffer.id, range.startLine - 1, range.endLine, MAX_READ_BYTES]), this.#timeoutObserver))
		if ("error" in lines) return lines
		return { ok: true, bufferRead: { instance, buffer: metadata, startLine: range.startLine, endLine: range.endLine, totalLines, lines } }
	}

	async focusedSourceContext(instance: ActiveContext["instance"], nvim: NeovimClient, focus: { buffer: number; cursor: { line: number; column: number } }): Promise<FocusContextResult> {
		const buffer = await this.selectedBuffer(nvim, focus.buffer)
		if (buffer === undefined) return bridgeError("NVIM_INVALID_ARGUMENT", "The recent source buffer is no longer available")
		const metadata = await withTimeout(bufferInfo(buffer), this.#timeoutObserver)
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
