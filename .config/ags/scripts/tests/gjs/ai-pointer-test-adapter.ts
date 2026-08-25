import type {
	AiPointerNativeAdapter,
	AiPointerWorkflowView,
} from "@/components/ai-pointer/native-adapter";
import { emptySelectionContext } from "@/components/ai-pointer/context";

interface TestAiPointerNativeAdapterOverrides {
	view?: Partial<AiPointerWorkflowView>;
	host?: Partial<AiPointerNativeAdapter["host"]>;
	desktop?: Partial<AiPointerNativeAdapter["desktop"]>;
	selection?: Partial<AiPointerNativeAdapter["selection"]>;
	capture?: Partial<AiPointerNativeAdapter["capture"]>;
	assistant?: Partial<AiPointerNativeAdapter["assistant"]>;
}

const noOpView: AiPointerWorkflowView = {
	create() {},
	beginStroke() { return true; },
	updateStroke() {},
	endStroke() {},
	finishStroke() { return Promise.resolve(true); },
	setAccessibilityDebugState() {},
	showPreparing() {},
	showPrompt() { return { pixelHeight: 1, pixelWidth: 1 }; },
	showRequesting() {},
	showPartialAnswer() {},
	showAnswer() {},
	setOcrState() {},
	clearOcr() {},
	showError() {},
	hide() {},
	dispose() {},
};

export function createTestAiPointerNativeAdapter({
	view = noOpView,
	host,
	desktop,
	selection,
	capture,
	assistant,
}: TestAiPointerNativeAdapterOverrides = {}): AiPointerNativeAdapter {
	return {
		view: { ...noOpView, ...view },
		host: {
			connectShutdown: () => () => {},
			...host,
		},
		desktop: {
			prepareCaptureDirectory: () => "/run/user/1000/ai-pointer",
			queryLocked: () => false,
			readPointer: () => null,
			setCursorOutline: () => true,
			...desktop,
		},
		selection: {
			resolveAccessibility: async () => null,
			resolveClickGeometry: () => null,
			resolveContext: emptySelectionContext,
			resolvePrograms: () => [],
			...selection,
		},
		capture: {
			create: async () => ({ kind: "cancelled" }),
			remove() {},
			...capture,
		},
		assistant: {
			preflight: async () => ({ kind: "ready" }),
			recognizeOcr: async () => ({ kind: "no-text" }),
			requestAnswer: async () => ({ kind: "cancelled" }),
			...assistant,
		},
	};
}
