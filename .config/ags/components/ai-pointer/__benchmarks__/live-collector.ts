import {
	chmodSync,
	closeSync,
	constants,
	lstatSync,
	openSync,
	readFileSync,
	rmSync,
	type FSWatcher,
	watch,
	writeFileSync,
} from "node:fs";
import { aiPointerPerformanceMetrics } from "../performance-metrics";
import {
	normalizeLivePerformanceRecord,
	recordsForSuccessfulWorkflows,
	type LivePerformanceRecord,
} from "./live-policy";
import { benchmarkEnvironmentInteger } from "./stats";

const expectedRuns = benchmarkEnvironmentInteger(
	"AI_POINTER_LIVE_RUNS",
	process.env.AI_POINTER_LIVE_RUNS,
	8,
	1,
	100,
);
const timeoutSeconds = benchmarkEnvironmentInteger(
	"AI_POINTER_LIVE_TIMEOUT_SECONDS",
	process.env.AI_POINTER_LIVE_TIMEOUT_SECONDS,
	180,
	10,
	3_600,
);
const maximumLogBytes = 4 * 1_024 * 1_024;
const maximumRecords = expectedRuns * 32 + 64;
const runtimeDirectory = validatedRuntimeDirectory();
const benchmarkFlag = `${runtimeDirectory}/ags-benchmark-mode`;
const performanceLog = `${runtimeDirectory}/ags-performance.jsonl`;
const filteredLog = `${runtimeDirectory}/ags-ai-pointer-live-performance.jsonl`;
const summary = `${runtimeDirectory}/ags-ai-pointer-live-summary.json`;

acquireBenchmarkLock();
let ownsBenchmarkLock = true;
let watcher: FSWatcher | null = null;
let rejectCompletion: ((error: Error) => void) | null = null;
let timeout: ReturnType<typeof setTimeout> | null = null;
const releaseCollection = () => {
	watcher?.close();
	watcher = null;
	if (ownsBenchmarkLock) rmSync(benchmarkFlag, { force: true });
	ownsBenchmarkLock = false;
	rmSync(performanceLog, { force: true });
};
try {
	writePrivateFile(performanceLog, "");
	const records: LivePerformanceRecord[] = [];
	let completedRuns = 0;
	let consumedCharacters = 0;
	let partialLine = "";
	let settled = false;

	console.log(
		`Complete ${expectedRuns} AI Pointer interactions within ${timeoutSeconds} seconds. ` +
		"Mix accessible and fallback clicks and drags; close each preview before starting the next.",
	);

	let resolveCompletion: () => void;
	const completion = new Promise<void>((resolve, reject) => {
		resolveCompletion = resolve;
		rejectCompletion = reject;
	});
	const consumeNewRecords = () => {
		const content = readFileSync(performanceLog, "utf8");
		if (Buffer.byteLength(content) > maximumLogBytes)
			throw new Error(`Performance log exceeded ${maximumLogBytes} bytes`);
		if (content.length < consumedCharacters)
			throw new Error("Performance log was truncated or replaced");
		const appended = partialLine + content.slice(consumedCharacters);
		consumedCharacters = content.length;
		const lines = appended.split("\n");
		partialLine = lines.pop() ?? "";
		for (const line of lines) {
			if (line.length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				throw new Error("Performance log contained malformed JSON");
			}
			const record = normalizeLivePerformanceRecord(parsed);
			if (!record) continue;
			records.push(record);
			if (records.length > maximumRecords)
				throw new Error(`Performance records exceeded ${maximumRecords}`);
			if (record.name !== aiPointerPerformanceMetrics.workflowCompletion || record.ok === false)
				continue;
			if (completedRuns >= expectedRuns) continue;
			completedRuns += 1;
			console.log(`Recorded ${completedRuns}/${expectedRuns} completed runs.`);
		}
		if (completedRuns < expectedRuns || settled) return;
		settled = true;
		resolveCompletion();
	};

	watcher = watch(performanceLog, () => {
		try {
			consumeNewRecords();
		} catch (error) {
			rejectCompletion?.(error instanceof Error ? error : new Error("Performance log read failed"));
		}
	});
	watcher.on("error", (error) => rejectCompletion?.(error));
	consumeNewRecords();
	timeout = setTimeout(() => {
		try {
			consumeNewRecords();
		} catch (error) {
			rejectCompletion?.(error instanceof Error ? error : new Error("Performance log read failed"));
			return;
		}
		if (completedRuns < expectedRuns)
			rejectCompletion?.(new Error(`Timed out after ${completedRuns}/${expectedRuns} completed runs`));
	}, timeoutSeconds * 1_000);
	const signals = ["SIGHUP", "SIGINT", "SIGQUIT", "SIGTERM"] as const;
	const collectionSignalHandlers = signals.map((signal) => {
		const handler = () => rejectCompletion?.(new Error(`Interrupted by ${signal}`));
		process.once(signal, handler);
		return { handler, signal };
	});

	await completion;
	clearTimeout(timeout);
	timeout = null;
	consumeNewRecords();
	const successfulRecords = recordsForSuccessfulWorkflows(records, expectedRuns);
	writePrivateFile(
		filteredLog,
		successfulRecords.map((record) => JSON.stringify(record)).join("\n") + "\n",
	);
	for (const { handler, signal } of collectionSignalHandlers)
		process.removeListener(signal, handler);
	releaseCollection();
	rmSync(summary, { force: true });
	const analyzer = Bun.spawn({
		cmd: [
			"python3",
			"scripts/benchmark/analyze-results.py",
			"--input",
			filteredLog,
			"--output",
			summary,
			"--print-top",
			"10",
		],
		stderr: "inherit",
		stdout: "inherit",
	});
	let analyzerTimedOut = false;
	const analyzerTimeout = setTimeout(() => {
		analyzerTimedOut = true;
		analyzer.kill();
	}, 30_000);
	const analyzerSignalHandlers = signals.map((signal) => {
		const handler = () => analyzer.kill();
		process.once(signal, handler);
		return { handler, signal };
	});
	const analyzerStatus = await analyzer.exited;
	clearTimeout(analyzerTimeout);
	for (const { handler, signal } of analyzerSignalHandlers)
		process.removeListener(signal, handler);
	if (analyzerTimedOut) throw new Error("Benchmark analyzer timed out after 30 seconds");
	if (analyzerStatus !== 0) throw new Error(`Benchmark analyzer exited with ${analyzerStatus}`);
	chmodSync(summary, 0o600);
	console.log(`AI Pointer live summary: ${summary}`);
} finally {
	if (timeout) clearTimeout(timeout);
	rejectCompletion = null;
	releaseCollection();
}

function validatedRuntimeDirectory(): string {
	const path = process.env.XDG_RUNTIME_DIR;
	if (!path) throw new Error("XDG_RUNTIME_DIR is required for live benchmarking");
	const stat = lstatSync(path);
	if (
		stat.isDirectory() === false ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid() ||
		(stat.mode & 0o077) !== 0
	)
		throw new Error("XDG_RUNTIME_DIR must be a private owner-controlled directory");
	return path;
}

function acquireBenchmarkLock(): void {
	let descriptor: number;
	try {
		descriptor = openSync(
			benchmarkFlag,
			constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
			0o600,
		);
	} catch {
		throw new Error("Another AGS benchmark is active or left a stale benchmark lock");
	}
	closeSync(descriptor);
}

function writePrivateFile(path: string, content: string): void {
	rmSync(path, { force: true });
	const descriptor = openSync(
		path,
		constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY,
		0o600,
	);
	try {
		writeFileSync(descriptor, content);
	} finally {
		closeSync(descriptor);
	}
}
