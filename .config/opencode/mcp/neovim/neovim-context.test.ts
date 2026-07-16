import { expect, test } from "bun:test"
import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { attach } from "neovim"
import { NvimContextBridge, handleMessage } from "./neovim-context"

async function startNvim(commands: string[] = [], cwd?: string) {
	const socket = `/tmp/neovim-context-${process.pid}-${crypto.randomUUID()}.sock`
	const arguments_ = ["nvim", "-u", "NONE", "--headless", "--cmd", "set noswapfile", ...commands.flatMap(function(command) { return ["--cmd", command] }), "--listen", socket]
	const nvimProcess = Bun.spawn(arguments_, { cwd, stdout: "ignore", stderr: "ignore" })
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await access(socket)
			break
		} catch {
			if (attempt === 99) throw new Error(`Neovim socket did not become available: ${socket}`)
			await Bun.sleep(10)
		}
	}
	return { nvimProcess, socket }
}

async function withNvim(commands: string[], run: (bridge: NvimContextBridge, socket: string) => Promise<void>) {
	const { nvimProcess, socket } = await startNvim(commands)
	try {
		await run(new NvimContextBridge(socket), socket)
	} finally {
		nvimProcess.kill()
		await nvimProcess.exited
	}
}

test("fails closed when no socket is configured", async () => {
	expect(await new NvimContextBridge(undefined).context()).toEqual({
		ok: false,
		error: { code: "NVIM_SOCKET_MISSING", message: "NVIM_CONTEXT_SOCKET is required; no Neovim instance can be selected" },
	})
})

test("reads live context only from the configured socket", async () => {
	await withNvim(["file bridge-context.lua"], async function(bridge, socket) {
		const result = await bridge.context()
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.context.instance.socket).toBe(socket)
			expect(result.context.instance.pid).toBeGreaterThan(0)
			expect(result.context).toMatchObject({ mode: "n", cursor: { line: 1, column: 1 }, selection: null })
			expect(result.context.activeBuffer.name).toContain("bridge-context.lua")
		}
	})
})

test("reads visual selection from the configured socket", async () => {
	await withNvim(["file bridge-selection.lua", "call setline(1, ['first', 'second'])", "call cursor(1, 1)", "normal! vj"], async function(bridge) {
		expect(await bridge.context()).toMatchObject({
			ok: true,
			context: {
				mode: "v",
				cursor: { line: 2, column: 1 },
				selection: { mode: "v", start: { line: 0, column: 1 }, end: { line: 0, column: 1 } },
			},
		})
		expect(await bridge.selection()).toMatchObject({
			ok: true,
			selection: {
				buffer: { name: expect.stringContaining("bridge-selection.lua") },
				mode: "v",
				anchor: { line: 1, column: 1 },
				cursor: { line: 2, column: 1 },
				lines: ["first", "s"],
			},
		})
	})
})

test("rejects an inactive visual selection", async () => {
	await withNvim([], async function(bridge) {
		expect(await bridge.selection()).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "No active source selection is available" } })
	})
})

test("fails closed after the bound Neovim instance exits", async () => {
	const { nvimProcess, socket } = await startNvim()
	const bridge = new NvimContextBridge(socket)
	expect((await bridge.context()).ok).toBe(true)
	nvimProcess.kill()
	await nvimProcess.exited
	expect(await bridge.context()).toEqual({
		ok: false,
		error: { code: "NVIM_UNAVAILABLE", message: "The Neovim instance bound to NVIM_CONTEXT_SOCKET is unavailable" },
	})
})

test("uses the official client to read unsaved source buffers", async () => {
	await withNvim(["file bridge-unsaved.lua", "call setline(1, ['local unsaved = true', 'return unsaved'])"], async function(bridge) {
		const inventory = await bridge.bufferInventory()
		expect(inventory.ok).toBe(true)
		if (inventory.ok === false) return
		const sourceBuffer = inventory.bufferInventory.sourceBuffers[0]
		expect(sourceBuffer).toMatchObject({ name: expect.stringContaining("bridge-unsaved.lua"), modified: true })

		expect(await bridge.readBuffer({ buffer: sourceBuffer.number })).toMatchObject({
			ok: true,
			bufferRead: { buffer: { number: sourceBuffer.number, modified: true }, lines: ["local unsaved = true", "return unsaved"] },
		})
	})
})

