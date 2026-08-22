import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import { evaluateHyprland } from "@/services/hyprland-ipc";
import { perf } from "@/services/performance-monitor";
import {
	type AccessibilityLookupMode,
	clickFallbackForPoint,
	programsForSelection,
	resolveAccessibleSelection,
} from "./accessibility";
import type { AccessibilityResolution } from "./accessibility/policy";
import { captureRegion, deleteCapture, prepareCaptureDirectory, type Capture } from "./capture";
import { requestAnswer } from "./answer-client";
import type { AiPointerControllerOptions } from "./controller-options";
import { emptySelectionContext, formatSelectionContext, type SelectionContext } from "./context";
import { querySelectionContext } from "./context-query";
import { querySessionLocked, SessionLockMonitor } from "./lock-monitor";
import { aiPointerMachine } from "./machine";
import { AiPointerView, type CapturePreview } from "./ai-pointer-view";
import { recognizeCapture } from "./ocr";
import { aiPointerPerformanceMetrics } from "./performance-metrics";
import { readPointerPosition } from "./pointer-query";
import { beginPreflightSelection, preflightAiPointer, runSelectionPreflight } from "./preflight";
import { settleProcessesForShutdown } from "./shutdown-processes";
import type { PointerPosition, SelectionGeometry } from "./selection";
import { appendStrokePoint, createPointerStroke, type PointerStroke, selectionFromStroke } from "./stroke";

type AiPointerActor = ActorRefFrom<typeof aiPointerMachine>;

