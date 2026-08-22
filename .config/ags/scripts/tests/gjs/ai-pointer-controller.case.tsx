import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { requestAnswer } from "@/components/ai-pointer/answer-client";
import { AiPointerController } from "@/components/ai-pointer/controller";
import { AiPointerView, type AiPointerViewHandlers } from "@/components/ai-pointer/ai-pointer-view";
import { captureRegion } from "@/components/ai-pointer/capture";
import { emptySelectionContext } from "@/components/ai-pointer/context";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

test("AI Pointer keeps the selected-region preview active without a metadata window", async () => {
	let captured = 0;
	let programLookups = 0;
	let previewCalls = 0;
	const view = {
		create() {},
		beginStroke() {
			return true;
		},
		updateStroke() {},
		endStroke() {},
		finishStroke() {
			return Promise.resolve(true);
		},
		showCapture() {
			previewCalls += 1;
			return { pixelHeight: 20, pixelWidth: 20 };
		},
		setOcrState() {},
		clearOcr() {},
		hide() {},
		dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		readPointer: () => null,
		resolveAccessibility: async () => null,
		resolveContext: () => {
			throw new Error("fixture IPC failure");
		},
		resolvePrograms: () => {
			programLookups += 1;
			return [];
		},
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured += 1;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(captured === 1, "selection was not captured");
		assert(programLookups === 1, "local context was not resolved");
		assert(controller.selectionContext?.geometricInference.clients.length === 0, "context failure did not degrade safely");
		assert(previewCalls === 1, "selected-region preview was not shown");
		assert(controller.start({ x: 50, y: 60 }) === false, "selection preview did not remain active");
		controller.cancel();
		assert(controller.start({ x: 50, y: 60 }), "cancelling the preview did not return to idle");
	} finally {
		controller.teardown();
	}
});

test("AI Pointer submits the reviewed capture and presents a literal answer", async () => {
	let submit: ((question: string) => void) | null = null;
	let requesting = false;
	let answer = "";
	let requestPrompt = "";
	let requestDigest = "";
	const view = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showCapture() { return { pixelHeight: 20, pixelWidth: 20 }; },
		showRequesting() { requesting = true; },
		showAnswer(value: string) { answer = value; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view, prepareDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null,
		queryLocked: () => false, resolveAccessibility: async () => null,
		resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "b".repeat(64) },
		}),
		requestAnswer: async (input) => {
			requestPrompt = input.prompt;
			requestDigest = input.attachment.sha256;
			return { kind: "answered", answer: "<b>literal</b> https://example.com", truncated: false };
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		assert(submit !== null, "composition submit handler was unavailable");
		submit("What is shown?");
		await settleMainLoop();
		assert(requesting, "request state was not presented");
		assert(requestPrompt.includes("What is shown?"), "typed question was not submitted");
		assert(requestPrompt.includes("Desktop selection context"), "reviewed context was not submitted");
		assert(requestDigest === "b".repeat(64), "reviewed capture digest was not submitted");
		assert(answer === "<b>literal</b> https://example.com", "literal answer was not presented");
	} finally { controller.teardown(); }
});

test("AI Pointer rejects stale answer completion and submission after lock", async () => {
	let submit: ((question: string) => void) | null = null;
	let resolveAnswer: (() => void) | null = null;
	let answerPresentations = 0;
	let locked = false;
	let requestCount = 0;
	const view = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showCapture() { return { pixelHeight: 20, pixelWidth: 20 }; }, showRequesting() {},
		showAnswer() { answerPresentations += 1; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view, prepareDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null,
		queryLocked: () => locked, resolveAccessibility: async () => null,
		resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [],
		recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "c".repeat(64) },
		}),
		requestAnswer: () => {
			requestCount += 1;
			return new Promise((resolve) => {
				resolveAnswer = () => resolve({ kind: "answered", answer: "stale", truncated: false });
			});
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		assert(submit !== null, "composition submit handler was unavailable");
		submit("First question");
		await settleMainLoop();
		assert(resolveAnswer !== null, "answer request did not start");
		controller.cancel();
		resolveAnswer();
		await settleMainLoop();
		assert(answerPresentations === 0, "stale answer was presented");
		assert(controller.start({ x: 10, y: 20 }), "second start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "second finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		locked = true;
		submit("Locked question");
		await settleMainLoop();
		assert(requestCount === 1, "locked submission reached the answer helper");
		assert(answerPresentations === 0, "answer was presented while locked");
	} finally { controller.teardown(); }
});

test("AI Pointer cancellation rejects a pending accessibility result", async () => {
	let captured = false;
	let resolveLookup: (() => void) | null = null;
	const view = {
		create() {}, beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showCapture() { return { pixelHeight: 20, pixelWidth: 20 }; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view, prepareDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null,
		resolveAccessibility: () => new Promise((resolve) => {
			resolveLookup = () => resolve({
				geometry: { x: 100, y: 200, width: 120, height: 60 },
				metadata: { confidence: 0.9, role: "push button" },
			});
		}),
		resolvePrograms: () => [], recognizeOcr: async () => ({ kind: "no-text" }),
		capture: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		},
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }), "start request was rejected");
		assert(controller.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(resolveLookup !== null, "accessibility lookup did not start");
		controller.cancel();
		resolveLookup();
		await settleMainLoop();
		assert(captured === false, "cancelled accessibility geometry was captured");
	} finally { controller.teardown(); }
});

