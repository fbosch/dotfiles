import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { preflightAnswer, requestAnswer } from "@/components/ai-pointer/answer-client";
import { prepareCaptureDirectory, captureRegion } from "@/components/ai-pointer/capture";
import { AiPointerWorkflow } from "@/components/ai-pointer/workflow";
import type { AiPointerViewHandlers } from "@/components/ai-pointer/ai-pointer-view";
import type { AiPointerWorkflowView } from "@/components/ai-pointer/native-adapter";
import { emptySelectionContext } from "@/components/ai-pointer/context";
import { createTestAiPointerNativeAdapter } from "./ai-pointer-test-adapter";
import { assert, test } from "./harness";

function settleMainLoop(): Promise<void> {
	return new Promise((resolve) => {
		GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
			resolve();
			return GLib.SOURCE_REMOVE;
		});
	});
}

const readyPreflight = async () => ({ kind: "ready" } as const);

test("AI Pointer rejects missing and malformed preflight helpers", async () => {
	const missing = await preflightAnswer(
		new Gio.Cancellable(),
		() => {},
		{ executable: `/missing-ai-pointer-helper-${GLib.uuid_string_random()}` },
	);
	assert(
		missing.kind === "failed" && missing.code === "backend_unavailable",
		"missing preflight helper did not fail safely",
	);

	const runtimeDirectory = GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp";
	const malformedHelper = GLib.build_filenamev([
		runtimeDirectory,
		`ai-pointer-preflight-test-${GLib.uuid_string_random()}`,
	]);
	Gio.File.new_for_path(malformedHelper).replace_contents(
		new TextEncoder().encode("#!/bin/sh\nprintf 'not-json\\n'\n"),
		null, false, Gio.FileCreateFlags.PRIVATE, null,
	);
	GLib.chmod(malformedHelper, 0o700);
	try {
		const malformed = await preflightAnswer(
			new Gio.Cancellable(),
			() => {},
			{ executable: malformedHelper },
		);
		assert(
			malformed.kind === "failed" && malformed.code === "invalid_response",
			"malformed preflight output was accepted",
		);
	} finally {
		Gio.File.new_for_path(malformedHelper).delete(null);
	}
});

