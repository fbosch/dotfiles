import app from "ags/gtk4/app";
import GLib from "gi://GLib?version=2.0";
import { createAudioBackend } from "./audio-backend";
import { AudioMixerView, type AudioMixerViewActions } from "./audio-mixer-view";
import {
	emptySnapshot,
	type AudioBackend,
	type AudioMixerTab,
	type AudioSnapshot,
} from "./model";
import { applyAudioMixerStyles } from "./styles";

export interface AudioMixerControllerOptions {
	createBackend?: (
		applySnapshot: (snapshot: AudioSnapshot) => void,
	) => AudioBackend;
	createView?: (
		actions: AudioMixerViewActions,
		snapshot: AudioSnapshot,
	) => AudioMixerView;
}

export class AudioMixerController {
	#visible = false;
	#lastToggleAtMs = 0;
	#initialized = false;
	#shutdownConnected = false;
	#snapshot = emptySnapshot("Audio backend unavailable", "unavailable");
	#backend: AudioBackend;
	#view: AudioMixerView;

	constructor(options: AudioMixerControllerOptions = {}) {
		const createBackend = options.createBackend ?? createAudioBackend;
		this.#backend = createBackend((snapshot) => {
			this.#snapshot = snapshot;
			this.#view.setSnapshot(snapshot);
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
		if (this.#shutdownConnected === false) {
			this.#shutdownConnected = true;
			app.connect("shutdown", () => this.teardown());
		}
		applyAudioMixerStyles();
		this.#backend.init();
	}

	teardown(): void {
		if (this.#initialized === false) return;
		this.#initialized = false;
		this.#visible = false;
		this.#backend.stop();
		this.#view.dispose();
	}

	isVisible(): boolean {
		return this.#visible;
	}
	show(): void {
		this.#view.show();
		this.#visible = true;
		this.#backend.refresh();
		try {
			GLib.spawn_command_line_async("pkill -SIGUSR1 -f '(^|/)waybar( |$)'");
		} catch (cause) {
			console.error("Failed to show waybar:", cause);
		}
	}
	hide(): void {
		this.#view.hide();
		this.#visible = false;
	}
	toggle(): string {
		const now = GLib.get_monotonic_time() / 1000;
		if (now - this.#lastToggleAtMs < 300)
			return this.#visible ? "shown" : "hidden";
		this.#lastToggleAtMs = now;
		if (this.#visible) this.hide();
		else this.show();
		return this.#visible ? "shown" : "hidden";
	}
	setTab(tab: AudioMixerTab): void {
		this.#view.setTab(tab);
	}

	#setDefault(row: AudioSnapshot["rows"][AudioMixerTab][number]): void {
		if (row.tab === "playback") return;
		for (const endpoint of this.#snapshot.rows[row.tab])
			endpoint.isDefault = endpoint.id === row.id;
		this.#backend.setDefault(row);
		this.#view.setSnapshot(this.#snapshot);
	}
}
