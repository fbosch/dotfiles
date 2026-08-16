import app from "ags/gtk4/app";
import type Gio from "gi://Gio?version=2.0";
import { createActor, type ActorRefFrom, type Clock } from "xstate";
import { ConfirmDialogView } from "./confirm-dialog-view";
import { confirmDialogMachine } from "./machine";
import { executeConfirmOperation } from "./operation-executor";
import type { ConfirmConfig, ConfirmOperation } from "./request";
import { playConfirmWarningSound } from "./warning-sound";

type ConfirmDialogActor = ActorRefFrom<typeof confirmDialogMachine>;

interface ConfirmDialogControllerOptions {
	view?: ConfirmDialogView;
	execute?(operation: ConfirmOperation): boolean;
	playWarningSound?(): Gio.Subprocess | null;
	clock?: Clock;
}

export class ConfirmDialogController {
	readonly #view: ConfirmDialogView;
	readonly #execute: NonNullable<ConfirmDialogControllerOptions["execute"]>;
	readonly #playWarningSound: NonNullable<
		ConfirmDialogControllerOptions["playWarningSound"]
	>;
	readonly #clock: Clock | undefined;
	#actor: ConfirmDialogActor | null = null;
	#subscription: { unsubscribe(): void } | null = null;
	#shutdownSignalId = 0;
	#config: ConfirmConfig | null = null;
	#soundProcess: Gio.Subprocess | null = null;

	constructor(options: ConfirmDialogControllerOptions = {}) {
		this.#view = options.view ?? new ConfirmDialogView();
		this.#execute = options.execute ?? executeConfirmOperation;
		this.#playWarningSound =
			options.playWarningSound ?? playConfirmWarningSound;
		this.#clock = options.clock;
	}

	init(): void {
		if (!this.#actor) {
			this.#view.create({
				onCancel: () => this.hide(),
				onConfirm: () => this.#confirm(),
			});
			this.#actor = this.#clock
				? createActor(confirmDialogMachine, { clock: this.#clock })
				: createActor(confirmDialogMachine);
			this.#subscription = this.#actor.subscribe((snapshot) => {
				if (snapshot.hasTag("dialog-visible")) this.#view.show();
				else this.#view.hide();
			});
			this.#actor.start();
		}
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	show(config: ConfirmConfig): void {
		if (this.#actor?.getSnapshot().hasTag("dialog-active")) return;
		this.#config = config;
		this.#view.setConfig(config);
		if (config.playWarningSound) {
			this.#soundProcess?.force_exit();
			this.#soundProcess = this.#playWarningSound();
		}
		this.#actor?.send({ type: "SHOW", delayMs: config.showDelay ?? 0 });
	}

	hide(): void {
		this.#actor?.send({ type: "HIDE" });
		this.#config = null;
	}

	teardown(): void {
		this.#soundProcess?.force_exit();
		this.#soundProcess = null;
		this.#subscription?.unsubscribe();
		this.#subscription = null;
		this.#actor?.stop();
		this.#actor = null;
		this.#config = null;
		this.#view.dispose();
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	#confirm(): void {
		const operation = this.#config?.operation;
		if (!operation) return;
		if (this.#execute(operation) === false) {
			this.#view.showOperationError();
			return;
		}
		this.hide();
	}
}
