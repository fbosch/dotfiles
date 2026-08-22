import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import {
	queryAccessibilityHelper,
	type AccessibilityHelperClient,
} from "@/components/ai-pointer/accessibility";
import { preflightAnswer, requestAnswer } from "@/components/ai-pointer/answer-client";
import { captureRegion } from "@/components/ai-pointer/capture";
import { recognizeCapture } from "@/components/ai-pointer/ocr";
import { settleProcessesForShutdown } from "@/components/ai-pointer/shutdown-processes";
import { createPointerStroke } from "@/components/ai-pointer/stroke";
import { assert, test } from "./harness";

type ProcessObservation = Gio.Subprocess | null;

test("AI Pointer shutdown settles unique completed processes", async () => {
	await withFixture(async ({ executable }) => {
		const first = spawn(executable("first", "exit 0"));
		const second = spawn(executable("second", "exit 0"));
		const startedAt = monotonicMs();

		settleProcessesForShutdown([first, first, second], 1_000);

		assert(monotonicMs() - startedAt < 500, "duplicate shutdown ownership waited for the grace timeout");
		assertSuccessful(first, "first shutdown process did not complete");
		assertSuccessful(second, "second shutdown process did not complete");
	});
});

test("AI Pointer shutdown force-exits every remaining process", async () => {
	await withFixture(async ({ executable }) => {
		const first = spawn(executable("first", "trap '' INT TERM\nexec sleep 30"));
		const second = spawn(executable("second", "trap '' INT TERM\nexec sleep 30"));
		const startedAt = monotonicMs();

		settleProcessesForShutdown([first, first, second], 20);

		assert(monotonicMs() - startedAt < 1_000, "forced shutdown exceeded its bounded grace period");
		assertTerminated(first, "first shutdown process remained alive");
		assertTerminated(second, "second shutdown process remained alive");
	});
});

test("AI Pointer answer and preflight cancellation settle owned processes", async () => {
	await withFixture(async ({ executable }) => {
		const helper = executable("answer-helper", "trap '' INT TERM\nexec sleep 30");
		const answerCancellable = new Gio.Cancellable();
		const answerObservations: ProcessObservation[] = [];
		const answer = await requestAnswer(
			{
				requestId: "cancel-answer",
				prompt: "Question",
				attachment: { path: "/unread", sha256: "a".repeat(64) },
				timeoutSeconds: 5,
			},
			answerCancellable,
			cancellingObserver(answerCancellable, answerObservations),
			undefined,
			{ executable: helper, hardTimeoutMs: 1_000, cancellationGraceMs: 20 },
		);
		assert(answer.kind === "cancelled", "answer cancellation did not reach the caller");
		assertObserverSettled(answerObservations, "answer");

		const preflightCancellable = new Gio.Cancellable();
		const preflightObservations: ProcessObservation[] = [];
		const preflight = await preflightAnswer(
			preflightCancellable,
			cancellingObserver(preflightCancellable, preflightObservations),
			{ executable: helper, hardTimeoutMs: 1_000, cancellationGraceMs: 20 },
		);
		assert(
			preflight.kind === "failed" && preflight.code === "cancelled",
			"preflight cancellation did not reach the caller",
		);
		assertObserverSettled(preflightObservations, "preflight");
	});
});

test("AI Pointer capture cancellation force-exits and removes partial output", async () => {
	await withFixture(async ({ directory, executable }) => {
		const grim = executable(
			"grim",
			"printf partial > \"$3\"\ntrap '' INT TERM\nexec sleep 30",
		);
		await withRuntimeDirectory(directory, async (captureDirectory) => {
			const cancellable = new Gio.Cancellable();
			const observations: ProcessObservation[] = [];
			let capturePath: string | null = null;
			const result = await captureRegion(
				captureDirectory,
				{ x: 0, y: 0, width: 2, height: 2 },
				cancellable,
				cancellingObserver(cancellable, observations),
				(path) => {
					if (path) capturePath = path;
				},
				grim,
				{ cancellationGraceMs: 20, timeoutMs: 1_000 },
			);

			assert(result.kind === "cancelled", "capture cancellation did not reach the caller");
			assert(capturePath !== null, "capture path was not reported");
			assert(Gio.File.new_for_path(capturePath).query_exists(null) === false, "partial capture survived cancellation");
			assertObserverSettled(observations, "capture cancellation");
		});
	});
});

