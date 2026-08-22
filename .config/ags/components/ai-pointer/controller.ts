import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import { evaluateHyprland, queryHyprlandJson } from "@/services/hyprland-ipc";
import { perf } from "@/services/performance-monitor";
import {
	type AccessibilityLookupMode,
	clickFallbackForPoint,
	programsForSelection,
	resolveAccessibleSelection,
} from "./accessibility";
import type {
	AccessibilityCandidateDiagnostic,
	AccessibilityMetadata,
	AccessibilityResolution,
	ProgramMetadata,
} from "./accessibility/policy";
import { captureRegion, deleteCapture, prepareCaptureDirectory, type Capture } from "./capture";
import { emptySelectionContext, type SelectionContext } from "./context";
import { querySelectionContext } from "./context-query";
import { aiPointerMachine } from "./machine";
import { AiPointerView, type CapturePreview } from "./ai-pointer-view";
import { recognizeCapture, type OcrResult } from "./ocr";
import { aiPointerPerformanceMetrics } from "./performance-metrics";
import {
	type PointerPosition,
	type SelectionGeometry,
} from "./selection";
import {
	appendStrokePoint,
	createPointerStroke,
	type PointerStroke,
	selectionFromStroke,
} from "./stroke";

type AiPointerActor = ActorRefFrom<typeof aiPointerMachine>;

