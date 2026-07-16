import { attach, type Buffer, type NeovimClient, type Window } from "neovim"
import { isNumber, isRecord, isString } from "./nvim-utils"

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

export type NvimClientFactory = (socket: string) => NeovimClient

function bridgeError(code: BridgeError["code"], message: string): BridgeFailure {
	return { ok: false, error: { code, message } }
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return isRecord(value) && isNumber(value.line) && isNumber(value.column) && isNumber(value.endLine) && isNumber(value.endColumn) && isNumber(value.severity) && isString(value.message) && isString(value.source)
}

function isSourceBuffer(buffer: BufferInfo) {
	return buffer.name !== "" && buffer.buftype === "" && buffer.filetype !== "opencode" && buffer.filetype !== "opencode_terminal"
}

function withTimeout<T>(request: Promise<T>): Promise<T> {
	return Promise.race([
		request,
		new Promise<never>(function(_, reject) {
			setTimeout(function() { reject(new Error("Neovim RPC request timed out")) }, REQUEST_TIMEOUT_MS)
		}),
	])
}

async function bufferInfo(buffer: Buffer): Promise<BufferInfo> {
	const [name, loaded, filetype, buftype, modified] = await Promise.all([
		buffer.name,
		buffer.loaded,
		buffer.getOption("filetype"),
		buffer.getOption("buftype"),
		buffer.getOption("modified"),
	])

	if (isString(name) === false || typeof loaded !== "boolean" || isString(filetype) === false || isString(buftype) === false || typeof modified !== "boolean") {
		throw new Error("Neovim returned invalid buffer metadata")
	}

	return { number: buffer.id, name, filetype, buftype, loaded, modified }
}

async function windowInfo(window: Window): Promise<VisibleWindow> {
	const [buffer, windowInfo] = await Promise.all([
		window.buffer,
		window.request("nvim_call_function", ["getwininfo", [window.id]]),
	])
	const [metadata, wininfo] = await Promise.all([bufferInfo(buffer), windowInfo])
	if (Array.isArray(wininfo) === false || isRecord(wininfo[0]) === false || isNumber(wininfo[0].topline) === false || isNumber(wininfo[0].botline) === false) {
		throw new Error("Neovim returned invalid window metadata")
	}

	return { window: window.id, buffer: metadata.number, name: metadata.name, filetype: metadata.filetype, buftype: metadata.buftype, topline: wininfo[0].topline, botline: wininfo[0].botline }
}

