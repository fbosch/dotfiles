import { test } from "bun:test"
import { access, mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BaseApi } from "neovim/lib/api/Base"
import { NvimContextBridge, type TimeoutObserver } from "./neovim-bridge"

type Fixture = { bridge: NvimContextBridge; metrics: BenchmarkMetrics; process_: Bun.Subprocess; root: string }

const BUFFER_COUNTS = [1, 10, 50]
const WINDOW_COUNTS = [1, 5, 20]
const DIAGNOSTIC_COUNTS = [1, 50, 250]
const fixtures: Fixture[] = []

type BenchResult = { name: string; iterations: number; totalMs: number; meanUs: number; opsPerSecond: number }

const ITERATIONS = 100
const WARMUP_ITERATIONS = 10

class BenchmarkMetrics implements TimeoutObserver {
	requests = 0
	responseBytes = 0
	timeoutsCreated = 0
	timeoutsCleared = 0
	timeoutsFired = 0

	reset() {
		this.requests = 0
		this.responseBytes = 0
		this.timeoutsCreated = 0
		this.timeoutsCleared = 0
		this.timeoutsFired = 0
	}

	request() {
		this.requests += 1
	}

	response(value: unknown) {
		try {
			this.responseBytes += new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength
		} catch {}
	}

	created() {
		this.timeoutsCreated += 1
	}

	cleared() {
		this.timeoutsCleared += 1
	}

	fired() {
		this.timeoutsFired += 1
	}
}

let activeMetrics: BenchmarkMetrics | undefined

function instrumentRequests() {
	const request = BaseApi.prototype.request
	BaseApi.prototype.request = function(name, args = []) {
		const metrics = activeMetrics
		metrics?.request()
		return request.call(this, name, args).then(function(value) {
			metrics?.response(value)
			return value
		})
	}
	return function() { BaseApi.prototype.request = request }
}

function nowNs() { return process.hrtime.bigint() }

