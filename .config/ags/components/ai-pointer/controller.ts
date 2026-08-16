import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import GLib from "gi://GLib?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import { queryHyprlandJson } from "@/services/hyprland-ipc";
import { resolveAccessibleSelection } from "./accessibility";
import type {
	AccessibilityMetadata,
	AccessibilityResolution,
} from "./accessibility-policy";
import { captureRegion, deleteCapture, prepareCaptureDirectory, type Capture } from "./capture";
import { aiPointerMachine } from "./machine";
import { AiPointerView } from "./ai-pointer-view";
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
	resolveAccessibility?(
		geometry: SelectionGeometry,
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<AccessibilityResolution | null>;
}

export class AiPointerController {
	readonly #view: AiPointerView;
	readonly #captureRegion: NonNullable<AiPointerControllerOptions["capture"]>;
	readonly #prepareDirectory: NonNullable<AiPointerControllerOptions["prepareDirectory"]>;
	readonly #readPointer: NonNullable<AiPointerControllerOptions["readPointer"]>;
	readonly #resolveAccessibility: NonNullable<AiPointerControllerOptions["resolveAccessibility"]>;
	#actor: AiPointerActor | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#cancellable: Gio.Cancellable | null = null;
	#process: Gio.Subprocess | null = null;
	#capture: Capture | null = null;
	#accessibilityMetadata: AccessibilityMetadata | null = null;
	#directory: string | null = null;
	#pendingFinish: PointerPosition | null = null;
	#pendingFinishId = 0;
	#stroke: PointerStroke | null = null;
	#failureMessage = "";
	#runId = 0;

	constructor(options: AiPointerControllerOptions = {}) {
		this.#view = options.view ?? new AiPointerView();
		this.#captureRegion = options.capture ?? captureRegion;
		this.#prepareDirectory = options.prepareDirectory ?? prepareCaptureDirectory;
		this.#resolveAccessibility = options.resolveAccessibility ?? resolveAccessibleSelection;
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

	init(): void {
		if (!this.#actor) {
			this.#view.create({ onCancel: () => this.cancel() });
			this.#actor = createActor(aiPointerMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.matches("preview") && this.#capture) {
					if (this.#view.showCapture(this.#capture, this.#accessibilityMetadata) === false) {
						this.#failureMessage = "The captured image could not be previewed.";
						deleteCapture(this.#capture.path);
						this.#capture = null;
						this.#actor?.send({ type: "FAIL" });
					}
					return;
				}
				if (snapshot.matches("failed")) {
					this.#view.showError(this.#failureMessage);
					return;
				}
				if (snapshot.hasTag("surface-visible") === false) this.#view.hide();
			});
			this.#actor.start();
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
		++this.#runId;
		this.#actor?.send({ type: "START" });
		if (this.#view.beginStroke(this.#stroke, () => this.#sampleStroke()) === false) {
			this.#failureMessage = "The drawing overlay is unavailable.";
			this.#actor?.send({ type: "FAIL" });
			return true;
		}
		if (this.#pendingFinish) {
			const endPosition = this.#pendingFinish;
			this.#clearPendingFinish();
			this.#captureAt(endPosition);
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
		const geometry = selectionFromStroke(this.#stroke);
		if (!geometry) {
			this.#view.endStroke();
			this.cancel();
			return;
		}
		const runId = this.#runId;
		void this.#view.finishStroke().then((hidden) => {
			if (runId !== this.#runId) return;
			if (hidden === false) {
				this.#failureMessage = "The drawing overlay could not be removed safely.";
				this.#actor?.send({ type: "FAIL" });
				return;
			}
			this.#captureGeometry(directory, geometry, runId);
		}).catch(() => {
			if (runId !== this.#runId) return;
			this.#failureMessage = "The drawing overlay could not be removed safely.";
			this.#actor?.send({ type: "FAIL" });
		});
	}

	#captureGeometry(directory: string, geometry: SelectionGeometry, runId: number): void {
		const cancellable = new Gio.Cancellable();
		this.#cancellable = cancellable;
		void this.#resolveAndCapture(directory, geometry, runId, cancellable);
	}

	async #resolveAndCapture(
		directory: string,
		strokeGeometry: SelectionGeometry,
		runId: number,
		cancellable: Gio.Cancellable,
	): Promise<void> {
		const observeProcess = (process: Gio.Subprocess | null) => {
			if (runId === this.#runId) this.#process = process;
		};
		let resolution: AccessibilityResolution | null = null;
		try {
			resolution = await this.#resolveAccessibility(
				strokeGeometry,
				cancellable,
				observeProcess,
			);
		} catch {
			// Accessibility is advisory; stroke geometry remains the safe fallback.
		}
		if (runId !== this.#runId || cancellable.is_cancelled()) return;

		this.#accessibilityMetadata = resolution?.metadata ?? null;
		let result: Awaited<ReturnType<typeof captureRegion>>;
		try {
			result = await this.#captureRegion(
				directory,
				resolution?.geometry ?? strokeGeometry,
				cancellable,
				observeProcess,
			);
		} catch {
			if (runId !== this.#runId) return;
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
			this.#actor?.send({ type: "CANCEL" });
			return;
		}
		if (result.kind === "failed") {
			this.#failureMessage = result.message;
			this.#actor?.send({ type: "FAIL" });
			return;
		}
		this.#capture = result.capture;
		this.#actor?.send({ type: "CAPTURED" });
	}

	cancel(): void {
		this.#runId += 1;
		this.#cancellable?.cancel();
		this.#cancellable = null;
		this.#process?.force_exit();
		this.#process = null;
		this.#directory = null;
		this.#stroke = null;
		this.#accessibilityMetadata = null;
		this.#view.endStroke();
		this.#clearPendingFinish();
		if (this.#capture) deleteCapture(this.#capture.path);
		this.#capture = null;
		this.#actor?.send({ type: "CANCEL" });
	}

	teardown(): void {
		this.cancel();
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

	#sampleStroke(): void {
		if (this.#actor?.getSnapshot().matches("selecting") === false) return;
		const point = this.#readPointer();
		if (!point || !this.#stroke) return;
		this.#stroke = appendStrokePoint(this.#stroke, point);
		this.#view.updateStroke(this.#stroke);
	}
}
