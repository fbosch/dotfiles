import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { perf } from "@/services/performance-monitor";
import { runtimeArtifactPath } from "@/services/runtime-artifacts";
import { ownProcess, type ProcessObserver } from "../owned-process";
import {
	accessibilityHelperTimingMetrics,
	aiPointerPerformanceMetrics,
} from "../performance-metrics";
import type { SelectionGeometry } from "../selection";
import { strokeBrushRadius, type PointerStroke } from "../stroke";
import { encodeAccessibilityHelperArgument } from "./helper-argument";
import type { AccessibilityHelperInput } from "./helper-input";
import {
	accessibilityCoordinateSpace,
	accessibilityProtocolVersion,
	parseAccessibilityHelperOutput,
	type AccessibilityHelperOutput,
	type AccessibleCandidate,
} from "./policy";

Gio._promisify(Gio.InputStream.prototype, "read_bytes_async", "read_bytes_finish");
Gio._promisify(Gio.Subprocess.prototype, "wait_async", "wait_finish");

const lookupTimeoutMs = 900;
const maximumHelperOutputBytes = 32_768;

export interface AccessibilityHelperClient {
	address: string;
	class?: string;
	geometry: SelectionGeometry;
	pid: number;
	stableId?: string;
	title?: string;
}

interface AccessibilityHelperOptions {
	executable?: string;
	timeoutMs?: number;
}

type HelperQueryResult =
	| { kind: "candidates"; candidates: AccessibleCandidate[]; partial: boolean }
	| { kind: "unavailable"; reason: string };

export async function queryAccessibilityHelper(
	client: AccessibilityHelperClient,
	selection: SelectionGeometry,
	stroke: PointerStroke,
	parentCancellable: Gio.Cancellable,
	onProcess: ProcessObserver,
	options: AccessibilityHelperOptions = {},
): Promise<HelperQueryResult> {
	const helperExecutable =
		options.executable ?? runtimeArtifactPath("aiPointerAccessibilityHelper");
	if (!helperExecutable)
		return { kind: "unavailable", reason: "helper executable unavailable" };
	const input: AccessibilityHelperInput = {
		coordinateSpace: accessibilityCoordinateSpace,
		pid: client.pid,
		protocolVersion: accessibilityProtocolVersion,
		selection: {
			x: selection.x - client.geometry.x,
			y: selection.y - client.geometry.y,
			width: selection.width,
			height: selection.height,
		},
		stroke: {
			points: stroke.points.map((point) => ({
				x: point.x - client.geometry.x,
				y: point.y - client.geometry.y,
			})),
			radius: strokeBrushRadius,
		},
		windowHeight: client.geometry.height,
		windowTitle: client.title,
		windowWidth: client.geometry.width,
	};

	let process: Gio.Subprocess;
	const spawnMark = perf.isEnabled()
		? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityHelperSpawn)
		: null;
	try {
		process = Gio.Subprocess.new(
			[helperExecutable, encodeAccessibilityHelperArgument(JSON.stringify(input))],
			Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
		);
		spawnMark?.end();
	} catch {
		spawnMark?.end(false, "failed");
		return { kind: "unavailable", reason: "helper failed to start" };
	}

	const cancellable = new Gio.Cancellable();
	const owned = ownProcess(process, {
		onCancel: () => cancellable.cancel(),
		onProcess,
		onTimeout: () => cancellable.cancel(),
		parentCancellable,
		timeoutMs: options.timeoutMs ?? lookupTimeoutMs,
	});

	const responseMark = perf.isEnabled()
		? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityHelperResponse)
		: null;
	let responseSucceeded = false;
	let helperTimings: AccessibilityHelperOutput["timings"] | null = null;
	try {
		const stdout = await readHelperOutput(process, cancellable, {
			terminate: async () => {
				owned.terminate();
				await owned.wait();
			},
			wait: owned.wait,
		});
		if (!stdout || process.get_successful() === false)
			return { kind: "unavailable", reason: owned.timedOut ? "helper timed out" : "helper failed" };
		const helperOutput = parseAccessibilityHelperOutput(stdout);
		if (!helperOutput) return { kind: "unavailable", reason: "invalid helper output" };
		if (helperOutput.complete === false && helperOutput.candidates.length === 0)
			return { kind: "unavailable", reason: "helper incomplete" };
		const translated = helperOutput.candidates.map((candidate) => ({
			...candidate,
			geometry: {
				x: candidate.geometry.x + client.geometry.x,
				y: candidate.geometry.y + client.geometry.y,
				width: candidate.geometry.width,
				height: candidate.geometry.height,
			},
		}));
		helperTimings = helperOutput.timings;
		responseSucceeded = true;
		return {
			kind: "candidates",
			candidates: translated,
			partial: helperOutput.complete === false,
		};
	} catch {
		return {
			kind: "unavailable",
			reason: owned.timedOut ? "helper timed out" : "helper failed",
		};
	} finally {
		responseMark?.end(responseSucceeded, responseSucceeded ? undefined : "failed");
		if (responseSucceeded && helperTimings)
			perf.record(
				"ai-pointer",
				Object.entries(helperTimings).map(([name, timing]) => ({
					durationMs: timing.durationMs,
					name: accessibilityHelperTimingMetrics[
						name as keyof typeof accessibilityHelperTimingMetrics
					],
					startMs: timing.startMs,
				})),
			);
		await owned.dispose();
	}
}

export async function readBoundedHelperOutput(
	process: Gio.Subprocess,
	cancellable: Gio.Cancellable,
): Promise<string | null> {
	return readHelperOutput(process, cancellable, {
		terminate: async () => {
			process.force_exit();
			await process.wait_async(null).catch(() => {});
		},
		wait: () => process.wait_async(cancellable).then(() => true),
	});
}

interface ProcessSettlement {
	terminate(): Promise<void>;
	wait(): Promise<boolean>;
}

async function readHelperOutput(
	process: Gio.Subprocess,
	cancellable: Gio.Cancellable,
	settlement: ProcessSettlement,
): Promise<string | null> {
	const stream = process.get_stdout_pipe();
	if (!stream) return null;
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	while (true) {
		const bytes = await stream.read_bytes_async(4_096, GLib.PRIORITY_DEFAULT, cancellable);
		const data = bytes.get_data();
		if (!data || data.length === 0) break;
		byteCount += data.length;
		if (byteCount > maximumHelperOutputBytes) {
			await settlement.terminate();
			return null;
		}
		chunks.push(data.slice());
	}
	if (await settlement.wait() === false) return null;
	const output = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(output);
	} catch {
		return null;
	}
}