function position(value: [number, number]): { line: number; column: number } {
	return { line: value[0], column: value[1] + 1 }
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
			const [pid, cwd, mode, activeBuffer, cursor] = await withTimeout(Promise.all([
				client.nvim.call("getpid"),
				client.nvim.call("getcwd"),
				client.nvim.mode,
				client.nvim.buffer.then(bufferInfo),
				client.nvim.window.then(function(window) { return window.cursor }),
			]))
			if (isNumber(pid) === false || isString(cwd) === false || isString(mode.mode) === false) throw new Error("Neovim returned invalid context")

			const selection = await this.selection(client.nvim, mode.mode, activeBuffer)
			return { ok: true, context: { instance: { socket: this.#socket!, pid, cwd }, mode: mode.mode, activeBuffer, cursor: position(cursor), selection } }
		} catch {
			return this.unavailable()
		}
	}

	async initialize(): Promise<BridgeResult> {
		return this.context()
	}

	async visibleWindows(): Promise<VisibleWindowsResult> {
		const context = await this.context()
		if (context.ok === false) return context
		const client = this.client()
		if ("error" in client) return client

		try {
			const windows = await withTimeout(client.nvim.windows.then(function(windows) { return Promise.all(windows.map(windowInfo)) }))
			return { ok: true, visibleWindows: { instance: context.context.instance, activeBuffer: context.context.activeBuffer, windows, sourceWindows: windows.filter(function(window) { return isSourceBuffer(window) }) } }
		} catch {
			return this.unavailable()
		}
	}

	async bufferInventory(): Promise<BufferInventoryResult> {
		const context = await this.context()
		if (context.ok === false) return context
		const client = this.client()
		if ("error" in client) return client

		try {
			const [buffers, listedBufferInfo] = await withTimeout(Promise.all([
				client.nvim.buffers.then(function(buffers) { return Promise.all(buffers.map(bufferInfo)) }),
				client.nvim.call("getbufinfo", [{ buflisted: 1 }]),
			]))
			if (Array.isArray(listedBufferInfo) === false) throw new Error("Neovim returned invalid buffer inventory")
			const listedBufferNumbers = new Set(listedBufferInfo.map(function(buffer) { return isRecord(buffer) ? buffer.bufnr : undefined }).filter(isNumber))
			const listedBuffers = buffers.filter(function(buffer) { return listedBufferNumbers.has(buffer.number) })
			return { ok: true, bufferInventory: { instance: context.context.instance, buffers: listedBuffers, sourceBuffers: listedBuffers.filter(isSourceBuffer) } }
		} catch {
			return this.unavailable()
		}
	}

	async readBuffer(options: BufferReadOptions): Promise<BufferReadResult> {
		const context = await this.context()
		if (context.ok === false) return context
		const client = this.client()
		if ("error" in client) return client

		try {
			const buffer = options.buffer === undefined ? await client.nvim.buffer : (await client.nvim.buffers).find(function(buffer) { return buffer.id === options.buffer })
			if (buffer === undefined) return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows")
			const [metadata, totalLines] = await withTimeout(Promise.all([bufferInfo(buffer), buffer.length]))
			if (metadata.loaded === false || isSourceBuffer(metadata) === false) return bridgeError("NVIM_INVALID_ARGUMENT", "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows")

			const startLine = options.startLine ?? 1
			const endLine = options.endLine ?? Math.min(totalLines, startLine + MAX_READ_LINES - 1)
			if (startLine > totalLines || endLine < startLine || endLine > totalLines) return bridgeError("NVIM_INVALID_ARGUMENT", `Choose a line range within 1-${totalLines}`)
			if (endLine - startLine + 1 > MAX_READ_LINES) return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_LINES} lines; narrow the requested range`)

			const lines = await withTimeout(buffer.getLines({ start: startLine - 1, end: endLine, strictIndexing: true }))
			if (new TextEncoder().encode(lines.join("\n")).byteLength > MAX_READ_BYTES) return bridgeError("NVIM_CONTENT_LIMIT", `Read at most ${MAX_READ_BYTES} bytes; narrow the requested range`)
			return { ok: true, bufferRead: { instance: context.context.instance, buffer: metadata, startLine, endLine, totalLines, lines } }
		} catch {
			return this.unavailable()
		}
	}

	async diagnostics(bufferNumber?: number): Promise<DiagnosticsResult> {
		const context = await this.context()
		if (context.ok === false) return context
		const client = this.client()
		if ("error" in client) return client

		try {
			const buffer = bufferNumber === undefined ? await client.nvim.buffer : (await client.nvim.buffers).find(function(buffer) { return buffer.id === bufferNumber })
			if (buffer === undefined) return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
			const metadata = await withTimeout(bufferInfo(buffer))
			if (metadata.loaded === false) return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
			const diagnostics = await withTimeout(client.nvim.executeLua(DIAGNOSTICS_LUA, [buffer.id]))
			if (Array.isArray(diagnostics) === false || diagnostics.every(isDiagnostic) === false) return bridgeError("NVIM_INVALID_RESPONSE", "The bound Neovim instance returned invalid diagnostic data")
			return { ok: true, diagnostics: { instance: context.context.instance, buffer: metadata, diagnostics } }
		} catch {
			return this.unavailable()
		}
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

	unavailable(): BridgeFailure {
		this.#unavailable = { code: "NVIM_UNAVAILABLE", message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable" }
		return { ok: false, error: this.#unavailable }
	}
}
