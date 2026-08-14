import app from "ags/gtk4/app";
import { createActor, type ActorRefFrom, type Clock } from "xstate";
import { perf } from "../../services/performance-monitor";
import {
	volumeIndicatorMachine,
	type VolumeIndicatorEvent,
} from "./machine";
import {
	createVolumePresentation,
	shouldPlayVolumeSound,
	type VolumePresentation,
} from "./model";
import { applyVolumeIndicatorStyles } from "./styles";
import { VolumeIndicatorView } from "./volume-indicator-view";
import { VolumeSource } from "./volume-source";
import { playVolumeSound } from "./volume-sound";

type VolumeIndicatorActor = ActorRefFrom<typeof volumeIndicatorMachine>;

interface VolumeIndicatorControllerOptions {
	createView?(): VolumeIndicatorView;
	source?: VolumeSource;
	playSound?(): void;
	clock?: Clock;
}

export class VolumeIndicatorController {
	readonly #view: VolumeIndicatorView;
	readonly #source: VolumeSource;
	readonly #playSound: () => void;
	readonly #clock: Clock | undefined;
	#actor: VolumeIndicatorActor | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#suppressViewSync = false;
	#refreshRequested = false;
	#refreshTask: Promise<void> | null = null;
	#generation = 0;
	#presentation: VolumePresentation | null = null;

	constructor(options: VolumeIndicatorControllerOptions = {}) {
		this.#view = options.createView?.() ?? new VolumeIndicatorView();
		this.#source = options.source ?? new VolumeSource();
		this.#playSound = options.playSound ?? playVolumeSound;
		this.#clock = options.clock;
	}

	init(): void {
		this.#source.init();
		if (!this.#actor) {
			this.#generation += 1;
			this.#actor = this.#clock
				? createActor(volumeIndicatorMachine, { clock: this.#clock })
				: createActor(volumeIndicatorMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (this.#suppressViewSync) return;
				try {
					if (snapshot.matches("hiding")) {
						this.#view.beginHide();
						return;
					}
					if (snapshot.matches("hidden")) this.#view.hide();
				} catch (error) {
					console.error("Failed to update Volume Indicator view:", error);
					this.#sendWithoutViewSync({ type: "FAIL" });
					this.#recoverView();
				}
			});
			this.#actor.start();
		}
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
		applyVolumeIndicatorStyles();
	}

	teardown(): void {
		this.#generation += 1;
		this.#refreshRequested = false;
		this.#source.dispose();
		try {
			this.#subscription?.unsubscribe();
			this.#subscription = null;
			this.#actor?.stop();
			this.#actor = null;
		} finally {
			try {
				this.#view.dispose();
			} finally {
				if (this.#shutdownSignalId !== 0) {
					app.disconnect(this.#shutdownSignalId);
					this.#shutdownSignalId = 0;
				}
			}
		}
	}

	show(): void {
		const mark = perf.start("volume-indicator", "showIndicator");
		let ok = true;
		let error: string | undefined;
		try {
			this.#sendWithoutViewSync({ type: "SHOW" });
			try {
				this.#view.show();
			} catch (cause) {
				this.#sendWithoutViewSync({ type: "FAIL" });
				this.#recoverView();
				throw cause;
			}
			this.#requestRefresh();
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}

	hide(): void {
		if (!this.#actor || this.#actor.getSnapshot().matches("visible") === false)
			return;
		this.#sendWithoutViewSync({ type: "HIDE" });
		this.#view.beginHide();
	}

	isVisible(): boolean {
		return this.#actor?.getSnapshot().hasTag("indicator-visible") === true;
	}

	#requestRefresh(): void {
		this.#refreshRequested = true;
		if (this.#refreshTask) return;
		this.#refreshTask = this.#refresh().finally(() => {
			this.#refreshTask = null;
			if (this.#refreshRequested && this.#actor) this.#requestRefresh();
		});
	}

	async #refresh(): Promise<void> {
		const generation = this.#generation;
		while (this.#refreshRequested && this.#actor) {
			this.#refreshRequested = false;
			const actor = this.#actor;
			const mark = perf.start("volume-indicator", "update");
			let ok = true;
			let error: string | undefined;
			try {
				const next = createVolumePresentation(await this.#source.read());
				if (generation !== this.#generation || actor !== this.#actor) return;
				if (shouldPlayVolumeSound(this.#presentation, next)) this.#playSound();
				this.#view.setPresentation(next);
				this.#presentation = next;
			} catch (cause) {
				ok = false;
				error = String(cause);
				console.error("Failed to update Volume Indicator:", cause);
			} finally {
				mark.end(ok, error);
			}
		}
	}

	#recoverView(): void {
		try {
			this.#view.hide();
		} catch {
			try {
				this.#view.dispose();
			} catch (disposeError) {
				console.error(
					"Failed to dispose Volume Indicator view after recovery:",
					disposeError,
				);
			}
		}
	}

	#sendWithoutViewSync(event: VolumeIndicatorEvent): void {
		this.#suppressViewSync = true;
		try {
			if (!this.#actor)
				throw new Error("Volume Indicator has not been initialized");
			this.#actor.send(event);
		} finally {
			this.#suppressViewSync = false;
		}
	}
}
