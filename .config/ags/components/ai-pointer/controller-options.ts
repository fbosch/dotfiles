import Gio from "gi://Gio?version=2.0";
import type { AccessibilityLookupMode } from "./accessibility";
import type {
	AccessibilityCandidateDiagnostic,
	AccessibilityResolution,
	ProgramMetadata,
} from "./accessibility/policy";
import type { AnswerClientResult, AnswerPreflightResult } from "./answer-client";
import type { AiPointerView } from "./ai-pointer-view";
import type { Capture, captureRegion } from "./capture";
import type { SelectionContext } from "./context";
import type { OcrResult } from "./ocr";
import type { PointerPosition, SelectionGeometry } from "./selection";
import type { PointerStroke } from "./stroke";

export interface AiPointerControllerOptions {
	view?: AiPointerView;
	capture?(
		directory: string,
		geometry: SelectionGeometry,
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
		onPath?: (path: string | null) => void,
	): Promise<Awaited<ReturnType<typeof captureRegion>>>;
	prepareDirectory?(): string | null;
	readPointer?(): PointerPosition | null;
	resolveClickGeometry?(point: PointerPosition): SelectionGeometry | null;
	resolvePrograms?(geometry: SelectionGeometry): ProgramMetadata[];
	resolveContext?(geometry: SelectionGeometry): SelectionContext;
	queryLocked?(): boolean | null;
	preflight?(
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<AnswerPreflightResult>;
	requestAnswer?(
		input: { requestId: string; prompt: string; attachment: { path: string; sha256: string }; timeoutSeconds: number },
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<AnswerClientResult>;
	setCursorOutline?(enabled: boolean): boolean | void;
	recognizeOcr?(
		input: { path: string; pixelHeight: number; pixelWidth: number },
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<OcrResult>;
	resolveAccessibility?(
		geometry: SelectionGeometry,
		stroke: PointerStroke,
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
		onDiagnostics?: (diagnostics: AccessibilityCandidateDiagnostic[]) => void,
		mode?: AccessibilityLookupMode,
	): Promise<AccessibilityResolution | null>;
}
