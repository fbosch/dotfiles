import { expect, test } from "bun:test"
import { NvimContextBridge, handleMessage } from "./neovim-context"

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

async function startNvim() {
	const socket = `/tmp/neovim-context-${process.pid}-${crypto.randomUUID()}.sock`
	const nvimProcess = Bun.spawn(["nvim", "--headless", "--listen", socket], {
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

test("exposes only the active-context tool", async () => {
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
			],
		},
	})
})