interface AiPointerControllerOptions {
	view?: AiPointerView;
	capture?(
		directory: string,
		geometry: SelectionGeometry,
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<Awaited<ReturnType<typeof captureRegion>>>;
	prepareDirectory?(): string | null;
	readPointer?(): PointerPosition | null;
	resolveClickGeometry?(point: PointerPosition): SelectionGeometry | null;
	resolvePrograms?(geometry: SelectionGeometry): ProgramMetadata[];
	resolveContext?(geometry: SelectionGeometry): SelectionContext;
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

export class AiPointerController {
	readonly #view: AiPointerView;
	readonly #captureRegion: NonNullable<AiPointerControllerOptions["capture"]>;
	readonly #prepareDirectory: NonNullable<AiPointerControllerOptions["prepareDirectory"]>;
	readonly #readPointer: NonNullable<AiPointerControllerOptions["readPointer"]>;
	readonly #recognizeOcr: NonNullable<AiPointerControllerOptions["recognizeOcr"]>;
	readonly #resolveContext: NonNullable<AiPointerControllerOptions["resolveContext"]>;
	readonly #resolveClickGeometry: NonNullable<AiPointerControllerOptions["resolveClickGeometry"]>;
	readonly #resolveAccessibility: NonNullable<AiPointerControllerOptions["resolveAccessibility"]>;
	readonly #resolvePrograms: NonNullable<AiPointerControllerOptions["resolvePrograms"]>;
	readonly #setCursorOutline: NonNullable<AiPointerControllerOptions["setCursorOutline"]>;
	#actor: AiPointerActor | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#cancellable: Gio.Cancellable | null = null;
	#process: Gio.Subprocess | null = null;
	#ocrStartId = 0;
	#ocrCancellable: Gio.Cancellable | null = null;
	#ocrProcess: Gio.Subprocess | null = null;
	#capture: Capture | null = null;
	#accessibilityMetadata: AccessibilityMetadata | null = null;
	#accessibilityDiagnostics: AccessibilityCandidateDiagnostic[] = [];
	#programMetadata: ProgramMetadata[] = [];
	#selectionContext: SelectionContext | null = null;
	#directory: string | null = null;
	#pendingFinish: PointerPosition | null = null;
	#pendingFinishId = 0;
	#stroke: PointerStroke | null = null;
	#failureMessage = "";
	#finishing = false;
	#runId = 0;
	#workflowMark: ReturnType<typeof perf.start> | null = null;
	#cursorOutlineState: boolean | null = null;

	constructor(options: AiPointerControllerOptions = {}) {
		this.#view = options.view ?? new AiPointerView();
		this.#captureRegion = options.capture ?? captureRegion;
		this.#prepareDirectory = options.prepareDirectory ?? prepareCaptureDirectory;
		this.#resolveAccessibility = options.resolveAccessibility ?? resolveAccessibleSelection;
		this.#resolveContext = options.resolveContext ?? querySelectionContext;
		this.#resolveClickGeometry = options.resolveClickGeometry ?? clickFallbackForPoint;
		this.#resolvePrograms = options.resolvePrograms ?? programsForSelection;
		this.#recognizeOcr = options.recognizeOcr ?? recognizeCapture;
		this.#setCursorOutline = options.setCursorOutline ?? ((enabled) => {
			evaluateHyprland(`hl.plugin.cursor_outline.${enabled ? "on" : "off"}()`, {
				component: "ai-pointer",
				metric: "cursorOutline",
			});
		});
		this.#readPointer = options.readPointer ?? (() => {
			const position = queryHyprlandJson<{ x?: unknown; y?: unknown }>("j/cursorpos", {
				component: "ai-pointer",
				metric: "strokeCursorPosition",
			});
			if (
				typeof position?.x !== "number" ||
				typeof position.y !== "number" ||
				Number.isSafeInteger(position.x) === false ||
				Number.isSafeInteger(position.y) === false
			)
				return null;
			return { x: position.x, y: position.y };
		});
	}

	get selectionContext(): SelectionContext | null {
		return this.#selectionContext;
	}

	init(): void {
		if (!this.#actor) {
			this.#view.create({ onCancel: () => this.cancel() });
			this.#actor = createActor(aiPointerMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.matches("preview") && this.#capture) {
					const previewMark = perf.isEnabled()
						? perf.start("ai-pointer", aiPointerPerformanceMetrics.previewPresentation)
						: null;
					let preview: CapturePreview | null = null;
					try {
						preview = this.#view.showCapture(this.#capture);
					} catch {
						previewMark?.end(false, "failed");
					}
					previewMark?.end(preview !== null, preview ? undefined : "failed");
					if (!preview) {
						this.#finishWorkflow(false, "preview-failed");
						this.#failureMessage = "The captured image could not be previewed.";
						deleteCapture(this.#capture.path);
						this.#capture = null;
						this.#actor?.send({ type: "FAIL" });
						return;
					}
					this.#scheduleOcr(this.#capture, preview);
					return;
				}
				if (snapshot.matches("failed")) {
					this.#view.showError(this.#failureMessage);
					return;
				}
				if (snapshot.hasTag("surface-visible") === false) this.#view.hide();
			});
			this.#actor.start();
			this.#setCursorOutlineState(false, true);
		}
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	start(startPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("idle") === false) return false;

		const directory = this.#prepareDirectory();
		if (!directory) {
			this.#failureMessage = "Private runtime storage is unavailable.";
			this.#actor?.send({ type: "START" });
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		this.#directory = directory;
		this.#stroke = createPointerStroke(startPosition);
		this.#accessibilityMetadata = null;
		this.#accessibilityDiagnostics = [];
		this.#programMetadata = [];
		this.#selectionContext = null;
		this.#finishing = false;
		++this.#runId;
		this.#actor?.send({ type: "START" });
		if (this.#view.beginStroke(this.#stroke, () => this.#sampleStroke()) === false) {
			this.#failureMessage = "The drawing overlay is unavailable.";
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		this.#setCursorOutlineState(true);
		if (this.#pendingFinish) {
			const endPosition = this.#pendingFinish;
			this.#clearPendingFinish();
			this.#captureAt(endPosition);
		}
		return true;
	}

	finish(endPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("selecting") && this.#finishing === false) {
			this.#captureAt(endPosition);
			return true;
		}
		if (this.#actor?.getSnapshot().matches("idle") === false) return false;

		this.#clearPendingFinish();
		this.#pendingFinish = endPosition;
		this.#pendingFinishId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
			this.#pendingFinishId = 0;
			this.#pendingFinish = null;
			return GLib.SOURCE_REMOVE;
		});
		return true;
	}

	#captureAt(endPosition: PointerPosition): void {
		if (this.#actor?.getSnapshot().matches("selecting") === false) return;
		this.#setCursorOutlineState(false);
		const directory = this.#directory;
		const stroke = this.#stroke;
		if (!stroke || !directory) {
			this.#view.endStroke();
			this.#failureMessage = "The drawing path is unavailable.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		this.#stroke = appendStrokePoint(stroke, endPosition, true);
		const completedStroke = this.#stroke;
		const strokeGeometry = selectionFromStroke(completedStroke);
		const mode: AccessibilityLookupMode = strokeGeometry ? "stroke" : "click";
		const geometry = strokeGeometry ?? this.#resolveClickGeometry(endPosition);
		if (!geometry) {
			this.#view.endStroke();
			this.#failureMessage = "The clicked monitor could not be resolved.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		const runId = this.#runId;
		this.#finishing = true;
		this.#workflowMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.workflowCompletion)
			: null;
		const overlayMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.overlayTeardown)
			: null;
		void this.#view.finishStroke().then((hidden) => {
			overlayMark?.end(hidden, hidden ? undefined : "failed");
			if (runId !== this.#runId) return;
			this.#setCursorOutlineState(false);
			if (hidden === false) {
				this.#finishing = false;
				this.#finishWorkflow(false, "overlay-failed");
				this.#failureMessage = "The drawing overlay could not be removed safely.";
				this.#actor?.send({ type: "FAIL" });
				return;
			}
			this.#captureGeometry(directory, geometry, completedStroke, runId, mode);
		}).catch(() => {
			overlayMark?.end(false, "failed");
			if (runId !== this.#runId) return;
			this.#finishing = false;
			this.#finishWorkflow(false, "overlay-failed");
			this.#failureMessage = "The drawing overlay could not be removed safely.";
			this.#actor?.send({ type: "FAIL" });
		});
	}

	#captureGeometry(
		directory: string,
		geometry: SelectionGeometry,
		stroke: PointerStroke,
		runId: number,
		mode: AccessibilityLookupMode,
	): void {
		const cancellable = new Gio.Cancellable();
		this.#cancellable = cancellable;
		void this.#resolveAndCapture(directory, geometry, stroke, runId, cancellable, mode);
	}

	async #resolveAndCapture(
		directory: string,
		strokeGeometry: SelectionGeometry,
		stroke: PointerStroke,
		runId: number,
		cancellable: Gio.Cancellable,
		mode: AccessibilityLookupMode,
	): Promise<void> {
		const observeProcess = (process: Gio.Subprocess | null) => {
			if (runId === this.#runId) this.#process = process;
		};
		let resolution: AccessibilityResolution | null = null;
		const accessibilityMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityLookup)
			: null;
		try {
			resolution = await this.#resolveAccessibility(
				strokeGeometry,
				stroke,
				cancellable,
				observeProcess,
				(diagnostics) => {
					if (runId === this.#runId) this.#accessibilityDiagnostics = diagnostics;
				},
				mode,
			);
			accessibilityMark?.end(
				runId === this.#runId && cancellable.is_cancelled() === false,
				runId === this.#runId && cancellable.is_cancelled() === false ? undefined : "cancelled",
			);
		} catch {
			accessibilityMark?.end(false, "failed");
			// Accessibility is advisory; stroke geometry remains the safe fallback.
		}
		if (runId !== this.#runId || cancellable.is_cancelled()) return;

		const captureGeometry = resolution?.geometry ?? strokeGeometry;
		try {
			this.#selectionContext = this.#resolveContext(captureGeometry);
		} catch {
			this.#selectionContext = emptySelectionContext(captureGeometry);
		}
		this.#accessibilityMetadata = resolution?.metadata ?? null;
		this.#programMetadata = this.#resolvePrograms(captureGeometry);
		let result: Awaited<ReturnType<typeof captureRegion>>;
		const captureMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.capture)
			: null;
		try {
			result = await this.#captureRegion(
				directory,
				captureGeometry,
				cancellable,
				observeProcess,
			);
			captureMark?.end(
				result.kind === "captured",
				result.kind === "captured" ? undefined : result.kind,
			);
		} catch {
			captureMark?.end(false, "failed");
			if (runId !== this.#runId) return;
			this.#finishWorkflow(false, "capture-failed");
			this.#finishing = false;
			this.#cancellable = null;
			this.#process = null;
			this.#failureMessage = "The selected region could not be captured.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}

		if (runId !== this.#runId) {
			if (result.kind === "captured") deleteCapture(result.capture.path);
			return;
		}
		this.#cancellable = null;
		this.#process = null;
		if (cancellable.is_cancelled() || result.kind === "cancelled") {
			this.#finishWorkflow(false, "cancelled");
			this.#finishing = false;
			this.#actor?.send({ type: "CANCEL" });
			return;
		}
		if (result.kind === "failed") {
			this.#finishWorkflow(false, "capture-failed");
			this.#finishing = false;
			this.#failureMessage = result.message;
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		this.#capture = result.capture;
		this.#finishing = false;
		this.#actor?.send({ type: "CAPTURED" });
	}

	cancel(): void {
		this.#setCursorOutlineState(false);
		this.#runId += 1;
		this.#finishWorkflow(false, "cancelled");
		this.#stopOcr();
		this.#cancellable?.cancel();
		this.#cancellable = null;
		this.#process?.force_exit();
		this.#process = null;
		this.#directory = null;
		this.#stroke = null;
		this.#accessibilityMetadata = null;
		this.#accessibilityDiagnostics = [];
		this.#programMetadata = [];
		this.#selectionContext = null;
		this.#finishing = false;
		this.#view.endStroke();
		this.#clearPendingFinish();
		if (this.#capture) deleteCapture(this.#capture.path);
		this.#capture = null;
		this.#actor?.send({ type: "CANCEL" });
	}

	teardown(): void {
		this.cancel();
		this.#setCursorOutlineState(false, true);
		this.#subscription?.unsubscribe();
		this.#subscription = null;
		this.#actor?.stop();
		this.#actor = null;
		this.#view.dispose();
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	#clearPendingFinish(): void {
		if (this.#pendingFinishId !== 0) GLib.source_remove(this.#pendingFinishId);
		this.#pendingFinishId = 0;
		this.#pendingFinish = null;
	}

	#scheduleOcr(capture: Capture, preview: CapturePreview): void {
		this.#stopOcr();
		const runId = this.#runId;
		this.#ocrStartId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this.#ocrStartId = 0;
			if (runId === this.#runId) this.#startOcr(capture, preview);
			return GLib.SOURCE_REMOVE;
		});
	}

	#startOcr(capture: Capture, preview: CapturePreview): void {
		const runId = this.#runId;
		const cancellable = new Gio.Cancellable();
		this.#ocrCancellable = cancellable;
		this.#view.setOcrState({ kind: "pending" });
		const ocrMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.ocrCompletion)
			: null;
		const workflowMark = this.#workflowMark;
		void this.#recognizeOcr(
			{ path: capture.path, ...preview },
			cancellable,
			(process) => {
				if (runId === this.#runId) this.#ocrProcess = process;
			},
		).then((result) => {
			const succeeded = result.kind === "no-text" || result.kind === "text" || result.kind === "truncated";
			ocrMark?.end(succeeded, succeeded ? undefined : result.kind);
			workflowMark?.end(
				succeeded,
				succeeded ? undefined : result.kind,
			);
			if (this.#workflowMark === workflowMark) this.#workflowMark = null;
			if (runId !== this.#runId || cancellable.is_cancelled() || result.kind === "cancelled")
				return;
			this.#view.setOcrState(result);
		}).catch(() => {
			ocrMark?.end(false, "failed");
			workflowMark?.end(false, "failed");
			if (this.#workflowMark === workflowMark) this.#workflowMark = null;
			if (runId === this.#runId && cancellable.is_cancelled() === false)
				this.#view.setOcrState({ kind: "unavailable", reason: "process-failed" });
		}).finally(() => {
			ocrMark?.end(false, "failed");
			workflowMark?.end(false, "failed");
			if (this.#workflowMark === workflowMark) this.#workflowMark = null;
			if (runId !== this.#runId) return;
			this.#ocrCancellable = null;
			this.#ocrProcess = null;
		});
	}

	#stopOcr(): void {
		if (this.#ocrStartId !== 0) GLib.source_remove(this.#ocrStartId);
		this.#ocrStartId = 0;
		this.#ocrCancellable?.cancel();
		this.#ocrCancellable = null;
		this.#ocrProcess?.force_exit();
		this.#ocrProcess = null;
		this.#view.clearOcr();
	}

	#finishWorkflow(ok: boolean, reason?: string): void {
		this.#workflowMark?.end(ok, reason);
		this.#workflowMark = null;
	}

	#setCursorOutlineState(enabled: boolean, force = false): void {
		if (force === false && this.#cursorOutlineState === enabled) return;
		try {
			this.#cursorOutlineState = this.#setCursorOutline(enabled) === false ? null : enabled;
		} catch {
			this.#cursorOutlineState = null;
			// Cursor decoration is advisory and must not interrupt capture.
		}
	}

	#sampleStroke(): void {
		if (this.#actor?.getSnapshot().matches("selecting") === false) return;
		const point = this.#readPointer();
		if (!point || !this.#stroke) return;
		this.#stroke = appendStrokePoint(this.#stroke, point);
		this.#view.updateStroke(this.#stroke);
	}
}