test("collects listed buffers and visible windows in fixed snapshots", async () => {
	await withNvim(["edit bridge-inventory-one.lua", "vsplit", "edit bridge-inventory-two.lua"], async function(bridge, socket) {
		const inventory = await bridge.bufferInventory()
		expect(inventory).toMatchObject({
			ok: true,
			bufferInventory: {
				instance: { socket },
				sourceBuffers: expect.arrayContaining([
					expect.objectContaining({ name: expect.stringContaining("bridge-inventory-one.lua"), loaded: true, filetype: "", buftype: "", modified: false }),
					expect.objectContaining({ name: expect.stringContaining("bridge-inventory-two.lua"), loaded: true, filetype: "", buftype: "", modified: false }),
				]),
			},
		})

		const visible = await bridge.visibleWindows()
		expect(visible).toMatchObject({
			ok: true,
			visibleWindows: {
				instance: { socket },
				activeBuffer: { name: expect.stringContaining("bridge-inventory-two.lua"), loaded: true, filetype: "", buftype: "", modified: false },
				sourceWindows: expect.arrayContaining([
					expect.objectContaining({ name: expect.stringContaining("bridge-inventory-one.lua"), filetype: "", buftype: "", topline: 1 }),
					expect.objectContaining({ name: expect.stringContaining("bridge-inventory-two.lua"), filetype: "", buftype: "", topline: 1 }),
				]),
			},
		})
	})
})

test("enforces read line and byte limits", async () => {
	const tooManyLines = Array.from({ length: 501 }, function() { return "line" }).join("', '")
	await withNvim(["file bridge-line-limit.lua", `call setline(1, ['${tooManyLines}'])`], async function(bridge) {
		expect(await bridge.readBuffer({ startLine: 1, endLine: 501 })).toMatchObject({ error: { code: "NVIM_CONTENT_LIMIT" } })
	})
	await withNvim(["file bridge-byte-limit.lua", `call setline(1, ['${"x".repeat(32769)}'])`], async function(bridge) {
		expect(await bridge.readBuffer({})).toMatchObject({ error: { code: "NVIM_CONTENT_LIMIT" } })
	})
})

test("accepts a read at the UTF-8 byte limit", async () => {
	await withNvim(["file bridge-byte-boundary.lua", `call setline(1, ['${"\u00e9".repeat(16384)}'])`], async function(bridge) {
		expect(await bridge.readBuffer({})).toMatchObject({ ok: true, bufferRead: { lines: ["\u00e9".repeat(16384)] } })
	})
})

test("preserves invalid-buffer and range errors", async () => {
	await withNvim(["file bridge-read-errors.lua", "call setline(1, ['line'])"], async function(bridge) {
		expect(await bridge.readBuffer({ buffer: 999 })).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "Choose a loaded source buffer from nvim_list_buffers or nvim_visible_windows" } })
		expect(await bridge.readBuffer({ startLine: 2 })).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "Choose a line range within 1-1" } })
	})
})

test("reads diagnostics through the official client", async () => {
	await withNvim(["file bridge-diagnostics.lua", "call setline(1, ['local value = unknown'])"], async function(bridge, socket) {
		const nvim = attach({ socket })
		await nvim.executeLua("vim.diagnostic.set(vim.api.nvim_create_namespace('bridge-test'), 0, {{ lnum = 0, col = 14, severity = vim.diagnostic.severity.ERROR, message = 'unknown variable', source = 'bridge-test' }})")
		expect(await bridge.diagnostics(1)).toMatchObject({
			ok: true,
			diagnostics: { buffer: { name: expect.stringContaining("bridge-diagnostics.lua") }, diagnostics: [{ line: 0, column: 14, severity: 1, message: "unknown variable", source: "bridge-test" }] },
		})
	})
})

test("rejects diagnostics from an unavailable buffer", async () => {
	await withNvim([], async function(bridge) {
		expect(await bridge.diagnostics(999)).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" } })
	})
})

test("returns the recorded source context after focus leaves the buffer", async () => {
	await withNvim(["file bridge-focus.lua", "call setline(1, ['local focused = true'])"], async function(bridge, socket) {
		const nvim = attach({ socket })
		await nvim.setVar("opencode_last_source_context", { buffer: 1, cursor: { line: 1, column: 1 } })
		expect(await bridge.focusContext()).toMatchObject({
			ok: true,
			focusContext: { instance: { socket }, buffer: { name: expect.stringContaining("bridge-focus.lua") }, cursor: { line: 1, column: 1 } },
		})
	})
})

