import { expect, test } from "bun:test"
import { NvimContextBridge, handleMessage, runRemoteExpression } from "./neovim-context"

const context = JSON.stringify({
	pid: 1234,
	cwd: "/workspace/example",
	mode: "n",
	buffer: {
		number: 7,
		name: "/workspace/example/src/main.ts",
		filetype: "typescript",
		modified: true,
		loaded: true,
	},
	cursor: { line: 12, column: 4 },
	selection: null,
})

async function startNvim(commands: string[] = []) {
	const socket = `/tmp/neovim-context-${process.pid}-${crypto.randomUUID()}.sock`
	const arguments_ = ["nvim", "-u", "NONE", "--headless", "--cmd", "set noswapfile", ...commands.flatMap(function(command) { return ["--cmd", command] }), "--listen", socket]
	const nvimProcess = Bun.spawn(arguments_, {
		stdout: "ignore",
		stderr: "ignore",
	})
	await Bun.sleep(100)
	return { nvimProcess, socket }
}

test("returns active context from only its configured socket", async () => {
	const calls: string[] = []
	const bridge = new NvimContextBridge("/tmp/nvim-one.sock", async (socket) => {
		calls.push(socket)
		return context
	})

	const result = await bridge.context()

	expect(calls).toEqual(["/tmp/nvim-one.sock"])
	expect(result).toEqual({
		ok: true,
		context: {
			instance: { socket: "/tmp/nvim-one.sock", pid: 1234, cwd: "/workspace/example" },
			mode: "n",
			activeBuffer: {
				number: 7,
				name: "/workspace/example/src/main.ts",
				filetype: "typescript",
				modified: true,
				loaded: true,
			},
			cursor: { line: 12, column: 4 },
			selection: null,
		},
	})
})

test("fails when no socket is configured", async () => {
	const bridge = new NvimContextBridge(undefined)

	expect(await bridge.context()).toEqual({
		ok: false,
		error: {
			code: "NVIM_SOCKET_MISSING",
			message: "NVIM_CONTEXT_SOCKET is required; no Neovim instance can be selected",
		},
	})
})

test("fails when the bound Neovim instance closes", async () => {
	const { nvimProcess, socket } = await startNvim()
	const bridge = new NvimContextBridge(socket)

	expect((await bridge.context()).ok).toBe(true)
	nvimProcess.kill()
	await nvimProcess.exited

	expect(await bridge.context()).toEqual({
		ok: false,
		error: {
			code: "NVIM_UNAVAILABLE",
			message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable",
		},
	})
})

test("reads live context from the bound Neovim instance", async () => {
	const { nvimProcess, socket } = await startNvim()
	const bridge = new NvimContextBridge(socket)

	try {
		const result = await bridge.context()
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.context.instance.socket).toBe(socket)
			expect(result.context.instance.pid).toBeGreaterThan(0)
		}
	} finally {
		nvimProcess.kill()
		await nvimProcess.exited
	}
})

test("exposes only curated read-only tools", async () => {
	const bridge = new NvimContextBridge("/tmp/nvim-one.sock", async () => context)
	const response = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, bridge)

	expect(response).toEqual({
		jsonrpc: "2.0",
		id: 1,
		result: {
			tools: [
				{
					name: "nvim_context",
					description: "Get live context from the Neovim instance bound to this OpenCode server.",
					inputSchema: { type: "object", additionalProperties: false },
				},
				{
					name: "nvim_visible_windows",
					description: "Get visible Neovim windows and the source buffers visible beside OpenCode.",
					inputSchema: { type: "object", additionalProperties: false },
				},
				{
					name: "nvim_list_buffers",
					description: "List buffers from the Neovim instance bound to this OpenCode server.",
					inputSchema: { type: "object", additionalProperties: false },
				},
				{
					name: "nvim_read_buffer",
					description: "Read up to 500 lines or 32768 bytes from a loaded source buffer in Neovim memory.",
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
					name: "nvim_diagnostics",
					description: "Get current diagnostics and their source buffer from the bound Neovim instance.",
					inputSchema: {
						type: "object",
						properties: { buffer: { type: "integer", minimum: 1 } },
						additionalProperties: false,
					},
				},
			],
		},
	})
})

