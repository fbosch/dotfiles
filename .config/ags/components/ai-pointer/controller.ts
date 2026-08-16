import app from "ags/gtk4/app";
import Gio from "gi://Gio?version=2.0";
import { createActor, type ActorRefFrom } from "xstate";
import { captureSelection, deleteCapture, prepareCaptureDirectory, type Capture } from "./capture";
import { aiPointerMachine } from "./machine";
import { AiPointerView } from "./ai-pointer-view";

type AiPointerActor = ActorRefFrom<typeof aiPointerMachine>;

interface AiPointerControllerOptions {
	view?: AiPointerView;
	capture?(
		directory: string,
		cancellable: Gio.Cancellable,
		onProcess: (process: Gio.Subprocess | null) => void,
	): Promise<Awaited<ReturnType<typeof captureSelection>>>;
	prepareDirectory?(): string | null;
}

export class AiPointerController {
	readonly #view: AiPointerView;
	readonly #captureSelection: NonNullable<AiPointerControllerOptions["capture"]>;
	readonly #prepareDirectory: NonNullable<AiPointerControllerOptions["prepareDirectory"]>;
	#actor: AiPointerActor | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#cancellable: Gio.Cancellable | null = null;
	#process: Gio.Subprocess | null = null;
	#capture: Capture | null = null;
	#failureMessage = "";
	#runId = 0;

	constructor(options: AiPointerControllerOptions = {}) {
		this.#view = options.view ?? new AiPointerView();
		this.#captureSelection = options.capture ?? captureSelection;
		this.#prepareDirectory = options.prepareDirectory ?? prepareCaptureDirectory;
	}

	init(): void {
		if (!this.#actor) {
			this.#view.create({ onCancel: () => this.cancel() });
			this.#actor = createActor(aiPointerMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.matches("preview") && this.#capture) {
					if (this.#view.showCapture(this.#capture) === false) {
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

	start(): boolean {
		if (this.#actor?.getSnapshot().matches("idle") === false) return false;

		const directory = this.#prepareDirectory();
		if (!directory) {
			this.#failureMessage = "Private runtime storage is unavailable.";
			this.#actor?.send({ type: "START" });
			this.#actor?.send({ type: "FAIL" });
			return true;
		}

		const cancellable = new Gio.Cancellable();
		this.#cancellable = cancellable;
		const runId = ++this.#runId;
		this.#actor?.send({ type: "START" });
		void this.#captureSelection(directory, cancellable, (process) => {
			if (runId === this.#runId) this.#process = process;
		}).then((result) => {
			if (runId !== this.#runId) {
				if (result.kind === "captured") deleteCapture(result.capture.path);
				return;
			}
			this.#cancellable = null;
			this.#process = null;
			if (cancellable.is_cancelled()) {
				this.#actor?.send({ type: "CANCEL" });
				return;
			}
			if (result.kind === "cancelled") {
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
		}).catch(() => {
			if (runId !== this.#runId) return;
			this.#cancellable = null;
			this.#process = null;
			this.#failureMessage = "The selected region could not be captured.";
			this.#actor?.send({ type: "FAIL" });
		});
		return true;
	}

	cancel(): void {
		this.#runId += 1;
		this.#cancellable?.cancel();
		this.#cancellable = null;
		this.#process?.force_exit();
		this.#process = null;
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
}
