import type { IconRef } from "../../services/app-icons";

export type AudioMixerTab = "playback" | "output" | "input";
export type BackendStatus = "loading" | "ready" | "unavailable" | "error";
export type RowKind = "stream" | "endpoint" | "device";

export interface AudioRow {
	id: string;
	name: string;
	icon: string;
	iconRef?: IconRef | null;
	kind: RowKind;
	tab: AudioMixerTab;
	object: any;
	volume?: number;
	muted?: boolean;
	isDefault?: boolean;
}

export interface AudioSnapshot {
	status: BackendStatus;
	message: string;
	rows: Record<AudioMixerTab, AudioRow[]>;
}

export interface AudioBackend {
	init(): void;
	refresh(): void;
	stop(): void;
	setVolume(row: AudioRow, volume: number): void;
	toggleMute(row: AudioRow): void;
	setDefault(row: AudioRow): void;
}

export const tabs: Array<{ id: AudioMixerTab; label: string; icon: string }> = [
	{ id: "playback", label: "Playback", icon: "\uE768" },
	{ id: "output", label: "Output", icon: "\uE995" },
	{ id: "input", label: "Input", icon: "\uE720" },
];

export const maxVolume = 150;
export const meterSegments = 12;
const volumeLevelIcons = [
	"\uE992",
	"\uE993",
	"\uE994",
	"\uE994",
	"\uE995",
	"\uE995",
];

export function emptyRows(): Record<AudioMixerTab, AudioRow[]> {
	return { playback: [], output: [], input: [] };
}

export function emptySnapshot(
	message: string,
	status: BackendStatus,
): AudioSnapshot {
	return { status, message, rows: emptyRows() };
}

export function clamp(value: number, max = maxVolume): number {
	return Math.max(0, Math.min(max, Math.round(value)));
}

export function clampFloat(value: number, max = maxVolume): number {
	return Math.max(0, Math.min(max, value));
}

function asArray<T>(value: unknown): T[] {
	if (!value) return [];
	if (Array.isArray(value)) return value as T[];
	try {
		const list = value as {
			get_n_items?: () => number;
			get_item?: (index: number) => T;
			length?: unknown;
		};
		if (
			typeof list.get_n_items === "function" &&
			typeof list.get_item === "function"
		)
			return Array.from({ length: list.get_n_items() }, (_, index) =>
				list.get_item?.(index),
			).filter((item): item is T => item !== undefined);
		const length = Number(list.length ?? 0);
		if (Number.isFinite(length) && length > 0)
			return Array.from(
				{ length },
				(_, index) => (value as Record<number, T>)[index],
			);
	} catch {
		// GIR containers do not all expose a compatible list API.
	}
	return [];
}

export function getText(object: any, keys: string[]): string | undefined {
	for (const key of keys)
		try {
			const getter = object?.[`get_${key}`];
			const value =
				typeof getter === "function"
					? getter.call(object)
					: (object?.[key] ?? object?.get_property?.(key));
			if (typeof value === "string" && value.trim()) return value.trim();
		} catch {
			/* Probe optional GIR fields. */
		}
	return undefined;
}

export function getBoolean(object: any, keys: string[]): boolean | undefined {
	for (const key of keys)
		try {
			const getter = object?.[`get_${key}`];
			const value =
				typeof getter === "function" ? getter.call(object) : object?.[key];
			if (typeof value === "boolean") return value;
		} catch {
			/* Probe optional GIR fields. */
		}
	return undefined;
}

export function getNumber(object: any, keys: string[]): number | undefined {
	for (const key of keys)
		try {
			const getter = object?.[`get_${key}`];
			const value =
				typeof getter === "function"
					? getter.call(object)
					: (object?.[key] ?? object?.get_property?.(key));
			const number =
				typeof value === "number"
					? value
					: typeof value === "string" && value.trim()
						? Number(value)
						: Number.NaN;
			if (Number.isFinite(number)) return number;
		} catch {
			/* Probe optional GIR fields. */
		}
	return undefined;
}

export function getList<T>(object: any, keys: string[]): T[] {
	for (const key of keys)
		try {
			const getter = object?.[`get_${key}`];
			const list = asArray<T>(
				typeof getter === "function" ? getter.call(object) : object?.[key],
			);
			if (list.length) return list;
		} catch {
			/* Probe optional GIR lists. */
		}
	return [];
}

export function objectId(object: any, fallback: string): string {
	const numeric = getNumber(object, ["serial", "id"]);
	return numeric === undefined
		? (getText(object, ["serial", "id", "name", "description"]) ?? fallback)
		: String(Math.round(numeric));
}

export function sameAudioObject(a: any, b: any): boolean {
	if (!a || !b) return false;
	return (
		a === b || (objectId(a, "") !== "" && objectId(a, "") === objectId(b, ""))
	);
}

export function displayName(object: any, fallback: string): string {
	return (
		getText(object, [
			"description",
			"name",
			"nick",
			"media_name",
			"application_name",
		]) ?? fallback
	);
}

export function readVolume(object: any): number | undefined {
	const volume = getNumber(object, ["volume"]);
	return volume === undefined
		? undefined
		: clamp(volume <= 2 ? volume * 100 : volume);
}

export function volumeLevelIcon(
	volume: number | undefined,
	muted: boolean | undefined,
): string {
	if (muted) return "\uE74F";
	const level = Math.max(0, Math.min(100, volume ?? 0));
	return volumeLevelIcons[
		Math.min(
			volumeLevelIcons.length - 1,
			Math.floor((level / 101) * volumeLevelIcons.length),
		)
	];
}
