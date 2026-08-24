import GLib from "gi://GLib?version=2.0";
import { perf } from "@/services/performance-monitor";
import {
	clamp,
	displayName,
	emptyRows,
	emptySnapshot,
	getBoolean,
	getList,
	objectId,
	readVolume,
	sameAudioObject,
	type AudioBackend,
	type AudioMixerTab,
	type AudioRow,
	type AudioSnapshot,
	type RowKind,
} from "./model";
import { resolveStreamIcon } from "./stream-metadata";

export function createAudioBackend(
	applySnapshot: (snapshot: AudioSnapshot) => void,
): AudioBackend {
	let modules: { AstalWp: any } | null = null;
	let audio: any | null = null;
	let signalConnections: Array<{ target: any; id: number }> = [];
	const nodeConnections = new Map<any, number[]>();
	let refreshSource = 0;
	let loadVersion = 0;
	let active = false;
	let pendingDefault: { tab: "output" | "input"; object: any } | null = null;
	const loadModules = async () =>
		(modules ??= { AstalWp: (await import("gi://AstalWp")).default });
	function row(
		object: any,
		kind: RowKind,
		tab: AudioMixerTab,
		fallback: string,
		icon: string,
		isDefault = false,
	): AudioRow {
		const stream =
			kind === "stream" ? resolveStreamIcon(object) : { icon: null };
		const displayIcon =
			kind === "endpoint" &&
			icon === "\uE995" &&
			/ora|kanto/.test(displayName(object, "").toLowerCase())
				? "\uE7F5"
				: icon;
		return {
			id: `${kind}:${objectId(object, fallback)}`,
			name:
				kind === "stream" && stream.title
					? stream.title
					: displayName(object, fallback),
			icon: displayIcon,
			iconRef: stream.icon,
			kind,
			tab,
			object,
			volume: readVolume(object),
			muted: getBoolean(object, ["mute", "muted"]),
			isDefault,
		};
	}
	function snapshot(): AudioSnapshot {
		const mark = perf.start("audio-mixer-widget", "buildSnapshot");
		let ok = true;
		let error: string | undefined;
		try {
			if (!audio)
				return emptySnapshot("AstalWP audio unavailable", "unavailable");
			const defaultFor = (tab: "output" | "input", backend: any) => {
				if (!pendingDefault || pendingDefault.tab !== tab) return backend;
				if (sameAudioObject(backend, pendingDefault.object))
					pendingDefault = null;
				return pendingDefault?.tab === tab ? pendingDefault.object : backend;
			};
			const compare = (a: any, b: any) =>
				displayName(a, "").localeCompare(displayName(b, "")) ||
				objectId(a, "").localeCompare(objectId(b, ""));
			const rows = emptyRows();
			const speaker = defaultFor(
				"output",
				audio.get_default_speaker?.() ?? audio.default_speaker,
			);
			const microphone = defaultFor(
				"input",
				audio.get_default_microphone?.() ?? audio.default_microphone,
			);
			rows.playback = [...getList<any>(audio, ["streams"])]
				.sort(compare)
				.map((value, index) =>
					row(value, "stream", "playback", `Playback ${index + 1}`, "\uE768"),
				);
			rows.output = [...getList<any>(audio, ["speakers"])]
				.sort(compare)
				.map((value, index) =>
					row(
						value,
						"endpoint",
						"output",
						`Output ${index + 1}`,
						"\uE995",
						sameAudioObject(value, speaker),
					),
				);
			rows.input = [...getList<any>(audio, ["microphones"])]
				.sort(compare)
				.map((value, index) =>
					row(
						value,
						"endpoint",
						"input",
						`Input ${index + 1}`,
						"\uE720",
						sameAudioObject(value, microphone),
					),
				);
			reconcileNodeSignals([
				...rows.playback,
				...rows.output,
				...rows.input,
			]);
			return { status: "ready", message: "", rows };
		} catch (cause) {
			ok = false;
			error = String(cause);
			throw cause;
		} finally {
			mark.end(ok, error);
		}
	}
	function refresh(): void {
		if (active === false || refreshSource) return;
		refreshSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			refreshSource = 0;
			try {
				applySnapshot(snapshot());
			} catch (cause) {
				console.error("Failed to refresh audio mixer state:", cause);
				applySnapshot(emptySnapshot("Audio state unavailable", "error"));
			}
			return GLib.SOURCE_REMOVE;
		});
	}
	function connect(target: any): void {
		for (const signal of [
			"notify",
			"speaker-added",
			"speaker-removed",
			"microphone-added",
			"microphone-removed",
			"stream-added",
			"stream-removed",
			"recorder-added",
			"recorder-removed",
			"device-added",
			"device-removed",
		])
			try {
				if (target?.connect)
					signalConnections.push({
						target,
						id: target.connect(signal, refresh),
					});
			} catch {
				/* GIR signal availability varies. */
			}
	}
	function reconcileNodeSignals(rows: AudioRow[]): void {
		const current = new Set(rows.map((row) => row.object).filter(Boolean));
		for (const [target, ids] of nodeConnections) {
			if (current.has(target)) continue;
			for (const id of ids) disconnect(target, id);
			nodeConnections.delete(target);
		}
		for (const target of current) {
			if (nodeConnections.has(target) || typeof target.connect !== "function")
				continue;
			const ids: number[] = [];
			for (const signal of [
				"notify::volume",
				"notify::mute",
				"notify::description",
				"notify::name",
			])
				try {
					ids.push(target.connect(signal, refresh));
				} catch {
					// Generated GIR properties vary between AstalWp node types.
				}
			nodeConnections.set(target, ids);
		}
	}
	function disconnect(target: any, id: number): void {
		try {
			target.disconnect(id);
		} catch {
			// The backend may already have released the GObject.
		}
	}
	async function load(): Promise<void> {
		const version = ++loadVersion;
		try {
			applySnapshot(emptySnapshot("", "loading"));
			const { AstalWp } = await loadModules();
			if (version !== loadVersion) return;
			const wp = AstalWp?.get_default?.() ?? AstalWp?.Wp?.get_default?.();
			audio =
				wp?.audio ??
				wp?.get_audio?.() ??
				AstalWp?.Audio?.get_default?.() ??
				AstalWp?.Audio?.new?.();
			if (!audio) {
				applySnapshot(
					emptySnapshot("AstalWP audio unavailable", "unavailable"),
				);
				return;
			}
			connect(audio);
			if (active) applySnapshot(snapshot());
		} catch (cause) {
			if (version !== loadVersion) return;
			console.error("AstalWP audio backend unavailable:", cause);
			applySnapshot(emptySnapshot("AstalWP audio unavailable", "unavailable"));
		}
	}
	return {
		init: () => void load(),
		setActive: (value) => {
			active = value;
			if (active) {
				if (audio) refresh();
				return;
			}
			if (refreshSource === 0) return;
			GLib.source_remove(refreshSource);
			refreshSource = 0;
		},
		refresh: () => (audio ? refresh() : void load()),
		stop: () => {
			active = false;
			loadVersion += 1;
			if (refreshSource) {
				GLib.source_remove(refreshSource);
				refreshSource = 0;
			}
			for (const { target, id } of signalConnections) disconnect(target, id);
			signalConnections = [];
			for (const [target, ids] of nodeConnections)
				for (const id of ids) disconnect(target, id);
			nodeConnections.clear();
			audio = null;
			pendingDefault = null;
		},
		setVolume: (value, volume) => {
			value.volume = clamp(volume);
			const backendVolume = value.volume / 100;
			if (typeof value.object?.set_volume === "function")
				value.object.set_volume(backendVolume);
			else value.object.volume = backendVolume;
		},
		toggleMute: (value) => {
			const muted = !(
				value.muted ??
				getBoolean(value.object, ["mute", "muted"]) ??
				false
			);
			value.muted = muted;
			if (typeof value.object?.set_mute === "function")
				value.object.set_mute(muted);
			else if (typeof value.object?.set_muted === "function")
				value.object.set_muted(muted);
			else value.object.mute = muted;
		},
		setDefault: (value) => {
			if (value.tab !== "output" && value.tab !== "input") return;
			pendingDefault = { tab: value.tab, object: value.object };
			if (typeof value.object?.set_is_default === "function")
				value.object.set_is_default(true);
			else if (typeof value.object?.set_default === "function")
				value.object.set_default();
			refresh();
		},
	};
}