test("AI Pointer initialization removes only stale feature captures", () => {
	const originalRuntimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	const testRuntimeDirectory = GLib.build_filenamev([
		originalRuntimeDirectory ?? "/tmp",
		`ai-pointer-test-${GLib.uuid_string_random()}`,
	]);
	const captureDirectory = GLib.build_filenamev([testRuntimeDirectory, "ai-pointer"]);
	const staleCapture = GLib.build_filenamev([
		captureDirectory,
		"capture-00000000-0000-0000-0000-000000000000.png",
	]);
	const unrelated = GLib.build_filenamev([captureDirectory, "keep.txt"]);
	GLib.mkdir_with_parents(captureDirectory, 0o700);
	Gio.File.new_for_path(staleCapture).replace_contents(
		new TextEncoder().encode("partial"), null, false, Gio.FileCreateFlags.PRIVATE, null,
	);
	Gio.File.new_for_path(unrelated).replace_contents(
		new TextEncoder().encode("keep"), null, false, Gio.FileCreateFlags.PRIVATE, null,
	);
	GLib.setenv("XDG_RUNTIME_DIR", testRuntimeDirectory, true);
	const view = {
		create() {}, clearOcr() {}, hide() {}, endStroke() {}, dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({ view, queryLocked: () => false });
	try {
		controller.init();
		assert(Gio.File.new_for_path(staleCapture).query_exists(null) === false, "stale capture survived initialization");
		assert(Gio.File.new_for_path(unrelated).query_exists(null), "initialization deleted an unrelated runtime file");
	} finally {
		controller.teardown();
		Gio.File.new_for_path(unrelated).delete(null);
		Gio.File.new_for_path(captureDirectory).delete(null);
		Gio.File.new_for_path(testRuntimeDirectory).delete(null);
		if (originalRuntimeDirectory) GLib.setenv("XDG_RUNTIME_DIR", originalRuntimeDirectory, true);
		else GLib.unsetenv("XDG_RUNTIME_DIR");
	}
});

test("AI Pointer removes a partial grim capture", async () => {
	const originalRuntimeDirectory = GLib.getenv("XDG_RUNTIME_DIR");
	const testRuntimeDirectory = GLib.build_filenamev([
		originalRuntimeDirectory ?? "/tmp",
		`ai-pointer-test-${GLib.uuid_string_random()}`,
	]);
	const captureDirectory = GLib.build_filenamev([testRuntimeDirectory, "ai-pointer"]);
	const fakeGrim = GLib.build_filenamev([testRuntimeDirectory, "grim"]);
	GLib.mkdir_with_parents(captureDirectory, 0o700);
	Gio.File.new_for_path(fakeGrim).replace_contents(
		new TextEncoder().encode("#!/bin/sh\nprintf partial > \"$3\"\n"),
		null, false, Gio.FileCreateFlags.PRIVATE, null,
	);
	GLib.chmod(fakeGrim, 0o700);
	GLib.setenv("XDG_RUNTIME_DIR", testRuntimeDirectory, true);
	try {
		const result = await captureRegion(
			captureDirectory,
			{ x: 0, y: 0, width: 2, height: 2 },
			new Gio.Cancellable(),
			() => {},
			() => {},
			fakeGrim,
		);
		assert(result.kind === "failed", "partial grim output was accepted");
		const enumerator = Gio.File.new_for_path(captureDirectory).enumerate_children(
			"standard::name", Gio.FileQueryInfoFlags.NONE, null,
		);
		assert(enumerator.next_file(null) === null, "partial capture file survived failure");
		enumerator.close(null);
	} finally {
		Gio.File.new_for_path(fakeGrim).delete(null);
		Gio.File.new_for_path(captureDirectory).delete(null);
		Gio.File.new_for_path(testRuntimeDirectory).delete(null);
		if (originalRuntimeDirectory) GLib.setenv("XDG_RUNTIME_DIR", originalRuntimeDirectory, true);
		else GLib.unsetenv("XDG_RUNTIME_DIR");
	}
});

test("AI Pointer bounds a helper that ignores cooperative cancellation", async () => {
	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp";
	const helper = GLib.build_filenamev([
		runtimeDirectory,
		`ai-pointer-helper-test-${GLib.uuid_string_random()}`,
	]);
	Gio.File.new_for_path(helper).replace_contents(
		new TextEncoder().encode("#!/bin/sh\ntrap '' INT\nexec sleep 30\n"),
		null, false, Gio.FileCreateFlags.PRIVATE, null,
	);
	GLib.chmod(helper, 0o700);
	try {
		const result = await requestAnswer(
			{
				requestId: "timeout-test",
				prompt: "Question",
				attachment: { path: "/unread", sha256: "a".repeat(64) },
				timeoutSeconds: 5,
			},
			new Gio.Cancellable(),
			() => {},
			{ executable: helper, hardTimeoutMs: 10, cancellationGraceMs: 20 },
		);
		assert(result.kind === "failed" && result.code === "timeout", "helper timeout was not bounded");
	} finally {
		Gio.File.new_for_path(helper).delete(null);
	}
});

test("AI Pointer fails closed when lock state is unavailable", () => {
	const view = {
		create() {}, clearOcr() {}, hide() {}, endStroke() {}, dispose() {},
	} as unknown as AiPointerView;
	const controller = new AiPointerController({
		view,
		prepareDirectory: () => "/run/user/1000/ai-pointer",
		queryLocked: () => null,
	});
	controller.init();
	try {
		assert(controller.start({ x: 10, y: 20 }) === false, "unknown lock state started a capture");
	} finally {
		controller.teardown();
	}
});
