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

async function withNvim(commands: string[], run: (bridge: NvimContextBridge, socket: string) => Promise<void>, cwd?: string) {
	const { nvimProcess, socket } = await startNvim(commands, cwd)
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

test("reports bounded quickfix and location-list entries", async () => {
	await withNvim(["file bridge-quickfix.lua"], async function(bridge, socket) {
		const nvim = attach({ socket })
		await nvim.executeLua("vim.fn.setqflist({}, 'r', { title = 'quickfix fixture', items = {{ bufnr = 1, lnum = 2, col = 3, text = 'first quickfix', type = 'E' }, { bufnr = 1, lnum = 4, col = 5, text = 'second quickfix', type = 'W' }} }); vim.fn.setloclist(0, {}, 'r', { title = 'location fixture', items = {{ bufnr = 1, lnum = 6, col = 7, text = 'location entry', type = 'I' }} })")
		expect(await bridge.quickfix({ kind: "quickfix", maxItems: 1 })).toMatchObject({ ok: true, quickfix: { kind: "quickfix", title: "quickfix fixture", total: 2, items: [{ line: 2, column: 3, text: "first quickfix", type: "E", valid: true }] } })
		expect(await bridge.quickfix({ kind: "location", maxItems: 20 })).toMatchObject({ ok: true, quickfix: { kind: "location", title: "location fixture", total: 1, items: [{ line: 6, column: 7, text: "location entry", type: "I", valid: true }] } })
	})
})

test("reveals existing source buffers without stealing focus unless requested", async () => {
	await withNvim(["edit bridge-reveal-one.lua", "call setline(1, ['first', 'second'])", "vsplit", "edit bridge-reveal-two.lua"], async function(bridge, socket) {
		const nvim = attach({ socket })
		const reveal = await bridge.reveal({ buffer: 1, line: 2, column: 1, focus: false, split: "none" })
		expect(reveal).toMatchObject({ ok: true, reveal: { buffer: { number: 1 }, position: { line: 2, column: 1 }, focused: false, splitCreated: false } })
		expect(await nvim.executeLua("return vim.api.nvim_get_current_buf()", [])).toBe(2)
		expect(await bridge.reveal({ buffer: 1, line: 1, column: 1, focus: true, split: "horizontal" })).toMatchObject({ ok: true, reveal: { buffer: { number: 1 }, focused: true, splitCreated: true } })
		expect(await nvim.executeLua("return vim.api.nvim_get_current_buf()", [])).toBe(1)
	})
})

test("creates bounded temporary highlights without changing buffer text", async () => {
	await withNvim(["file bridge-highlight.lua"], async function(bridge, socket) {
		const nvim = attach({ socket })
		const lines = Array.from({ length: 100 }, function(_, index) { return `line ${index + 1}` })
		await nvim.executeLua("vim.api.nvim_buf_set_lines(1, 0, -1, true, ...)", [lines])
		const result = await bridge.highlight({ buffer: 1, startLine: 80, startColumn: 1, endLine: 80, endColumn: 4, durationMs: 30000, reveal: true })
		expect(result).toMatchObject({ ok: true, highlight: { buffer: { number: 1 }, start: { line: 80, column: 1 }, end: { line: 80, column: 4 }, expiresInMs: 30000, revealed: true } })
		if (result.ok === false) return
		const marks = await nvim.executeLua("return vim.api.nvim_buf_get_extmarks(1, vim.api.nvim_create_namespace('opencode_mcp_presentation'), 0, -1, {})")
		expect(marks).toEqual([expect.arrayContaining([result.highlight.highlightId, 79, 0])])
		expect(await nvim.executeLua("local viewport = vim.fn.getwininfo(vim.api.nvim_get_current_win())[1]; return { visible = viewport.topline <= 80 and viewport.botline >= 80, cursor = vim.api.nvim_win_get_cursor(0) }", [])).toEqual({ visible: true, cursor: [80, 0] })
		expect(await bridge.readBuffer({ buffer: 1, startLine: 80, endLine: 80 })).toMatchObject({ ok: true, bufferRead: { lines: ["line 80"] } })
		expect(await bridge.clearHighlight({ buffer: 1, highlightId: result.highlight.highlightId })).toEqual({ ok: true, clearHighlight: { cleared: true } })
		expect(await bridge.clearHighlight({ buffer: 1, highlightId: result.highlight.highlightId })).toEqual({ ok: true, clearHighlight: { cleared: false } })
		const mcpResult = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "highlight", arguments: { buffer: 1, startLine: 1, durationMs: 20 } } }, bridge)
		expect(mcpResult).toMatchObject({ result: { content: [expect.objectContaining({ text: expect.stringContaining("highlightId") })] } })
		const expiring = await bridge.highlight({ buffer: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, durationMs: 20, reveal: false })
		expect(expiring.ok).toBe(true)
		await Bun.sleep(50)
		expect(await nvim.executeLua("return vim.api.nvim_buf_get_extmarks(1, vim.api.nvim_create_namespace('opencode_mcp_presentation'), 0, -1, {})", [])).toEqual([])
	})
})

