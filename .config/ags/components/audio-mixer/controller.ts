import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import { createPreparationIntentClaims } from "@/services/preparation-intent";
import { createAudioBackend } from "./audio-backend";
import { AudioMixerView, type AudioMixerViewActions } from "./audio-mixer-view";
import {
	emptySnapshot,
	type AudioBackend,
	type AudioMixerTab,
	type AudioSnapshot,
} from "./model";
import type { AudioMixerPreparationSource } from "./request";

export interface AudioMixerControllerOptions {
	createBackend?: (
		applySnapshot: (snapshot: AudioSnapshot) => void,
	) => AudioBackend;
	createView?: (
		actions: AudioMixerViewActions,
		snapshot: AudioSnapshot,
	) => AudioMixerView;
	signalWaybar?: () => void;
}

export class AudioMixerController {
	#visible = false;
	#initialized = false;
	#backendStarted = false;
	#backendReady = false;
	#showPending = false;
	#shutdownSignalId = 0;
	#waybarSource = 0;
	#snapshot = emptySnapshot("Audio backend unavailable", "unavailable");
	#backend: AudioBackend;
	#view: AudioMixerView;
	readonly #preparationClaims =
		createPreparationIntentClaims<AudioMixerPreparationSource>();
	readonly #signalWaybar: () => void;

	constructor(options: AudioMixerControllerOptions = {}) {
		this.#signalWaybar =
			options.signalWaybar ??
			(() =>
				GLib.spawn_command_line_async(
					"pkill -SIGUSR1 -f '(^|/)waybar( |$)'",
				));
		const createBackend = options.createBackend ?? createAudioBackend;
		this.#backend = createBackend((snapshot) => {
			this.#snapshot = snapshot;
			this.#view.setSnapshot(snapshot);
			if (snapshot.status === "loading") return;
			this.#backendReady = true;
			if (this.#visible === false) {
				this.#preparationClaims.clear();
				this.#backend.setActive(false);
				return;
			}
			if (this.#showPending === false) return;
			this.#showPending = false;
			this.#view.show();
			this.#scheduleWaybarSignal();
		});
		this.#view = (
			options.createView ??
			((actions, snapshot) => new AudioMixerView(actions, snapshot))
		)(
			{
				onHide: () => this.hide(),
				isVisible: () => this.isVisible(),
				onSetVolume: (row, volume) => this.#backend.setVolume(row, volume),
				onToggleMute: (row) => this.#backend.toggleMute(row),
				onSetDefault: (row) => this.#setDefault(row),
			},
			this.#snapshot,
		);
	}

	init(): void {
		if (this.#initialized) return;
		this.#initialized = true;
		if (this.#shutdownSignalId === 0)
			this.#shutdownSignalId = app.connect("shutdown", () => this.teardown());
	}

	teardown(): void {
		if (this.#initialized === false) return;
		this.#initialized = false;
		this.#visible = false;
		this.#showPending = false;
		this.#preparationClaims.clear();
		this.#cancelWaybarSignal();
		if (this.#backendStarted) this.#backend.stop();
		this.#backendStarted = false;
		this.#backendReady = false;
		this.#view.dispose();
		if (this.#shutdownSignalId !== 0) {
			app.disconnect(this.#shutdownSignalId);
			this.#shutdownSignalId = 0;
		}
	}

	isVisible(): boolean {
		return this.#visible;
	}
	show(): void {
		this.#preparationClaims.clear();
		this.#visible = true;
		this.#backend.setActive(true);
		if (this.#backendReady) {
			this.#view.show();
			this.#backend.refresh();
			this.#scheduleWaybarSignal();
			return;
		}
		this.#showPending = true;
		this.#startBackend();
	}
	prepare(source: AudioMixerPreparationSource, sequence?: number): void {
		if (this.#preparationClaims.claim(source, sequence) === false) return;
		if (this.#visible) {
			this.#preparationClaims.clear();
			return;
		}
		this.#backend.setActive(true);
		this.#startBackend();
	}
	release(source: AudioMixerPreparationSource, sequence?: number): void {
		if (
			this.#preparationClaims.release(source, sequence) === false ||
			this.#visible
		)
			return;
		this.#backend.setActive(false);
	}
	hide(): void {
		this.#showPending = false;
		this.#cancelWaybarSignal();
		this.#view.hide();
		this.#visible = false;
		if (this.#preparationClaims.hasClaims() === false)
			this.#backend.setActive(false);
	}
	toggle(): string {
		if (this.#visible) this.hide();
		else this.show();
		return this.#visible ? "shown" : "hidden";
	}
	setTab(tab: AudioMixerTab): void {
		this.#view.setTab(tab);
	}

	#startBackend(): void {
		if (this.#backendStarted) return;
		this.#backendStarted = true;
		this.#backend.init();
	}

	#setDefault(row: AudioSnapshot["rows"][AudioMixerTab][number]): void {
		if (row.tab === "playback") return;
		for (const endpoint of this.#snapshot.rows[row.tab])
			endpoint.isDefault = endpoint.id === row.id;
		this.#backend.setDefault(row);
		this.#view.setSnapshot(this.#snapshot);
	}

	#scheduleWaybarSignal(): void {
		if (this.#waybarSource !== 0) return;
		this.#waybarSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this.#waybarSource = 0;
			if (this.#visible === false) return GLib.SOURCE_REMOVE;
			try {
				this.#signalWaybar();
			} catch (cause) {
				console.error("Failed to show waybar:", cause);
			}
			return GLib.SOURCE_REMOVE;
		});
	}

	#cancelWaybarSignal(): void {
		if (this.#waybarSource === 0) return;
		GLib.source_remove(this.#waybarSource);
		this.#waybarSource = 0;
	}
}