test("identifies visible source buffers beside OpenCode windows", async () => {
	let requests = 0
	const bridge = new NvimContextBridge("/tmp/nvim-one.sock", async () => {
		requests += 1
		return requests === 1
			? context
			: JSON.stringify({
					windows: [
						{
							window: 1,
							buffer: 7,
							name: "/workspace/example/src/main.ts",
							filetype: "typescript",
							buftype: "",
							topline: 4,
							botline: 48,
						},
						{
							window: 2,
							buffer: 8,
							name: "",
							filetype: "opencode",
							buftype: "nofile",
							topline: 1,
							botline: 80,
						},
					],
				})
	})

	const result = await bridge.visibleWindows()

	expect(result).toMatchObject({
		ok: true,
		visibleWindows: {
			sourceWindows: [
				{
					window: 1,
					name: "/workspace/example/src/main.ts",
					topline: 4,
					botline: 48,
				},
			],
		},
	})
})

test("reads unsaved lines from a bound Neovim source buffer", async () => {
	const { nvimProcess, socket } = await startNvim([
		"file bridge-unsaved.lua",
		"call setline(1, ['local unsaved = true', 'return unsaved'])",
	])
	const bridge = new NvimContextBridge(socket)

	try {
		const inventory = await bridge.bufferInventory()
		expect(inventory.ok).toBe(true)
		if (inventory.ok === false) {
			return
		}

		const sourceBuffer = inventory.bufferInventory.sourceBuffers[0]
		expect(sourceBuffer).toMatchObject({ name: expect.stringContaining("bridge-unsaved.lua"), modified: true })

		const read = await bridge.readBuffer({ buffer: sourceBuffer.number })
		expect(read).toMatchObject({
			ok: true,
			bufferRead: {
				buffer: { number: sourceBuffer.number, modified: true },
				lines: ["local unsaved = true", "return unsaved"],
			},
		})
	} finally {
		nvimProcess.kill()
		await nvimProcess.exited
	}
})

test("rejects ranges larger than the read limit", async () => {
	let requests = 0
	const bridge = new NvimContextBridge("/tmp/nvim-one.sock", async () => {
		requests += 1
		if (requests === 1) {
			return context
		}
		return JSON.stringify({
			number: 7,
			name: "/workspace/example/src/main.ts",
			filetype: "typescript",
			buftype: "",
			loaded: true,
			modified: true,
			totalLines: 1000,
		})
	})

	expect(await bridge.readBuffer({ buffer: 7, startLine: 1, endLine: 501 })).toEqual({
		ok: false,
		error: {
			code: "NVIM_CONTENT_LIMIT",
			message: "Read at most 500 lines; narrow the requested range",
		},
	})
})

test("rejects content larger than the byte limit", async () => {
	let requests = 0
	const bridge = new NvimContextBridge("/tmp/nvim-one.sock", async () => {
		requests += 1
		if (requests === 1) {
			return context
		}
		if (requests === 2) {
			return JSON.stringify({
				number: 7,
				name: "/workspace/example/src/main.ts",
				filetype: "typescript",
				buftype: "",
				loaded: true,
				modified: true,
				totalLines: 1,
			})
		}
		return JSON.stringify({ lines: ["x".repeat(32769)] })
	})

	expect(await bridge.readBuffer({ buffer: 7 })).toEqual({
		ok: false,
		error: {
			code: "NVIM_CONTENT_LIMIT",
			message: "Read at most 32768 bytes; narrow the requested range",
		},
	})
})

test("reads diagnostics added to a bound Neovim buffer", async () => {
	const { nvimProcess, socket } = await startNvim([
		"file bridge-diagnostics.lua",
		"call setline(1, ['local value = unknown'])",
	])
	const bridge = new NvimContextBridge(socket)

	try {
		expect((await bridge.context()).ok).toBe(true)
		await runRemoteExpression(socket, `luaeval("(function() vim.diagnostic.set(vim.api.nvim_create_namespace('bridge-test'), 0, {{lnum = 0, col = 14, severity = vim.diagnostic.severity.ERROR, message = 'unknown variable', source = 'bridge-test'}}); return true end)()")`)
		const result = await bridge.diagnostics(1)
		expect(result).toMatchObject({
			ok: true,
			diagnostics: {
				buffer: { name: expect.stringContaining("bridge-diagnostics.lua") },
				diagnostics: [
					{
						line: 0,
						column: 14,
						severity: 1,
						message: "unknown variable",
						source: "bridge-test",
					},
				],
			},
		})
	} finally {
		nvimProcess.kill()
		await nvimProcess.exited
	}
})
