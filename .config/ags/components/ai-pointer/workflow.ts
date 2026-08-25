import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import { perf } from "@/services/performance-monitor";
import type { AccessibilityLookupMode } from "./accessibility";
import type { AccessibilityResolution } from "./accessibility/policy";
import type { Capture } from "./capture";
import { emptySelectionContext, formatDesktopPointerRequest, type SelectionContext } from "./context";
import { SessionLockMonitor } from "./lock-monitor";
import { aiPointerMachine } from "./machine";
import type { AiPointerNativeAdapter, AiPointerWorkflowView } from "./native-adapter";
import { AiPointerOperationRegistry, type AiPointerOperation } from "./operation-registry";
import type { CaptureDimensions } from "./ai-pointer-view";
import { aiPointerPerformanceMetrics } from "./performance-metrics";
import { beginPreflightSelection, runSelectionPreflight } from "./preflight";
import type { PointerPosition, SelectionGeometry } from "./selection";
import { appendStrokePoint, createPointerStroke, type PointerStroke, selectionFromStroke } from "./stroke";

export class AiPointerWorkflow {
	readonly #adapter: AiPointerNativeAdapter;
	readonly #view: AiPointerWorkflowView;
	readonly #lockMonitor: SessionLockMonitor;
	#actor: ActorRefFrom<typeof aiPointerMachine> | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#disconnectShutdown: (() => void) | null = null;
	#preflightPromise: ReturnType<typeof runSelectionPreflight> | null = null;
	#ocrStartId = 0;
	#answer = "";
	#answerTruncated = false;
	readonly #operations = new AiPointerOperationRegistry();
	#capture: Capture | null = null;
	#pendingCapturePath: string | null = null;
	#selectionContext: SelectionContext | null = null;
	#directory: string | null = null;
	#pendingFinish: PointerPosition | null = null;
	#pendingFinishId = 0;
	#stroke: PointerStroke | null = null;
	#failureMessage = "";
	#preparingGeometry: SelectionGeometry | null = null;
	#runId = 0;
	#workflowMark: ReturnType<typeof perf.start> | null = null;
	#cursorOutlineState: boolean | null = null;

