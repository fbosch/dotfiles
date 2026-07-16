import { test } from "bun:test"
import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NvimContextBridge } from "./neovim-bridge"


type Fixture = { bridge: NvimContextBridge; process_: Bun.Subprocess; root: string }

const BUFFER_COUNTS = [1, 10, 50]
const WINDOW_COUNTS = [1, 5, 20]
const DIAGNOSTIC_COUNTS = [1, 50, 250]
const fixtures: Fixture[] = []

type BenchResult = { name: string; iterations: number; totalMs: number; meanUs: number; opsPerSecond: number }

const ITERATIONS = 100
const WARMUP_ITERATIONS = 10

function nowNs() { return process.hrtime.bigint() }

async function bench(name: string, run: () => Promise<void>): Promise<BenchResult> {
	for (let index = 0; index < WARMUP_ITERATIONS; index += 1) await run()
	const start = nowNs()
	for (let index = 0; index < ITERATIONS; index += 1) await run()
	const totalMs = Number(nowNs() - start) / 1_000_000
	return { name, iterations: ITERATIONS, totalMs, meanUs: (totalMs * 1_000) / ITERATIONS, opsPerSecond: ITERATIONS / (totalMs / 1_000) }
}

async function successful(name: string, run: () => Promise<{ ok: boolean }>) {
	const result = await run()
	if (result.ok === false) throw new Error(`Benchmark tool call failed: ${name}`)
}

async function rejected(run: () => Promise<{ ok: boolean }>) {
	const result = await run()
	if (result.ok) throw new Error("Oversized read unexpectedly succeeded")
}

function printResult(result: BenchResult) {
	process.stdout.write(`${result.name.padEnd(30)} ${result.meanUs.toFixed(3).padStart(9)} us/op  ${Math.round(result.opsPerSecond).toLocaleString().padStart(12)} ops/s  ${result.iterations.toLocaleString()} iters\n`)
}

function socketPath() {
	return `/tmp/neovim-context-bench-${process.pid}-${crypto.randomUUID()}.sock`
}

async function waitForSocket(socket: string, process_: Bun.Subprocess) {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		try { await access(socket); return } catch {}
		if (attempt === 499) {
			const stderr = process_.stderr ? await new Response(process_.stderr).text() : ""
			throw new Error(`Neovim socket did not become available: ${socket}\n${stderr}`)
		}
		await Bun.sleep(10)
	}
}

async function startNvim(commands: string[], cwd?: string) {
	const socket = socketPath()
	const process_ = Bun.spawn(["nvim", "-u", "NONE", "--headless", "--cmd", "set hidden noswapfile", ...commands.flatMap(function(command) { return ["--cmd", command] }), "--listen", socket], { cwd, stdout: "ignore", stderr: "pipe" })
	await waitForSocket(socket, process_)
	return { process_, socket }
}

async function makeWorkspace(prefix: string) {
	const root = await mkdtemp(join(tmpdir(), prefix))
	const dir = join(root, "project")
	await mkdir(dir)
	return { root, dir }
}

function bufferCommands(count: number) {
	return [[...Array.from({ length: count }, function(_, index) { return [`edit buffer-${index}.lua`, `call setline(1, ['local index = ${index}', 'return index'])`] }).flat(), "buffer 1"].join(" | ")]
}

function windowCommands(count: number) {
	return [["edit window-0.lua", "call setline(1, ['return 0'])", ...Array.from({ length: count - 1 }, function(_, index) { return ["vsplit", `edit window-${index + 1}.lua`, `call setline(1, ['return ${index + 1}'])`] }).flat(), "wincmd t"].join(" | ")]
}

function diagnosticCommands(count: number) {
	const entries = Array.from({ length: count }, (_, index) => `{ lnum = 0, col = ${index % 12}, severity = vim.diagnostic.severity.ERROR, message = 'diagnostic ${index}', source = 'bench' }`).join(", ")
	return ["edit diagnostics.lua", "call setline(1, ['local value = 0'])", `lua vim.diagnostic.set(vim.api.nvim_create_namespace('bench-diagnostics'), 0, {${entries}})`]
}

async function createFixture(prefix: string, commands: string[]): Promise<Fixture> {
	const { root, dir } = await makeWorkspace(prefix)
	const { process_, socket } = await startNvim(commands, dir)
	const bridge = new NvimContextBridge(socket)
	fixtures.push({ bridge, process_, root })
	return { bridge, process_, root }
}

test("Neovim MCP baseline", async () => {
	console.log(`Neovim MCP baseline: ${WARMUP_ITERATIONS} warmups, ${ITERATIONS} iterations`)
	const keepAlive = setInterval(function() {}, 1_000)
	try {
		const contextFixture = await createFixture("neovim-context-main-", ["edit context.lua", "call setline(1, ['local context = true'])"])

	const readSmallFixture = await createFixture("neovim-context-read-small-", ["edit read-small.lua", "call setline(1, ['local read = true', 'return read'])"])

	const readLargeFixture = await createFixture("neovim-context-read-large-", [`file read-large.lua`, `call setline(1, ['${"x".repeat(32769)}'])`])

	const focusFixture = await createFixture("neovim-context-focus-", ["edit focus.lua", "call setline(1, ['local focus = true'])", "let g:opencode_last_source_context = {'buffer': 1, 'cursor': {'line': 1, 'column': 1}}"])

	const bufferFixtures = await Promise.all(BUFFER_COUNTS.map((count) => createFixture(`neovim-context-buffers-${count}-`, bufferCommands(count))))

	const windowFixtures = await Promise.all(WINDOW_COUNTS.map((count) => createFixture(`neovim-context-windows-${count}-`, windowCommands(count))))

	const diagnosticFixtures = await Promise.all(DIAGNOSTIC_COUNTS.map((count) => createFixture(`neovim-context-diagnostics-${count}-`, diagnosticCommands(count))))

	for (const [index, fixture] of bufferFixtures.entries()) {
		const name = `bufferInventory/${BUFFER_COUNTS[index]}-buffers`
		printResult(await bench(name, () => successful(name, () => fixture.bridge.bufferInventory())))
	}
	for (const [index, fixture] of windowFixtures.entries()) {
		const name = `visibleWindows/${WINDOW_COUNTS[index]}-windows`
		printResult(await bench(name, () => successful(name, () => fixture.bridge.visibleWindows())))
	}
	printResult(await bench("context/active", () => successful("context/active", () => contextFixture.bridge.context())))
	printResult(await bench("readBuffer/normal", () => successful("readBuffer/normal", () => readSmallFixture.bridge.readBuffer({}))))
	printResult(await bench("readBuffer/oversized-reject", () => rejected(() => readLargeFixture.bridge.readBuffer({}))))
	for (const [index, fixture] of diagnosticFixtures.entries()) {
		const name = `diagnostics/${DIAGNOSTIC_COUNTS[index]}-items`
		printResult(await bench(name, () => successful(name, () => fixture.bridge.diagnostics(1))))
	}
	printResult(await bench("focusContext/recorded", () => successful("focusContext/recorded", () => focusFixture.bridge.focusContext())))
	} finally {
		clearInterval(keepAlive)
		for (const fixture of fixtures) {
			fixture.process_.kill()
			await fixture.process_.exited
			await rm(fixture.root, { recursive: true, force: true })
		}
	}
})
