import {
	chmodSync,
	existsSync,
	readFileSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { aiPointerPerformanceMetrics } from "../performance-metrics";
import { normalizeLivePerformanceRecord, type LivePerformanceRecord } from "./live-policy";
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
const runtimeDirectory = process.env.XDG_RUNTIME_DIR;
if (!runtimeDirectory) throw new Error("XDG_RUNTIME_DIR is required for live benchmarking");

const benchmarkFlag = `${runtimeDirectory}/ags-benchmark-mode`;
const performanceLog = `${runtimeDirectory}/ags-performance.jsonl`;
const filteredLog = `${runtimeDirectory}/ags-ai-pointer-live-performance.jsonl`;
const summary = `${runtimeDirectory}/ags-ai-pointer-live-summary.json`;
if (existsSync(benchmarkFlag)) throw new Error("Another AGS benchmark is already active");

writePrivateFile(performanceLog, "");
writePrivateFile(benchmarkFlag, "");
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
let rejectCompletion: (error: Error) => void;
const completion = new Promise<void>((resolve, reject) => {
	resolveCompletion = resolve;
	rejectCompletion = reject;
});
const timeout = setTimeout(
	() => rejectCompletion(new Error(`Timed out after ${completedRuns}/${expectedRuns} completed runs`)),
	timeoutSeconds * 1_000,
);

function consumeNewRecords(): void {
	const content = readFileSync(performanceLog, "utf8");
	if (content.length < consumedCharacters) {
		consumedCharacters = 0;
		partialLine = "";
	}
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
			continue;
		}
		const record = normalizeLivePerformanceRecord(parsed);
		if (!record) continue;
		records.push(record);
		if (record.name !== aiPointerPerformanceMetrics.workflowCompletion || record.ok === false)
			continue;
		completedRuns += 1;
		console.log(`Recorded ${completedRuns}/${expectedRuns} completed runs.`);
	}
	if (completedRuns < expectedRuns || settled) return;
	settled = true;
	clearTimeout(timeout);
	resolveCompletion();
}

const watcher = watch(performanceLog, () => consumeNewRecords());
consumeNewRecords();
const cleanup = () => {
	watcher.close();
	rmSync(benchmarkFlag, { force: true });
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		cleanup();
		process.exit(128 + (signal === "SIGINT" ? 2 : 15));
	});
}

try {
	await completion;
} finally {
	cleanup();
	writePrivateFile(filteredLog, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

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
const analyzerStatus = await analyzer.exited;
if (analyzerStatus !== 0) throw new Error(`Benchmark analyzer exited with ${analyzerStatus}`);
console.log(`AI Pointer live summary: ${summary}`);

function writePrivateFile(path: string, content: string): void {
	writeFileSync(path, content, { mode: 0o600 });
	chmodSync(path, 0o600);
}
