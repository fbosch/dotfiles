import { evaluateHyprland } from "@/services/hyprland-ipc";
import {
	type AccessibilityLookupMode,
	clickFallbackForPoint,
	programsForSelection,
	resolveAccessibleSelection,
} from "./accessibility";
import type { AccessibilityResolution } from "./accessibility/policy";
import { requestAnswer } from "./answer-client";
import { AiPointerView } from "./ai-pointer-view";
import {
	captureRegion,
	deleteCapture,
	prepareCaptureDirectory,
	type CaptureResult,
} from "./capture";
import type { SelectionContext } from "./context";
import { querySelectionContext } from "./context-query";
import { getAiPointerApplication } from "./host-runtime";
import { querySessionLocked } from "./lock-monitor";
import { recognizeCapture, type OcrResult } from "./ocr";
import type { ProcessObserver } from "./owned-process";
import { preflightAiPointer } from "./preflight";
import { readPointerPosition } from "./pointer-query";
import type { PointerPosition, SelectionGeometry } from "./selection";
import type { PointerStroke } from "./stroke";
import Gio from "gi://Gio?version=2.0";
import type { AccessibilityDebugState } from "./accessibility/debug-state";
import type { ProgramMetadata } from "./accessibility/policy";
import type { AnswerClientResult, AnswerPreflightResult } from "./answer-client";

export type AiPointerWorkflowView = Pick<
	AiPointerView,
	| "beginStroke"
	| "clearOcr"
	| "create"
	| "dispose"
	| "endStroke"
	| "finishStroke"
	| "hide"
	| "setAccessibilityDebugState"
	| "setOcrState"
	| "showAnswer"
	| "showError"
	| "showPartialAnswer"
	| "showPreparing"
	| "showPrompt"
	| "showRequesting"
	| "updateStroke"
>;

export interface AiPointerNativeAdapter {
	readonly view: AiPointerWorkflowView;
	readonly host: {
		connectShutdown(callback: () => void): () => void;
	};
	readonly desktop: {
		prepareCaptureDirectory(): string | null;
		queryLocked(): boolean | null;
		readPointer(): PointerPosition | null;
		setCursorOutline(enabled: boolean): boolean | void;
	};
	readonly selection: {
		resolveAccessibility(
			geometry: SelectionGeometry,
			stroke: PointerStroke,
			cancellable: Gio.Cancellable,
			onProcess: ProcessObserver,
			onDebugState?: (state: AccessibilityDebugState) => void,
			mode?: AccessibilityLookupMode,
		): Promise<AccessibilityResolution | null>;
		resolveClickGeometry(point: PointerPosition): SelectionGeometry | null;
		resolveContext(geometry: SelectionGeometry): SelectionContext;
		resolvePrograms(geometry: SelectionGeometry): ProgramMetadata[];
	};
	readonly capture: {
		create(
			directory: string,
			geometry: SelectionGeometry,
			cancellable: Gio.Cancellable,
			onProcess: ProcessObserver,
			onPath?: (path: string | null) => void,
		): Promise<CaptureResult>;
		/** Release only artifacts issued by create; unknown paths must be refused. */
		remove(path: string): void;
	};
	readonly assistant: {
		preflight(
			cancellable: Gio.Cancellable,
			onProcess: ProcessObserver,
		): Promise<AnswerPreflightResult>;
		recognizeOcr(
			input: { path: string; pixelHeight: number; pixelWidth: number },
			cancellable: Gio.Cancellable,
			onProcess: ProcessObserver,
		): Promise<OcrResult>;
		requestAnswer(
			input: {
				requestId: string;
				prompt: string;
				attachment: { path: string; sha256: string };
				timeoutSeconds: number;
			},
			cancellable: Gio.Cancellable,
			onProcess: ProcessObserver,
			onDelta?: (text: string) => void,
		): Promise<AnswerClientResult>;
	};
}

export function createAiPointerNativeAdapter(): AiPointerNativeAdapter {
	return {
		view: new AiPointerView(),
		host: {
			connectShutdown(callback) {
				const application = getAiPointerApplication();
				const signalId = application.connect("shutdown", callback);
				return () => application.disconnect(signalId);
			},
		},
		desktop: {
			prepareCaptureDirectory,
			queryLocked: querySessionLocked,
			readPointer: readPointerPosition,
			setCursorOutline(enabled) {
				evaluateHyprland(`hl.plugin.cursor_outline.${enabled ? "on" : "off"}()`, {
					component: "ai-pointer",
					metric: "cursorOutline",
				});
			},
		},
		selection: {
			resolveAccessibility: resolveAccessibleSelection,
			resolveClickGeometry: clickFallbackForPoint,
			resolveContext: querySelectionContext,
			resolvePrograms: programsForSelection,
		},
		capture: {
			create: captureRegion,
			remove: deleteCapture,
		},
		assistant: {
			preflight: preflightAiPointer,
			recognizeOcr: recognizeCapture,
			requestAnswer,
		},
	};
}
