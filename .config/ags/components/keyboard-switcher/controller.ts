import app from "ags/gtk4/app";
import { createActor, type ActorRefFrom, type Clock } from "xstate";
import { perf } from "../../services/performance-monitor";
import { KeyboardSwitcherView } from "./keyboard-switcher-view";
import {
	keyboardSwitcherMachine,
	type KeyboardSwitcherEvent,
} from "./machine";
import type { LayoutSwitchConfig } from "./model";

type KeyboardSwitcherActor = ActorRefFrom<typeof keyboardSwitcherMachine>;

interface KeyboardSwitcherControllerOptions {
	createView?(): KeyboardSwitcherView;
	clock?: Clock;
}

export class KeyboardSwitcherController {
	readonly #view: KeyboardSwitcherView;
	readonly #clock: Clock | undefined;
	#actor: KeyboardSwitcherActor | null = null;
	#actorSubscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#suppressViewSync = false;

	constructor(options: KeyboardSwitcherControllerOptions = {}) {
		this.#view = options.createView?.() ?? new KeyboardSwitcherView();
		this.#clock = options.clock;
	}

	init(): void {
		if (!this.#actor) {
			this.#actor = this.#clock
				? createActor(keyboardSwitcherMachine, { clock: this.#clock })
				: createActor(keyboardSwitcherMachine);
			this.#actorSubscription = this.#actor.subscribe((snapshot) => {
				if (this.#suppressViewSync) return;
				try {
					if (snapshot.matches("hiding")) {
						this.#view.beginHide();
						return;
					}
					if (snapshot.matches("hidden")) this.#view.hide();
				} catch (error) {
					console.error("Failed to update Keyboard Switcher view:", error);
					this.#sendWithoutViewSync({ type: "FAIL" });
					try {
						this.#view.hide();
					} catch {
						try {
							this.#view.dispose();
						} catch (disposeError) {
							console.error(
								"Failed to dispose Keyboard Switcher view after recovery:",
								disposeError,
							);
						}
					}
				}
			});
			this.#actor.start();
		}
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	teardown(): void {
		try {
			this.#actorSubscription?.unsubscribe();
			this.#actorSubscription = null;
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

	show(config: LayoutSwitchConfig): void {
		const mark = perf.start("keyboard-switcher", "showSwitcher");
		let ok = true;
		let error: string | undefined;
		try {
			this.#sendWithoutViewSync({ type: "SHOW", config });
			try {
				this.#view.show(config);
			} catch (cause) {
				this.#sendWithoutViewSync({ type: "FAIL" });
				try {
					this.#view.hide();
				} catch {
					try {
						this.#view.dispose();
					} catch (disposeError) {
						console.error(
							"Failed to dispose Keyboard Switcher view after recovery:",
							disposeError,
						);
					}
				}
				throw cause;
			}
		} catch (cause) {
			this.#suppressViewSync = false;
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
		return this.#actor?.getSnapshot().hasTag("switcher-visible") === true;
	}

	get actor(): KeyboardSwitcherActor {
		if (!this.#actor)
			throw new Error("Keyboard Switcher has not been initialized");
		return this.#actor;
	}

	#sendWithoutViewSync(event: KeyboardSwitcherEvent): void {
		this.#suppressViewSync = true;
		try {
			this.actor.send(event);
		} finally {
			this.#suppressViewSync = false;
		}
	}
}