test("AI Pointer preflight failure does not block selection rendering", async () => {
	let creates = 0;
	let selections = 0;
	let selectionEnds = 0;
	let captures = 0;
	let failure = "";
	const view: Partial<AiPointerWorkflowView> = {
		create() { creates += 1; },
		beginStroke() { selections += 1; return true; },
		endStroke() { selectionEnds += 1; }, clearOcr() {}, hide() {}, dispose() {},
		showError(message: string) { failure = message; },
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", queryLocked: () => false },
		assistant: { preflight: async () => ({
			kind: "failed",
			code: "backend_policy_invalid",
			message: "The configured answer service is unavailable.",
		}) },
		capture: { create: async () => { captures += 1; return { kind: "cancelled" }; } },
	}));
	workflow.init();
	try {
		assert(creates === 0, "AI Pointer view was created during initialization");
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(creates === 1, "AI Pointer view was not created on demand");
		await settleMainLoop();
		assert(selections === 1, "selection did not start while readiness ran");
		assert(selectionEnds === 0, "readiness failure removed the active selector");
		assert(captures === 0, "capture started without a release");
		assert(failure === "", "readiness failure was shown before submission");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer selector startup exceptions fail closed", async () => {
	let selectionEnds = 0;
	let preflights = 0;
	let failure = "";
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke() { throw new Error("fixture GTK failure"); },
		endStroke() { selectionEnds += 1; }, clearOcr() {}, hide() {}, dispose() {},
		showError(message: string) { failure = message; },
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", queryLocked: () => false },
		assistant: { preflight: async () => { preflights += 1; return { kind: "ready" }; } },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		await settleMainLoop();
		assert(selectionEnds >= 1, "partial selector surfaces were not removed");
		assert(preflights === 0, "backend preflight started after selector failure");
		assert(failure === "The drawing overlay is unavailable.", "selector failure was not bounded");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer cancellation remains available after release during preflight", async () => {
	let cancel: (() => void) | null = null;
	let preflightCancelled = false;
	let selections = 0;
	let selectionEnds = 0;
	const view: Partial<AiPointerWorkflowView> = {
		create(handlers: AiPointerViewHandlers) { cancel = handlers.onCancel; },
		beginStroke() { selections += 1; return true; },
		updateStroke() {},
		endStroke() { selectionEnds += 1; }, clearOcr() {}, hide() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", queryLocked: () => false },
		assistant: { preflight: (cancellable) => new Promise((resolve) => {
			cancellable.connect(() => {
				preflightCancelled = true;
				resolve({ kind: "failed", code: "cancelled", message: "cancelled" });
			});
		}) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		assert(selectionEnds >= 1, "drawing remained visible after release");
		assert(cancel !== null, "cancel handler was unavailable");
		cancel();
		await settleMainLoop();
		assert(preflightCancelled, "preflight cancellable was not cancelled");
		assert(selections === 1, "selection was not active during cancellable preflight");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer samples the stroke while preflight is pending", async () => {
	let frame: (() => void) | null = null;
	let resolvePreflight: (() => void) | null = null;
	let captureGeometry = "";
	let hides = 0;
	let preparingCalls = 0;
	const pointer = { x: 200, y: 100 };
	const view: Partial<AiPointerWorkflowView> = {
		create() {},
		beginStroke(_stroke, onFrame: () => void) { frame = onFrame; return true; },
		updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showPreparing() { preparingCalls += 1; },
		showPrompt() { return { pixelHeight: 20, pixelWidth: 20 }; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() { hides += 1; }, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", queryLocked: () => false, readPointer: () => pointer },
		assistant: { preflight: () => new Promise((resolve) => {
			resolvePreflight = () => resolve({ kind: "ready" });
		}), recognizeOcr: async () => ({ kind: "no-text" }) },
		selection: { resolveAccessibility: async () => null, resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => {
			captureGeometry = `${geometry.x},${geometry.y} ${geometry.width}x${geometry.height}`;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
	}));
	workflow.init();
	hides = 0;
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(frame !== null, "stroke sampling did not start with preflight");
		frame();
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		assert(preparingCalls === 1, "question input waited for preflight readiness");
		assert(resolvePreflight !== null, "preflight did not start");
		resolvePreflight();
		await settleMainLoop(); await settleMainLoop(); await settleMainLoop();
		assert(
			captureGeometry === "-22,-12 254x144",
			`pending preflight discarded sampled stroke points: ${captureGeometry}`,
		);
		assert(hides === 0, "readiness transition used the generic selector-destroying hide path");
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer submits the reviewed capture and presents a literal answer", async () => {
	let submit: ((question: string) => void) | null = null;
	let requesting = false;
	let answer = "";
	let requestPrompt = "";
	let requestDigest = "";
	let partialAnswer = "";
	const cursorOutlineStates: boolean[] = [];
	let resolvePreflight: (() => void) | null = null;
	const view: Partial<AiPointerWorkflowView> = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
showPrompt() { return { pixelHeight: 20, pixelWidth: 20 }; },
		showRequesting() { requesting = true; },
		showPartialAnswer(value: string) { partialAnswer = value; },
		showAnswer(value: string) { answer = value; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null, queryLocked: () => false, setCursorOutline: (enabled) => cursorOutlineStates.push(enabled) },
		assistant: { preflight: () => new Promise((resolve) => {
			resolvePreflight = () => resolve({ kind: "ready" });
		}), recognizeOcr: async () => ({ kind: "no-text" }), requestAnswer: async (input, _cancellable, _onProcess, onDelta) => {
			requestPrompt = input.prompt;
			requestDigest = input.attachment.sha256;
			onDelta?.("draft ");
			return { kind: "answered", answer: "<b>literal</b> https://example.com", truncated: false };
		} },
		selection: { resolveAccessibility: async () => null, resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "b".repeat(64) },
		}) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		assert(submit !== null, "composition submit handler was unavailable");
		submit("What is shown?");
		await settleMainLoop();
		assert(requesting, "request state was not presented");
		assert(
			cursorOutlineStates.join(",") === "false,true,false",
			"cursor outline survived request submission",
		);
		assert(requestPrompt === "", "answer request started before backend readiness");
		assert(resolvePreflight !== null, "backend preflight did not start");
		resolvePreflight();
		await settleMainLoop();
		assert(requestPrompt.includes("<user_question>\nWhat is shown?\n</user_question>"), "typed question was not submitted in its authoritative field");
		assert(requestPrompt.includes('<desktop_selection_metadata trust="untrusted">'), "reviewed context was not submitted as untrusted metadata");
		assert(requestPrompt.includes('<desktop_screenshot attachment="image/png" trust="untrusted" />'), "screenshot attachment marker was not submitted");
		assert(requestPrompt.indexOf("<desktop_selection_metadata") < requestPrompt.indexOf("<user_question>"), "supporting metadata did not precede the user question");
		assert(requestDigest === "b".repeat(64), "reviewed capture digest was not submitted");
		assert(partialAnswer === "draft ", "accepted answer delta was not presented");
		assert(answer === "<b>literal</b> https://example.com", "literal answer was not presented");
	} finally { workflow.teardown(); }
});