test("rejects missing or stale focus context", async () => {
	await withNvim([], async function(bridge, socket) {
		expect(await bridge.focusContext()).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "No recent source buffer is available" } })
		const nvim = attach({ socket })
		await nvim.setVar("opencode_last_source_context", { buffer: 999, cursor: { line: 1, column: 1 } })
		expect(await bridge.focusContext()).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "The recent source buffer is no longer available" } })
	})
})

test("advertises connected-server instructions, focused context, and selections", async () => {
	const response = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, new NvimContextBridge(undefined))
	expect(response).toMatchObject({ result: { instructions: expect.stringContaining("Prefer nvim_focus_context") } })
	const tools = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, new NvimContextBridge(undefined))
	expect(tools).toMatchObject({ result: { tools: expect.arrayContaining([expect.objectContaining({ name: "nvim_focus_context" }), expect.objectContaining({ name: "nvim_selection" })]) } })
})

test("isolates context, source reads, visible windows, and diagnostics across sibling worktrees", async () => {
	const root = await mkdtemp(join(tmpdir(), "neovim-context-worktrees-"))
	const worktrees = { alpha: join(root, "alpha"), beta: join(root, "beta") }
	await Promise.all([mkdir(worktrees.alpha), mkdir(worktrees.beta)])
	await Promise.all([
		Bun.write(join(worktrees.alpha, "source.lua"), "return 'alpha on disk'\n"),
		Bun.write(join(worktrees.beta, "source.lua"), "return 'beta on disk'\n"),
	])

	const instances = await Promise.all(Object.entries(worktrees).map(async function([name, cwd]) {
		const source = join(cwd, "source.lua")
		const { nvimProcess, socket } = await startNvim([
			`edit ${source}`,
			`call setline(1, ['${name} unsaved source', "return '${name}'"])`,
		], cwd)
		const nvim = attach({ socket })
		await nvim.executeLua("vim.diagnostic.set(vim.api.nvim_create_namespace('bridge-isolation-test'), 0, {{ lnum = 0, col = 0, severity = vim.diagnostic.severity.ERROR, message = 'diagnostic from " + name + "', source = 'bridge-isolation-test' }})")
		return { name, cwd, nvimProcess, socket, bridge: new NvimContextBridge(socket) }
	}))

	try {
		const results = await Promise.all(instances.map(async function(instance) {
			const [context, read, visible, diagnostics] = await Promise.all([
				instance.bridge.context(),
				instance.bridge.readBuffer({}),
				instance.bridge.visibleWindows(),
				instance.bridge.diagnostics(),
			])
			return { instance, context, read, visible, diagnostics }
		}))

		for (const result of results) {
			expect(result.context).toMatchObject({ ok: true, context: { instance: { socket: result.instance.socket, cwd: result.instance.cwd }, activeBuffer: { name: expect.stringContaining(result.instance.name) } } })
			expect(result.read).toMatchObject({ ok: true, bufferRead: { instance: { socket: result.instance.socket, cwd: result.instance.cwd }, lines: [`${result.instance.name} unsaved source`, `return '${result.instance.name}'`] } })
			expect(result.visible).toMatchObject({ ok: true, visibleWindows: { instance: { socket: result.instance.socket, cwd: result.instance.cwd }, sourceWindows: [{ name: expect.stringContaining(result.instance.name) }] } })
			expect(result.diagnostics).toMatchObject({ ok: true, diagnostics: { instance: { socket: result.instance.socket, cwd: result.instance.cwd }, buffer: { name: expect.stringContaining(result.instance.name) }, diagnostics: [{ message: `diagnostic from ${result.instance.name}` }] } })
		}
	} finally {
		await Promise.all(instances.map(async function(instance) {
			instance.nvimProcess.kill()
			await instance.nvimProcess.exited
		}))
		await rm(root, { recursive: true, force: true })
	}
})

test("keeps the curated MCP tool contract", async () => {
	const response = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, new NvimContextBridge(undefined))
	expect(response).toMatchObject({ jsonrpc: "2.0", id: 1 })
	if (response && "result" in response && typeof response.result === "object" && response.result !== null && "tools" in response.result && Array.isArray(response.result.tools)) {
		expect(response.result.tools.map(function(tool) { return tool.name })).toEqual(["nvim_context", "nvim_visible_windows", "nvim_list_buffers", "nvim_read_buffer", "nvim_diagnostics", "nvim_focus_context", "nvim_selection"])
	}
})