test("opens a workspace file before highlighting it", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "neovim-highlight-path-"))
	const source = join(workspace, "source.lua")
	const target = join(workspace, "target.lua")
	await Bun.write(source, "return 'source'\n")
	await Bun.write(target, "return 'target'\n")
	try {
		await withNvim([`edit ${source}`], async function(bridge, socket) {
			expect(await bridge.highlight({ path: "../outside.lua", startLine: 1, durationMs: 20, reveal: true })).toMatchObject({ error: { code: "NVIM_INVALID_ARGUMENT", message: "Choose a readable workspace-relative file path" } })
			const result = await bridge.highlight({ path: "target.lua", startLine: 1, durationMs: 20, reveal: true })
			expect(result).toMatchObject({ ok: true, highlight: { buffer: { name: target }, start: { line: 1, column: 1 }, end: { line: 1, column: 16 }, revealed: true } })
			const nvim = attach({ socket })
			expect(await nvim.executeLua("return vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(0))", [])).toBe(target)
		}, workspace)
	} finally {
		await rm(workspace, { recursive: true, force: true })
	}
})

test("adds a bounded temporary inline annotation", async () => {
	await withNvim(["file bridge-annotation.lua", "call setline(1, ['return true'])"], async function(bridge, socket) {
		const result = await bridge.annotate({ buffer: 1, line: 1, anchor: "true", text: "Explain this boundary", kind: "warning", durationMs: 20, reveal: true })
		expect(result).toMatchObject({ ok: true, annotation: { buffer: { number: 1 }, line: 1, column: 8, text: "Explain this boundary", kind: "warning", placement: "callout", revealed: true } })
		const nvim = attach({ socket })
		const marks = await nvim.executeLua("return vim.api.nvim_buf_get_extmarks(1, vim.api.nvim_create_namespace('opencode_mcp_presentation'), 0, -1, { details = true })", [])
		expect(marks).toEqual([expect.arrayContaining([expect.any(Number), 0, 0, expect.objectContaining({ virt_lines_above: false, virt_lines_overflow: "scroll" })])])
		expect(marks[0][3].virt_lines[0]).toEqual([["       ", ""], ["└──── ", "OpencodeAnnotationWarning"], ["Explain this boundary", "OpencodeAnnotationWarning"]])
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
		await nvim.executeLua("vim.diagnostic.set(vim.api.nvim_create_namespace('bridge-test'), 0, {{ lnum = 0, col = 14, severity = vim.diagnostic.severity.WARN, message = 'warning', source = 'bridge-test' }, { lnum = 0, col = 10, severity = vim.diagnostic.severity.ERROR, message = 'unknown variable', source = 'bridge-test' }, { lnum = 2, col = 0, severity = vim.diagnostic.severity.HINT, message = 'hint', source = 'bridge-test' }})")
		const diagnostics = await bridge.diagnostics(1)
		expect(diagnostics).toMatchObject({
			ok: true,
			diagnostics: { buffer: { name: expect.stringContaining("bridge-diagnostics.lua") } },
		})
		if (diagnostics.ok) expect(diagnostics.diagnostics.diagnostics.some(function(diagnostic) { return diagnostic.line === 0 && diagnostic.column === 10 && diagnostic.severity === 1 && diagnostic.message === "unknown variable" && diagnostic.source === "bridge-test" })).toBe(true)
		expect(await bridge.diagnosticSummary({ buffer: 1, maxItems: 2 })).toMatchObject({
			ok: true,
			diagnosticSummary: {
				buffer: { name: expect.stringContaining("bridge-diagnostics.lua") },
				counts: { error: 1, warning: 1, information: 0, hint: 1, total: 3 },
				diagnostics: [
					{ line: 0, column: 10, severity: 1, message: "unknown variable" },
					{ line: 0, column: 14, severity: 2, message: "warning" },
				],
			},
		})
	})
})

test("rejects diagnostics from an unavailable buffer", async () => {
	await withNvim([], async function(bridge) {
		expect(await bridge.diagnostics(999)).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" } })
		expect(await bridge.diagnosticSummary({ buffer: 999, maxItems: 1 })).toMatchObject({ error: { code: "NVIM_INVALID_RESPONSE" } })
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

test("advertises connected-server instructions, presentation tools, focused context, selections, and LSP hover", async () => {
	const response = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, new NvimContextBridge(undefined))
	expect(response).toMatchObject({ result: { instructions: expect.stringContaining("Prefer focus_context") } })
	const tools = await handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, new NvimContextBridge(undefined))
	expect(tools).toMatchObject({ result: { tools: expect.arrayContaining([expect.objectContaining({ name: "focus_context" }), expect.objectContaining({ name: "selection" }), expect.objectContaining({ name: "diagnostic_summary" }), expect.objectContaining({ name: "reveal" }), expect.objectContaining({ name: "highlight" })]) } })
	const summary = await handleMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "diagnostic_summary", arguments: { maxItems: 51 } } }, new NvimContextBridge(undefined))
	expect(summary).toMatchObject({ result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("Request at most 50 diagnostic summary items") })] } })
	const reveal = await handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "reveal", arguments: { buffer: 1, line: 1 } } }, new NvimContextBridge(undefined))
	expect(reveal).toMatchObject({ result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("Specify buffer, line, and column") })] } })
	const highlight = await handleMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "highlight", arguments: { buffer: 1, startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, durationMs: 30001 } } }, new NvimContextBridge(undefined))
	expect(highlight).toMatchObject({ result: { isError: true, content: [expect.objectContaining({ text: expect.stringContaining("must not exceed 30000 ms") })] } })
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
		expect(response.result.tools.map(function(tool) { return tool.name })).toEqual(["context", "visible_windows", "list_buffers", "read_buffer", "diagnostic_summary", "diagnostics", "focus_context", "selection", "quickfix", "reveal", "highlight", "clear_highlight", "annotate"])
	}
})