test("AI Pointer capture timeout force-exits and clears ownership", async () => {
	await withFixture(async ({ directory, executable }) => {
		const grim = executable(
			"grim",
			"printf partial > \"$3\"\ntrap '' INT TERM\nexec sleep 30",
		);
		await withRuntimeDirectory(directory, async (captureDirectory) => {
			const observations: ProcessObservation[] = [];
			let capturePath: string | null = null;
			const result = await captureRegion(
				captureDirectory,
				{ x: 0, y: 0, width: 2, height: 2 },
				new Gio.Cancellable(),
				(process) => observations.push(process),
				(path) => {
					if (path) capturePath = path;
				},
				grim,
				{ cancellationGraceMs: 20, timeoutMs: 20 },
			);

			assert(
				result.kind === "failed" && result.message.includes("timed out"),
				"capture timeout did not reach the caller",
			);
			assert(capturePath !== null, "timed-out capture path was not reported");
			assert(Gio.File.new_for_path(capturePath).query_exists(null) === false, "partial capture survived timeout");
			assertObserverSettled(observations, "capture timeout");
		});
	});
});

test("AI Pointer OCR cancellation and timeout settle owned processes", async () => {
	await withFixture(async ({ executable }) => {
		const helper = executable("ocr-helper", "trap '' INT TERM\nexec sleep 30");
		const input = { path: "/unread", pixelHeight: 1, pixelWidth: 1 };
		const cancellable = new Gio.Cancellable();
		const cancellationObservations: ProcessObservation[] = [];
		const cancelled = await recognizeCapture(
			input,
			cancellable,
			cancellingObserver(cancellable, cancellationObservations),
			{ executable: helper, timeoutMs: 1_000 },
		);
		assert(cancelled.kind === "cancelled", "OCR cancellation did not reach the caller");
		assertObserverSettled(cancellationObservations, "OCR cancellation");

		const timeoutObservations: ProcessObservation[] = [];
		const timedOut = await recognizeCapture(
			input,
			new Gio.Cancellable(),
			(process) => timeoutObservations.push(process),
			{ executable: helper, timeoutMs: 20 },
		);
		assert(
			timedOut.kind === "unavailable" && timedOut.reason === "timeout",
			"OCR timeout did not reach the caller",
		);
		assertObserverSettled(timeoutObservations, "OCR timeout");
	});
});

test("AI Pointer accessibility helper clears ownership on success", async () => {
	await withFixture(async ({ executable }) => {
		const output = JSON.stringify({
			protocolVersion: 6,
			coordinateSpace: "window",
			candidates: [],
			complete: true,
			timings: helperTimings(),
		});
		const helper = executable("accessibility-helper", `printf '%s' '${output}'`);
		const observations: ProcessObservation[] = [];
		const result = await queryAccessibilityHelper(
			accessibilityClient,
			selection,
			createPointerStroke({ x: 10, y: 10 }),
			new Gio.Cancellable(),
			(process) => observations.push(process),
			{ executable: helper, timeoutMs: 1_000 },
		);

		assert(result.kind === "candidates" && result.candidates.length === 0, "valid helper output was rejected");
		assertObserverSettled(observations, "accessibility success");
	});
});

test("AI Pointer accessibility cancellation and timeout settle owned processes", async () => {
	await withFixture(async ({ executable }) => {
		const helper = executable("accessibility-helper", "trap '' INT TERM\nexec sleep 30");
		const stroke = createPointerStroke({ x: 10, y: 10 });
		const cancellable = new Gio.Cancellable();
		const cancellationObservations: ProcessObservation[] = [];
		await queryAccessibilityHelper(
			accessibilityClient,
			selection,
			stroke,
			cancellable,
			cancellingObserver(cancellable, cancellationObservations),
			{ executable: helper, timeoutMs: 1_000 },
		);
		assert(cancellable.is_cancelled(), "accessibility cancellation did not propagate");
		assertObserverSettled(cancellationObservations, "accessibility cancellation");

		const timeoutObservations: ProcessObservation[] = [];
		const timedOut = await queryAccessibilityHelper(
			accessibilityClient,
			selection,
			stroke,
			new Gio.Cancellable(),
			(process) => timeoutObservations.push(process),
			{ executable: helper, timeoutMs: 20 },
		);
		assert(
			timedOut.kind === "unavailable" && timedOut.reason === "helper timed out",
			"accessibility timeout did not reach the caller",
		);
		assertObserverSettled(timeoutObservations, "accessibility timeout");
	});
});

