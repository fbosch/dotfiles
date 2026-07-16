type JsonRecord = Record<string, unknown>

const encoder = new TextEncoder()
const decoder = new TextDecoder()
let label = "fixture"

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null
}

function append(left: Uint8Array, right: Uint8Array) {
	const result = new Uint8Array(left.length + right.length)
	result.set(left)
	result.set(right, left.length)
	return result
}

function headerEnd(value: Uint8Array) {
	for (let index = 0; index <= value.length - 4; index += 1) {
		if (value[index] === 13 && value[index + 1] === 10 && value[index + 2] === 13 && value[index + 3] === 10) return index
	}
	return -1
}

function contentLength(header: string) {
	const line = header.split("\r\n").find(function(value) { return value.toLowerCase().startsWith("content-length:") })
	if (line === undefined) throw new Error("LSP message is missing Content-Length")
	const length = Number(line.slice("content-length:".length).trim())
	if (Number.isInteger(length) === false || length < 0) throw new Error("LSP message has an invalid Content-Length")
	return length
}

function response(id: unknown, result: unknown) {
	const body = JSON.stringify({ jsonrpc: "2.0", id, result })
	process.stdout.write(`Content-Length: ${encoder.encode(body).byteLength}\r\n\r\n${body}`)
}

function initializedLabel(params: unknown) {
	if (isRecord(params) === false || isRecord(params.initializationOptions) === false) return
	if (typeof params.initializationOptions.label === "string") label = params.initializationOptions.label
}

function hoverResult(params: unknown) {
	if (label === "large-hover") return { contents: { kind: "markdown", value: "x".repeat(32769) } }
	if (isRecord(params) === false || isRecord(params.position) === false) return { contents: { kind: "markdown", value: `${label} hover` } }
	const { line, character } = params.position
	return { contents: { kind: "markdown", value: `${label} hover at ${line}:${character}` } }
}

async function handle(value: unknown) {
	if (isRecord(value) === false || typeof value.method !== "string") return false
	if (value.method === "initialize") {
		initializedLabel(value.params)
		response(value.id ?? null, { capabilities: { hoverProvider: true, documentSymbolProvider: true, positionEncoding: "utf-16" } })
		return false
	}
	if (value.method === "textDocument/hover") {
		if (label === "slow-hover") await Bun.sleep(1000)
		response(value.id ?? null, hoverResult(value.params))
		return false
	}
	if (value.method === "textDocument/documentSymbol") {
		response(value.id ?? null, [{ name: `${label} symbol`, kind: 12, detail: "fixture", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } } }])
		return false
	}
	if (value.method === "shutdown") {
		response(value.id ?? null, null)
		return false
	}
	return value.method === "exit"
}

async function run() {
	const reader = Bun.stdin.stream().getReader()
	let pending = new Uint8Array()
	while (true) {
		const { done, value } = await reader.read()
		if (done) return
		pending = append(pending, value)
		while (true) {
			const boundary = headerEnd(pending)
			if (boundary < 0) break
			const length = contentLength(decoder.decode(pending.slice(0, boundary)))
			const bodyStart = boundary + 4
			if (pending.length < bodyStart + length) break
			const message = JSON.parse(decoder.decode(pending.slice(bodyStart, bodyStart + length)))
			pending = pending.slice(bodyStart + length)
			if (await handle(message)) return
		}
	}
}

if (import.meta.main) await run()
