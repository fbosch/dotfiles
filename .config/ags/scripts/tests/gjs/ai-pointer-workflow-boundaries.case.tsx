import GLib from "gi://GLib?version=2.0";
import type { AccessibilityDebugState } from "@/components/ai-pointer/accessibility";
import type { AiPointerViewHandlers } from "@/components/ai-pointer/ai-pointer-view";
import type { AiPointerWorkflowView } from "@/components/ai-pointer/native-adapter";
import { AiPointerWorkflow } from "@/components/ai-pointer/workflow";
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

test("AI Pointer degrades failed context lookup through the submitted request", async () => {
	let captured = 0;
	let programLookups = 0;
	let promptCalls = 0;
	let requestPrompt = "";
	let submit: ((question: string) => void) | null = null;
	const view: Partial<AiPointerWorkflowView> = {
		create(handlers: AiPointerViewHandlers) { submit = handlers.onSubmit; },
		showPrompt() {
			promptCalls += 1;
			return { pixelHeight: 20, pixelWidth: 20 };
		},
	};
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view,
		assistant: {
			preflight: readyPreflight,
			recognizeOcr: async () => ({ kind: "no-text" }),
			requestAnswer: async (input) => {
				requestPrompt = input.prompt;
				return { kind: "answered", answer: "answer", truncated: false };
			},
		},
		selection: {
			resolveAccessibility: async () => null,
			resolveContext: () => { throw new Error("fixture IPC failure"); },
			resolvePrograms: () => {
				programLookups += 1;
				return [];
			},
		},
		capture: {
			create: async (_directory, geometry) => {
				captured += 1;
				return {
					kind: "captured",
					capture: {
						path: "/run/user/1000/ai-pointer/capture-test.png",
						geometry,
						sha256: "a".repeat(64),
					},
				};
			},
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		await settleMainLoop();
		assert(captured === 1, "selection was not captured");
		assert(programLookups === 1, "local context was not resolved");
		assert(promptCalls === 1, "question prompt was not shown");
		assert(submit !== null, "composition submit handler was unavailable");
		submit("What is shown?");
		await settleMainLoop();
		assert(
			requestPrompt.includes("Client geometric candidates: none."),
			"context failure did not degrade safely in the submitted request",
		);
	} finally {
		workflow.teardown();
	}
});

test("AI Pointer rejects accessibility diagnostics from a stale run", async () => {
	let emitDebug: ((state: AccessibilityDebugState) => void) | null = null;
	let resolveAccessibility: (() => void) | null = null;
	const debugStates: AccessibilityDebugState[] = [];
	const workflow = new AiPointerWorkflow(createTestAiPointerNativeAdapter({
		view: {
			setAccessibilityDebugState: (state) => { debugStates.push(state); },
		},
		selection: {
			resolveAccessibility: async (_geometry, _stroke, _cancellable, _onProcess, onDebugState) =>
				await new Promise((resolve) => {
					emitDebug = onDebugState ?? null;
					resolveAccessibility = () => resolve(null);
				}),
		},
	}));
	workflow.init();
	try {
		assert(workflow.start({ x: 10, y: 20 }), "start request was rejected");
		assert(workflow.finish({ x: 30, y: 40 }), "finish request was rejected");
		assert(emitDebug !== null, "accessibility diagnostics callback was not registered");
		workflow.cancel();
		assert(workflow.start({ x: 50, y: 60 }), "second start request was rejected");
		emitDebug({ kind: "pending", regionKind: "box" });
		assert(debugStates.length === 0, "stale accessibility diagnostics reached the new run");
		resolveAccessibility?.();
		await settleMainLoop();
	} finally {
		workflow.teardown();
	}
});