async function bench(name: string, metrics: BenchmarkMetrics, run: () => Promise<void>): Promise<BenchResult> {
	for (let index = 0; index < WARMUP_ITERATIONS; index += 1) await run()
	metrics.reset()
	activeMetrics = metrics
	const start = nowNs()
	for (let index = 0; index < ITERATIONS; index += 1) await run()
	activeMetrics = undefined
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

function printResult(result: BenchResult, metrics: BenchmarkMetrics) {
	const requests = (metrics.requests / result.iterations).toFixed(1)
	const responseBytes = Math.round(metrics.responseBytes / result.iterations).toLocaleString()
	const timeouts = `${metrics.timeoutsCreated}/${metrics.timeoutsCleared}/${metrics.timeoutsFired}`
	process.stdout.write(`${result.name.padEnd(30)} ${result.meanUs.toFixed(3).padStart(9)} us/op  ${requests.padStart(5)} rpc/op  ${responseBytes.padStart(7)} decoded B/op  ${timeouts} timers\n`)
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
	const metrics = new BenchmarkMetrics()
	const bridge = new NvimContextBridge(socket, undefined, metrics)
	fixtures.push({ bridge, metrics, process_, root })
	return { bridge, metrics, process_, root }
}

test("Neovim MCP baseline", async () => {
	console.log(`Neovim MCP baseline: ${WARMUP_ITERATIONS} warmups, ${ITERATIONS} iterations`)
	const keepAlive = setInterval(function() {}, 1_000)
	const restoreRequests = instrumentRequests()
	try {
		const contextFixture = await createFixture("neovim-context-main-", ["edit context.lua", "call setline(1, ['local context = true'])"])
		const selectionFixture = await createFixture("neovim-context-selection-", ["edit selection.lua", "call setline(1, ['first', 'second'])", "call cursor(1, 1)", "normal! vj"])

	const readSmallFixture = await createFixture("neovim-context-read-small-", ["edit read-small.lua", "call setline(1, ['local read = true', 'return read'])"])

	const readLargeFixture = await createFixture("neovim-context-read-large-", [`file read-large.lua`, `call setline(1, ['${"x".repeat(32769)}'])`])

	const focusFixture = await createFixture("neovim-context-focus-", ["edit focus.lua", "call setline(1, ['local focus = true'])", "let g:opencode_last_source_context = {'buffer': 1, 'cursor': {'line': 1, 'column': 1}}"])

	const bufferFixtures = await Promise.all(BUFFER_COUNTS.map((count) => createFixture(`neovim-context-buffers-${count}-`, bufferCommands(count))))

	const windowFixtures = await Promise.all(WINDOW_COUNTS.map((count) => createFixture(`neovim-context-windows-${count}-`, windowCommands(count))))

	const diagnosticFixtures = await Promise.all(DIAGNOSTIC_COUNTS.map((count) => createFixture(`neovim-context-diagnostics-${count}-`, diagnosticCommands(count))))

	for (const [index, fixture] of bufferFixtures.entries()) {
		const name = `bufferInventory/${BUFFER_COUNTS[index]}-buffers`
		printResult(await bench(name, fixture.metrics, () => successful(name, () => fixture.bridge.bufferInventory())), fixture.metrics)
	}
	for (const [index, fixture] of windowFixtures.entries()) {
		const name = `visibleWindows/${WINDOW_COUNTS[index]}-windows`
		printResult(await bench(name, fixture.metrics, () => successful(name, () => fixture.bridge.visibleWindows())), fixture.metrics)
	}
	printResult(await bench("context/active", contextFixture.metrics, () => successful("context/active", () => contextFixture.bridge.context())), contextFixture.metrics)
	printResult(await bench("selection/active", selectionFixture.metrics, () => successful("selection/active", () => selectionFixture.bridge.selection())), selectionFixture.metrics)
	printResult(await bench("lspHover/no-client", contextFixture.metrics, () => rejected(() => contextFixture.bridge.lspHover({}))), contextFixture.metrics)
	printResult(await bench("documentSymbols/no-client", contextFixture.metrics, () => rejected(() => contextFixture.bridge.documentSymbols({ maxItems: 20 }))), contextFixture.metrics)
	printResult(await bench("lspStatus/no-client", contextFixture.metrics, () => successful("lspStatus/no-client", () => contextFixture.bridge.lspStatus({ maxItems: 20 }))), contextFixture.metrics)
	printResult(await bench("quickfix/empty", contextFixture.metrics, () => successful("quickfix/empty", () => contextFixture.bridge.quickfix({ kind: "quickfix", maxItems: 20 }))), contextFixture.metrics)
	printResult(await bench("readBuffer/normal", readSmallFixture.metrics, () => successful("readBuffer/normal", () => readSmallFixture.bridge.readBuffer({}))), readSmallFixture.metrics)
	printResult(await bench("readBuffer/oversized-reject", readLargeFixture.metrics, () => rejected(() => readLargeFixture.bridge.readBuffer({}))), readLargeFixture.metrics)
	for (const [index, fixture] of diagnosticFixtures.entries()) {
		const name = `diagnostics/${DIAGNOSTIC_COUNTS[index]}-items`
		printResult(await bench(name, fixture.metrics, () => successful(name, () => fixture.bridge.diagnostics(1))), fixture.metrics)
	}
	const diagnosticSummaryFixture = diagnosticFixtures.at(-1)!
	printResult(await bench("diagnosticSummary/250-items", diagnosticSummaryFixture.metrics, () => successful("diagnosticSummary/250-items", () => diagnosticSummaryFixture.bridge.diagnosticSummary({ maxItems: 20 }))), diagnosticSummaryFixture.metrics)
	printResult(await bench("focusContext/recorded", focusFixture.metrics, () => successful("focusContext/recorded", () => focusFixture.bridge.focusContext())), focusFixture.metrics)
	} finally {
		activeMetrics = undefined
		restoreRequests()
		clearInterval(keepAlive)
		for (const fixture of fixtures) {
			fixture.process_.kill()
			await fixture.process_.exited
			await rm(fixture.root, { recursive: true, force: true })
		}
	}
})
