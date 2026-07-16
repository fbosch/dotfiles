const TOOL_NAME = "nvim_context"
const PROTOCOL_VERSION = "2025-06-18"
const REQUEST_TIMEOUT_MS = 1000

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

type JsonRecord = Record<string, unknown>

export type BridgeError = {
	code: "NVIM_SOCKET_MISSING" | "NVIM_UNAVAILABLE" | "NVIM_INVALID_RESPONSE"
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

export type BridgeResult =
	| { ok: true; context: ActiveContext }
	| { ok: false; error: BridgeError }

export type RemoteExpressionRunner = (socket: string, expression: string) => Promise<string>

function bridgeError(code: BridgeError["code"], message: string): BridgeResult {
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

	if (selection !== null && (isRecord(selection) === false || isString(selection.mode) === false || isPosition(selection.start) === false || isPosition(selection.end) === false)) {
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
}

function toolResult(result: BridgeResult) {
	if (result.ok) {
		return {
			content: [{ type: "text", text: JSON.stringify(result.context) }],
		}
	}

	return {
		content: [{ type: "text", text: JSON.stringify({ error: result.error }) }],
		isError: true,
	}
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
				],
			},
		}
	}

	if (message.method === "tools/call") {
		const name = isRecord(message.params) ? message.params.name : undefined
		if (name !== TOOL_NAME) {
			return jsonRpcError(id, -32602, `Unknown tool: ${String(name)}`)
		}

		return { jsonrpc: "2.0", id: id ?? null, result: toolResult(await bridge.context()) }
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