	constructor(adapter: AiPointerNativeAdapter) {
		this.#adapter = adapter;
		this.#view = adapter.view;
		this.#lockMonitor = new SessionLockMonitor(
			adapter.desktop.queryLocked,
			() => this.cancel(),
		);
	}

	init(): void {
		if (!this.#actor) {
			this.#actor = createActor(aiPointerMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.matches("preparing")) {
					if (!this.#preparingGeometry) return;
					try {
						this.#view.showPreparing(this.#preparingGeometry);
					} catch {
						this.#finishWorkflow(false, "preparing-failed");
						this.#failureMessage = "The question field could not be prepared.";
						this.#actor?.send({ type: "FAIL" });
					}
					return;
				}
				if (snapshot.matches("composition") && this.#capture && this.#selectionContext) {
					if (this.#lockMonitor.blocksWorkflow) {
						this.cancel();
						return;
					}
					const promptMark = perf.isEnabled()
						? perf.start("ai-pointer", aiPointerPerformanceMetrics.promptPresentation)
						: null;
					let dimensions: CaptureDimensions | null = null;
					try {
						dimensions = this.#view.showPrompt(this.#capture);
					} catch {
						promptMark?.end(false, "failed");
					}
					promptMark?.end(dimensions !== null, dimensions ? undefined : "failed");
					if (!dimensions) {
						this.#finishWorkflow(false, "prompt-failed");
						this.#failureMessage = "The question field could not be presented.";
						this.#releaseCapture(this.#capture.path);
						this.#capture = null;
						this.#actor?.send({ type: "FAIL" });
						return;
					}
					this.#scheduleOcr(this.#capture, dimensions);
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
			this.#directory = this.#adapter.desktop.prepareCaptureDirectory();
			this.#setCursorOutlineState(false, true);
		}
		this.#disconnectShutdown ??= this.#adapter.host.connectShutdown(() => this.teardown(true));
	}

	start(startPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("idle") === false) return false;
		if (this.#lockMonitor.blocksWorkflow) return false;
		this.#view.create({
			onCancel: () => this.cancel(),
			onSubmit: (question) => this.#submit(question),
		});

		const directory = this.#directory ?? this.#adapter.desktop.prepareCaptureDirectory();
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
		this.#preparingGeometry = null;
		++this.#runId;
		if (this.#pendingFinishId !== 0) GLib.source_remove(this.#pendingFinishId);
		this.#pendingFinishId = 0;
		this.#actor?.send({ type: "START" });
		this.#lockMonitor.start();
		const selectionMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.selectionPresentation)
			: null;
		let selectionPresented = false;
		const selectionStarted = beginPreflightSelection(this.#view, this.#stroke, () => {
			if (selectionPresented === false) {
				selectionPresented = true;
				selectionMark?.end();
			}
			this.#sampleStroke();
		});
		if (selectionStarted === false) {
			selectionMark?.end(false, "failed");
			this.#failureMessage = "The drawing overlay is unavailable.";
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		this.#setCursorOutlineState(true);
		this.#startPreflight(this.#runId);
		if (this.#pendingFinish) {
			const endPosition = this.#pendingFinish;
			this.#pendingFinish = null;
			this.finish(endPosition);
		}
		return true;
	}

	finish(endPosition: PointerPosition): boolean {
		if (this.#actor?.getSnapshot().matches("selecting")) {
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
		const operation = this.#operations.start("preflight");
		const promise = runSelectionPreflight(
			this.#adapter.assistant.preflight,
			operation.cancellable,
			operation.observeProcess,
		);
		this.#preflightPromise = promise;
		void promise.finally(() => {
			operation.complete();
		});
	}

	#captureAt(endPosition: PointerPosition): void {
		if (this.#actor?.getSnapshot().matches("selecting") === false) return;
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
		const geometry = strokeGeometry ?? this.#adapter.selection.resolveClickGeometry(endPosition);
		if (!geometry) {
			this.#view.endStroke();
			this.#failureMessage = "The clicked monitor could not be resolved.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		const runId = this.#runId;
		this.#workflowMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.workflowCompletion)
			: null;
		this.#view.endStroke();
		this.#preparingGeometry = geometry;
		this.#actor?.send({ type: "FINISH" });
		if (this.#actor?.getSnapshot().matches("preparing") === false) return;
		this.#captureGeometry(directory, geometry, completedStroke, runId, mode);
	}

	#captureGeometry(
		directory: string,
		geometry: SelectionGeometry,
		stroke: PointerStroke,
		runId: number,
		mode: AccessibilityLookupMode,
	): void {
		const operation = this.#operations.start("capture");
		void this.#resolveAndCapture(directory, geometry, stroke, runId, operation, mode)
			.finally(operation.complete);
	}

	async #resolveAndCapture(
		directory: string,
		strokeGeometry: SelectionGeometry,
		stroke: PointerStroke,
		runId: number,
		operation: AiPointerOperation,
		mode: AccessibilityLookupMode,
	): Promise<void> {
		const { cancellable, observeProcess } = operation;
		let resolution: AccessibilityResolution | null = null;
		const accessibilityMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.accessibilityLookup)
			: null;
		try {
			const onDebugState = (state: Parameters<AiPointerWorkflowView["setAccessibilityDebugState"]>[0]) => {
				if (runId !== this.#runId || cancellable.is_cancelled()) return;
				this.#view.setAccessibilityDebugState(state);
			};
			resolution = await this.#adapter.selection.resolveAccessibility(
				strokeGeometry,
				stroke,
				cancellable,
				observeProcess,
				onDebugState,
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
			this.#selectionContext = this.#adapter.selection.resolveContext(captureGeometry);
		} catch {
			this.#selectionContext = emptySelectionContext(captureGeometry);
		}
		if (this.#selectionContext.locked === true || this.#lockMonitor.blocksWorkflow) {
			this.cancel();
			return;
		}
		this.#adapter.selection.resolvePrograms(captureGeometry);
		const overlayMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.overlayTeardown)
			: null;
		let overlayHidden = false;
		try {
			overlayHidden = await this.#view.finishStroke(captureGeometry);
			overlayMark?.end(overlayHidden, overlayHidden ? undefined : "failed");
		} catch {
			overlayMark?.end(false, "failed");
		}
		if (runId !== this.#runId || cancellable.is_cancelled()) return;
		if (overlayHidden === false) {
			this.#finishWorkflow(false, "overlay-failed");
			this.#failureMessage = "The drawing overlay could not be removed safely.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		let result: Awaited<ReturnType<AiPointerNativeAdapter["capture"]["create"]>>;
		const captureMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.capture)
			: null;
		try {
			result = await this.#adapter.capture.create(
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
			this.#failureMessage = "The selected region could not be captured.";
			this.#actor?.send({ type: "FAIL" });
			return;
		}

		if (runId !== this.#runId) {
			if (result.kind === "captured") this.#releaseCapture(result.capture.path);
			return;
		}
		this.#pendingCapturePath = null;
		if (cancellable.is_cancelled() || result.kind === "cancelled") {
			this.#finishWorkflow(false, "cancelled");
			this.#actor?.send({ type: "CANCEL" });
			return;
		}
		if (result.kind === "failed") {
			this.#finishWorkflow(false, "capture-failed");
			this.#failureMessage = result.message;
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		this.#capture = result.capture;
		this.#preparingGeometry = null;
		this.#actor?.send({ type: "CAPTURED" });
	}

	cancel(): void {
		this.#setCursorOutlineState(false);
		this.#runId += 1;
		this.#finishWorkflow(false, "cancelled");
		this.#stopOcr();
		this.#lockMonitor.stop();
		this.#operations.cancelAll();
		this.#preflightPromise = null;
		this.#directory = null;
		this.#stroke = null;
		this.#selectionContext = null;
		this.#answer = "";
		this.#answerTruncated = false;
		this.#preparingGeometry = null;
		this.#view.endStroke();
		this.#clearPendingFinish();
		if (this.#capture) this.#releaseCapture(this.#capture.path);
		this.#capture = null;
		this.#actor?.send({ type: "CANCEL" });
	}

	teardown(force = false): void {
		const pendingCapturePath = this.#pendingCapturePath;
		this.cancel();
		if (force) this.#operations.settleForShutdown();
		if (force && pendingCapturePath) this.#releaseCapture(pendingCapturePath);
		this.#setCursorOutlineState(false, true);
		this.#subscription?.unsubscribe();
		this.#subscription = null;
		this.#actor?.stop();
		this.#actor = null;
		this.#view.dispose();
		this.#disconnectShutdown?.();
		this.#disconnectShutdown = null;
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
		const preflight = this.#preflightPromise;
		if (!preflight) return;
		const operation = this.#operations.start("answer");
		const { cancellable } = operation;
		this.#stopOcr();
		this.#setCursorOutlineState(false);
		this.#actor?.send({ type: "SUBMIT" });
		void (async () => {
			const readiness = await preflight;
			if (runId !== this.#runId || cancellable.is_cancelled())
				return { kind: "cancelled" } as const;
			if (readiness.kind === "failed") return readiness;
			return await this.#adapter.assistant.requestAnswer(
				{
					requestId: `ai-pointer-${runId}`,
					prompt: formatDesktopPointerRequest(prompt, context),
					attachment: { path: capture.path, sha256: capture.sha256 },
					timeoutSeconds: 60,
				},
				cancellable,
				operation.observeProcess,
				(text) => {
					if (runId !== this.#runId || cancellable.is_cancelled()) return;
					if (this.#lockMonitor.blocksWorkflow) {
						this.cancel();
						return;
					}
					this.#view.showPartialAnswer?.(text);
				},
			);
		})().then((result) => {
			if (runId !== this.#runId || cancellable.is_cancelled()) return;
			this.#releaseCapture(capture.path);
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
			this.#releaseCapture(capture.path);
			if (this.#capture?.path === capture.path) this.#capture = null;
			this.#failureMessage = "The answer helper did not complete.";
			this.#actor?.send({ type: "FAIL" });
		}).finally(operation.complete);
	}

	#scheduleOcr(capture: Capture, dimensions: CaptureDimensions): void {
		this.#stopOcr();
		const runId = this.#runId;
		this.#ocrStartId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this.#ocrStartId = 0;
			if (runId === this.#runId) this.#startOcr(capture, dimensions);
			return GLib.SOURCE_REMOVE;
		});
	}

	#startOcr(capture: Capture, dimensions: CaptureDimensions): void {
		const runId = this.#runId;
		const operation = this.#operations.start("ocr");
		const { cancellable } = operation;
		this.#view.setOcrState({ kind: "pending" });
		const ocrMark = perf.isEnabled()
			? perf.start("ai-pointer", aiPointerPerformanceMetrics.ocrCompletion)
			: null;
		const workflowMark = this.#workflowMark;
		void this.#adapter.assistant.recognizeOcr(
			{ path: capture.path, ...dimensions },
			cancellable,
			operation.observeProcess,
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
			operation.complete();
			ocrMark?.end(false, "failed");
			workflowMark?.end(false, "failed");
			if (this.#workflowMark === workflowMark) this.#workflowMark = null;
		});
	}

	#stopOcr(): void {
		if (this.#ocrStartId !== 0) GLib.source_remove(this.#ocrStartId);
		this.#ocrStartId = 0;
		this.#operations.cancel("ocr");
		this.#view.clearOcr();
	}

	#finishWorkflow(ok: boolean, reason?: string): void {
		this.#workflowMark?.end(ok, reason);
		this.#workflowMark = null;
	}

	#releaseCapture(path: string): void {
		try {
			this.#adapter.capture.remove(path);
		} catch {
			// Capture cleanup is best effort and must not block workflow settlement.
		}
	}

	#setCursorOutlineState(enabled: boolean, force = false): void {
		if (force === false && this.#cursorOutlineState === enabled) return;
		try {
			this.#cursorOutlineState = this.#adapter.desktop.setCursorOutline(enabled) === false ? null : enabled;
		} catch { // Cursor decoration is advisory and must not interrupt capture.
			this.#cursorOutlineState = null;
		}
	}

	#sampleStroke(): void {
		const snapshot = this.#actor?.getSnapshot();
		if (snapshot?.matches("selecting") !== true) return;
		const point = this.#adapter.desktop.readPointer();
		if (!point || !this.#stroke) return;
		this.#stroke = appendStrokePoint(this.#stroke, point);
		this.#view.updateStroke(this.#stroke);
	}

}