test("AI Pointer rejects stale answer completion and submission after lock", async () => {
	let submit: ((question: string) => void) | null = null;
	let resolveAnswer: (() => void) | null = null;
	let answerPresentations = 0;
	let locked = false;
	let requestCount = 0;
	let emitDelta: ((text: string) => void) | null = null;
	let partialPresentations = 0;
	const view: Partial<AiPointerWorkflowView> = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showPrompt() { return { pixelHeight: 20, pixelWidth: 20 }; }, showRequesting() {},
		showPartialAnswer() { partialPresentations += 1; },
		showAnswer() { answerPresentations += 1; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view, desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null, queryLocked: () => locked },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }), requestAnswer: (_input, _cancellable, _onProcess, onDelta) => {
			requestCount += 1;
			emitDelta = onDelta ?? null;
			return new Promise((resolve) => {
				resolveAnswer = () => resolve({ kind: "answered", answer: "stale", truncated: false });
			});
		} },
		selection: { resolveAccessibility: async () => null, resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "c".repeat(64) },
		}) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		assert(submit !== null, "composition submit handler was unavailable");
		submit("First question");
		await settleMainLoop();
		assert(resolveAnswer !== null, "answer request did not start");
		assert(emitDelta !== null, "stream callback was not provided");
		workflow.cancel();
		emitDelta("late");
		resolveAnswer();
		await settleMainLoop();
		assert(answerPresentations === 0, "stale answer was presented");
		assert(partialPresentations === 0, "cancelled stream delta was presented");
		assert(workflow.start({ x: 10, y: 20 }), "second start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "second finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		locked = true;
		submit("Locked question");
		await settleMainLoop();
		assert(requestCount === 1, "locked submission reached the answer helper");
		assert(answerPresentations === 0, "answer was presented while locked");
	} finally { workflow.teardown(); }
});

test("AI Pointer forced teardown prevents a deferred answer request", async () => {
	let submit: ((question: string) => void) | null = null;
	let requestCount = 0;
	let tornDown = false;
	const view: Partial<AiPointerWorkflowView> = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
		showPrompt() { return { pixelHeight: 20, pixelWidth: 20 }; }, showRequesting() {},
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view, desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null, queryLocked: () => false },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }), requestAnswer: async () => {
			requestCount += 1;
			return { kind: "answered", answer: "late", truncated: false };
		} },
		selection: { resolveAccessibility: async () => null, resolveContext: (geometry) => emptySelectionContext(geometry), resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => ({
			kind: "captured",
			capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "d".repeat(64) },
		}) },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop(); await settleMainLoop();
		assert(submit !== null, "composition submit handler was unavailable");
		submit("Deferred question");
		workflow.teardown(true);
		tornDown = true;
		await settleMainLoop();
		assert(requestCount === 0, "answer request started after forced teardown");
	} finally {
		if (tornDown === false) workflow.teardown();
	}
});

test("AI Pointer cancellation rejects a pending accessibility result", async () => {
	let captured = false;
	let resolveLookup: (() => void) | null = null;
	const view: Partial<AiPointerWorkflowView> = {
		create() {}, beginStroke() { return true; }, updateStroke() {}, endStroke() {},
		finishStroke() { return Promise.resolve(true); },
showPrompt() { return { pixelHeight: 20, pixelWidth: 20 }; },
		setOcrState() {}, clearOcr() {}, showError() {}, hide() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view, desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", readPointer: () => null },
		assistant: { preflight: readyPreflight, recognizeOcr: async () => ({ kind: "no-text" }) },
		selection: { resolveAccessibility: () => new Promise((resolve) => {
			resolveLookup = () => resolve({
				geometry: { x: 100, y: 200, width: 120, height: 60 },
				metadata: { confidence: 0.9, role: "push button" },
			});
		}), resolvePrograms: () => [] },
		capture: { create: async (_directory, geometry) => {
			captured = true;
			return {
				kind: "captured",
				capture: { path: "/run/user/1000/ai-pointer/capture-test.png", geometry, sha256: "a".repeat(64) },
			};
		} },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(resolveLookup !== null, "accessibility lookup did not start");
		workflow.cancel();
		resolveLookup();
		await settleMainLoop();
		assert(captured === false, "cancelled accessibility geometry was captured");
	} finally { workflow.teardown(); }
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
	const view: Partial<AiPointerWorkflowView> = {
		create() {}, clearOcr() {}, hide() {}, endStroke() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory, queryLocked: () => false },
		assistant: { preflight: readyPreflight },
	}));
	try {
		workflow.init();
		assert(Gio.File.new_for_path(staleCapture).query_exists(null) === false, "stale capture survived initialization");
		assert(Gio.File.new_for_path(unrelated).query_exists(null), "initialization deleted an unrelated runtime file");
	} finally {
		workflow.teardown();
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
			undefined,
			{ executable: helper, hardTimeoutMs: 10, cancellationGraceMs: 20 },
		);
		assert(result.kind === "failed" && result.code === "timeout", "helper timeout was not bounded");
	} finally {
		Gio.File.new_for_path(helper).delete(null);
	}
});

test("AI Pointer fails closed when lock state is unavailable", () => {
	const view: Partial<AiPointerWorkflowView> = {
		create() {}, clearOcr() {}, hide() {}, endStroke() {}, dispose() {},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		desktop: { prepareCaptureDirectory: () => "/run/user/1000/ai-pointer", queryLocked: () => null },
		assistant: { preflight: readyPreflight },
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }) === false, "unknown lock state started a capture");
	} finally {
		workflow.teardown();
	}
});