export class AiPointerController {
	readonly #view: AiPointerView;
	readonly #captureRegion: NonNullable<AiPointerControllerOptions["capture"]>;
	readonly #prepareDirectory: NonNullable<AiPointerControllerOptions["prepareDirectory"]>;
	readonly #readPointer: NonNullable<AiPointerControllerOptions["readPointer"]>;
	readonly #recognizeOcr: NonNullable<AiPointerControllerOptions["recognizeOcr"]>;
	readonly #resolveContext: NonNullable<AiPointerControllerOptions["resolveContext"]>;
	readonly #requestAnswer: NonNullable<AiPointerControllerOptions["requestAnswer"]>;
	readonly #preflight: NonNullable<AiPointerControllerOptions["preflight"]>;
	readonly #lockMonitor: SessionLockMonitor;
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
	#answerCancellable: Gio.Cancellable | null = null;
	#answerProcess: Gio.Subprocess | null = null;
	#answer = "";
	#answerTruncated = false;
	readonly #terminatingProcesses = new Set<Gio.Subprocess>();
	#capture: Capture | null = null;
	#pendingCapturePath: string | null = null;
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
		const queryLocked = options.queryLocked ?? querySessionLocked;
		this.#requestAnswer = options.requestAnswer ?? requestAnswer;
		this.#preflight = options.preflight ?? preflightAiPointer;
		this.#lockMonitor = new SessionLockMonitor(queryLocked, () => this.cancel());
		this.#resolveClickGeometry = options.resolveClickGeometry ?? clickFallbackForPoint;
		this.#resolvePrograms = options.resolvePrograms ?? programsForSelection;
		this.#recognizeOcr = options.recognizeOcr ?? recognizeCapture;
		this.#setCursorOutline = options.setCursorOutline ?? ((enabled) => {
			evaluateHyprland(`hl.plugin.cursor_outline.${enabled ? "on" : "off"}()`, {
				component: "ai-pointer",
				metric: "cursorOutline",
			});
		});
		this.#readPointer = options.readPointer ?? readPointerPosition;
	}

	get selectionContext(): SelectionContext | null {
		return this.#selectionContext;
	}

	init(): void {
		if (!this.#actor) {
			this.#view.create({
				onCancel: () => this.cancel(),
				onSubmit: (question) => this.#submit(question),
			});
			this.#actor = createActor(aiPointerMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.matches("composition") && this.#capture && this.#selectionContext) {
					if (this.#lockMonitor.blocksWorkflow) {
						this.cancel();
						return;
					}
					const previewMark = perf.isEnabled()
						? perf.start("ai-pointer", aiPointerPerformanceMetrics.previewPresentation)
						: null;
					let preview: CapturePreview | null = null;
					try {
						preview = this.#view.showCapture(
							this.#capture,
							formatSelectionContext(this.#selectionContext),
						);
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
				if (snapshot.matches("requesting")) {
					this.#view.showRequesting();
					return;
				}
				if (snapshot.matches("answered")) {
					if (this.#lockMonitor.blocksWorkflow) {
						this.cancel();
						return;
					}
					this.#view.showAnswer(this.#answer, this.#answerTruncated);
					return;
				}
				if (snapshot.matches("failed")) {
					this.#view.showError(this.#failureMessage);
					return;
				}
				if (snapshot.hasTag("surface-visible") === false && snapshot.hasTag("selector-active") === false)
					this.#view.hide();
			});
			this.#actor.start();
			this.#directory = this.#prepareDirectory();
			this.#setCursorOutlineState(false, true);
		}
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown(true));
	}

	start(startPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("idle") === false) return false;
		if (this.#lockMonitor.blocksWorkflow) return false;

		const directory = this.#directory ?? this.#prepareDirectory();
		if (!directory) {
			this.#failureMessage = "Private runtime storage is unavailable.";
			this.#actor?.send({ type: "START" });
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		this.#directory = directory;
		this.#stroke = createPointerStroke(startPosition);
		this.#selectionContext = null;
		this.#answer = "";
		this.#answerTruncated = false;
		this.#finishing = false;
		++this.#runId;
		if (this.#pendingFinishId !== 0) GLib.source_remove(this.#pendingFinishId);
		this.#pendingFinishId = 0;
		this.#actor?.send({ type: "START" });
		this.#lockMonitor.start();
		if (beginPreflightSelection(this.#view, this.#stroke, () => this.#sampleStroke()) === false) {
			this.#failureMessage = "The drawing overlay is unavailable.";
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		this.#setCursorOutlineState(true);
		if (this.#pendingFinish) {
			const endPosition = this.#pendingFinish;
			this.#pendingFinish = null;
			this.finish(endPosition);
		}
		this.#startPreflight(this.#runId);
		return true;
	}

	finish(endPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("preflighting")) {
			if (this.#pendingFinish) return false;
			if (this.#stroke) {
				this.#stroke = appendStrokePoint(this.#stroke, endPosition, true);
				this.#view.updateStroke(this.#stroke);
			}
			this.#setCursorOutlineState(false);
			this.#finishing = true;
			this.#pendingFinish = endPosition;
			return true;
		}
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

	#startPreflight(runId: number): void {
		const cancellable = new Gio.Cancellable();
		let observedProcess: Gio.Subprocess | null = null;
		this.#cancellable = cancellable;
		void runSelectionPreflight(this.#preflight, cancellable, (process) => {
			if (process) observedProcess = process;
			if (!process && observedProcess) this.#terminatingProcesses.delete(observedProcess);
			if (runId === this.#runId) this.#process = process;
		}).then((result) => {
			if (runId !== this.#runId || cancellable.is_cancelled()) return;
			this.#cancellable = null;
			this.#process = null;
			if (result.kind === "failed") {
				this.#setCursorOutlineState(false);
				this.#view.endStroke();
				this.#failureMessage = result.message;
				this.#actor?.send({ type: "FAIL" });
				return;
			}
			this.#actor?.send({ type: "READY" });
			if (!this.#pendingFinish) return;
			const endPosition = this.#pendingFinish;
			this.#clearPendingFinish();
			this.#captureAt(endPosition);
		});
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
		let observedProcess: Gio.Subprocess | null = null;
		const observeProcess = (process: Gio.Subprocess | null) => {
			if (process) observedProcess = process;
			if (!process && observedProcess) this.#terminatingProcesses.delete(observedProcess);
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
				undefined,
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
		if (this.#selectionContext.locked === true || this.#lockMonitor.blocksWorkflow) {
			this.cancel();
			return;
		}
		this.#resolvePrograms(captureGeometry);
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
				(path) => {
					if (runId === this.#runId) this.#pendingCapturePath = path;
				},
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
		this.#pendingCapturePath = null;
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
		this.#lockMonitor.stop();
		if (this.#answerProcess) this.#terminatingProcesses.add(this.#answerProcess);
		if (this.#process) this.#terminatingProcesses.add(this.#process);
		this.#answerCancellable?.cancel();
		this.#answerCancellable = null;
		this.#answerProcess = null;
		this.#cancellable?.cancel();
		this.#cancellable = null;
		this.#process = null;
		this.#directory = null;
		this.#stroke = null;
		this.#selectionContext = null;
		this.#answer = "";
		this.#answerTruncated = false;
		this.#finishing = false;
		this.#view.endStroke();
		this.#clearPendingFinish();
		if (this.#capture) deleteCapture(this.#capture.path);
		this.#capture = null;
		this.#actor?.send({ type: "CANCEL" });
	}

	teardown(force = false): void {
		const pendingCapturePath = this.#pendingCapturePath;
		const processes = new Set(this.#terminatingProcesses);
		if (this.#process) processes.add(this.#process);
		if (this.#answerProcess) processes.add(this.#answerProcess);
		this.cancel();
		if (force) settleProcessesForShutdown(processes);
		if (force && pendingCapturePath) deleteCapture(pendingCapturePath);
		this.#terminatingProcesses.clear();
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

	#submit(question: string): void {
		if (this.#actor?.getSnapshot().matches("composition") === false) return;
		const capture = this.#capture;
		const context = this.#selectionContext;
		const prompt = question.trim();
		if (!capture || !context || !prompt || this.#lockMonitor.blocksWorkflow) {
			if (this.#lockMonitor.blocksWorkflow) this.cancel();
			return;
		}

		const runId = this.#runId;
		const cancellable = new Gio.Cancellable();
		let observedProcess: Gio.Subprocess | null = null;
		this.#stopOcr();
		this.#answerCancellable = cancellable;
		this.#actor.send({ type: "SUBMIT" });
		void this.#requestAnswer(
			{
				requestId: `ai-pointer-${runId}`,
				prompt: `${prompt}\n\n${formatSelectionContext(context)}`,
				attachment: { path: capture.path, sha256: capture.sha256 },
				timeoutSeconds: 60,
			},
			cancellable,
			(process) => {
				if (process) observedProcess = process;
				if (!process && observedProcess) this.#terminatingProcesses.delete(observedProcess);
				if (runId === this.#runId) this.#answerProcess = process;
			},
		).then((result) => {
			if (runId !== this.#runId || cancellable.is_cancelled()) return;
			this.#answerCancellable = null;
			this.#answerProcess = null;
			deleteCapture(capture.path);
			if (this.#capture?.path === capture.path) this.#capture = null;
			if (this.#lockMonitor.blocksWorkflow) {
				this.cancel();
				return;
			}
			if (result.kind === "answered") {
				this.#answer = result.answer;
				this.#answerTruncated = result.truncated;
				this.#actor?.send({ type: "ANSWERED" });
				return;
			}
			if (result.kind === "cancelled") {
				this.cancel();
				return;
			}
			this.#failureMessage = result.message;
			this.#actor?.send({ type: "FAIL" });
		}).catch(() => {
			if (runId !== this.#runId || cancellable.is_cancelled()) return;
			this.#answerCancellable = null;
			this.#answerProcess = null;
			deleteCapture(capture.path);
			if (this.#capture?.path === capture.path) this.#capture = null;
			this.#failureMessage = "The answer helper did not complete.";
			this.#actor?.send({ type: "FAIL" });
		});
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
		if (this.#finishing) return;
		const snapshot = this.#actor?.getSnapshot();
		if (snapshot?.matches("preflighting") !== true && snapshot?.matches("selecting") !== true) return;
		const point = this.#readPointer();
		if (!point || !this.#stroke) return;
		this.#stroke = appendStrokePoint(this.#stroke, point);
		this.#view.updateStroke(this.#stroke);
	}
}