const selection = { x: 0, y: 0, width: 100, height: 100 };
const accessibilityClient: AccessibilityHelperClient = {
	address: "0xtest",
	geometry: selection,
	pid: 123,
};

function helperTimings(): Record<string, { startMs: number; durationMs: number }> {
	return Object.fromEntries([
		"initialization",
		"applicationDiscovery",
		"windowMatching",
		"hitTesting",
		"ancestorTraversal",
		"candidateInspection",
		"serialization",
	].map((name, index) => [name, { startMs: index, durationMs: 1 }]));
}

function cancellingObserver(
	cancellable: Gio.Cancellable,
	observations: ProcessObservation[],
): (process: Gio.Subprocess | null) => void {
	return (process) => {
		observations.push(process);
		if (!process) return;
		GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			cancellable.cancel();
			return GLib.SOURCE_REMOVE;
		});
	};
}

function assertObserverSettled(observations: ProcessObservation[], label: string): void {
	assert(observations.length === 2, `${label} observer did not report one owned process lifecycle`);
	const process = observations[0];
	assert(process !== null, `${label} observer did not report process acquisition`);
	assert(observations[1] === null, `${label} observer did not clear process ownership`);
	process.wait(null);
	assert(
		process.get_if_exited() || process.get_if_signaled(),
		`${label} process remained unsettled after completion`,
	);
}

function assertSuccessful(process: Gio.Subprocess, message: string): void {
	process.wait(null);
	assert(process.get_if_exited() && process.get_successful(), message);
}

function assertTerminated(process: Gio.Subprocess, message: string): void {
	process.wait(null);
	assert(process.get_if_signaled(), message);
}

function spawn(executable: string): Gio.Subprocess {
	return Gio.Subprocess.new([executable], Gio.SubprocessFlags.NONE);
}

function monotonicMs(): number {
	return GLib.get_monotonic_time() / 1_000;
}

async function withRuntimeDirectory(
	directory: string,
	run: (captureDirectory: string) => Promise<void>,
): Promise<void> {
	const original = GLib.getenv("XDG_RUNTIME_DIR");
	const captureDirectory = GLib.build_filenamev([directory, "ai-pointer"]);
	GLib.mkdir_with_parents(captureDirectory, 0o700);
	GLib.setenv("XDG_RUNTIME_DIR", directory, true);
	try {
		await run(captureDirectory);
	} finally {
		if (original) GLib.setenv("XDG_RUNTIME_DIR", original, true);
		else GLib.unsetenv("XDG_RUNTIME_DIR");
	}
}

async function withFixture(
	run: (fixture: {
		directory: string;
		executable(name: string, body: string): string;
	}) => Promise<void> | void,
): Promise<void> {
	const directory = GLib.build_filenamev([
		GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp",
		`ai-pointer-process-test-${GLib.uuid_string_random()}`,
	]);
	GLib.mkdir_with_parents(directory, 0o700);
	try {
		await run({
			directory,
			executable(name, body) {
				const path = GLib.build_filenamev([directory, name]);
				Gio.File.new_for_path(path).replace_contents(
					new TextEncoder().encode(`#!/bin/sh\n${body}\n`),
					null,
					false,
					Gio.FileCreateFlags.PRIVATE,
					null,
				);
				GLib.chmod(path, 0o700);
				return path;
			},
		});
	} finally {
		removeTree(Gio.File.new_for_path(directory));
	}
}

function removeTree(file: Gio.File): void {
	let enumerator: Gio.FileEnumerator | null = null;
	try {
		enumerator = file.enumerate_children(
			"standard::name,standard::type",
			Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
			null,
		);
		while (true) {
			const info = enumerator.next_file(null);
			if (!info) break;
			removeTree(file.get_child(info.get_name()));
		}
	} catch {
		// A regular file has no children.
	} finally {
		enumerator?.close(null);
	}
	try {
		file.delete(null);
	} catch {
		// Failed tests should not hide their original assertion behind fixture cleanup.
	}
}
