import { isMatching, P } from "ts-pattern";

const updateCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const flakeUpdatePattern = {
	name: P.string,
	currentRev: P.string,
	currentShort: P.string,
	newRev: P.string,
	newShort: P.string,
};
const flatpakUpdatePattern = {
	app: P.string,
	currentVersion: P.string,
	newVersion: P.string,
	branch: P.string,
};

export type FlakeUpdate = P.infer<typeof flakeUpdatePattern>;
export type FlatpakUpdate = P.infer<typeof flatpakUpdatePattern>;

const isFlakeUpdate = (value: unknown): value is FlakeUpdate =>
	isMatching(flakeUpdatePattern, value);
const isFlatpakUpdate = (value: unknown): value is FlatpakUpdate =>
	isMatching(flatpakUpdatePattern, value);

export interface UpdatesData<T> {
	count: number;
	updates: T[];
	timestamp: string;
}

export interface UpdatesSnapshot {
	flake: UpdatesData<FlakeUpdate> | null;
	flatpak: UpdatesData<FlatpakUpdate> | null;
}

export function parseFlakeUpdates(
	value: unknown,
	now = Date.now(),
): UpdatesData<FlakeUpdate> | null {
	return parseUpdates(value, isFlakeUpdate, now);
}

export function parseFlatpakUpdates(
	value: unknown,
	now = Date.now(),
): UpdatesData<FlatpakUpdate> | null {
	return parseUpdates(value, isFlatpakUpdate, now);
}

export function formatTimeSince(timestamp: string, now = Date.now()): string {
	const checkedAt = Date.parse(timestamp);
	if (!Number.isFinite(checkedAt)) return "";
	const minutes = Math.floor((now - checkedAt) / 60_000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) {
		const remainingHours = hours % 24;
		return remainingHours > 0
			? `${days} day${days === 1 ? "" : "s"} and ${remainingHours} hour${remainingHours === 1 ? "" : "s"} ago`
			: `${days} day${days === 1 ? "" : "s"} ago`;
	}
	if (hours > 0) {
		const remainingMinutes = minutes % 60;
		return remainingMinutes > 0
			? `${hours} hour${hours === 1 ? "" : "s"} and ${remainingMinutes} minute${remainingMinutes === 1 ? "" : "s"} ago`
			: `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	if (minutes > 0) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	return "just now";
}

function parseUpdates<T>(
	value: unknown,
	isUpdate: (value: unknown) => value is T,
	now: number,
): UpdatesData<T> | null {
	const pattern = {
		count: P.number.int().gte(0),
		updates: P.array(P.unknown),
		timestamp: P.string,
	};
	if (!isMatching(pattern, value)) return null;
	const updates = value.updates;
	if (!updates.every(isUpdate)) return null;
	const checkedAt = Date.parse(value.timestamp);
	if (!Number.isFinite(checkedAt)) return null;
	const age = now - checkedAt;
	return age >= 0 && age <= updateCacheMaxAgeMs
		? { count: value.count, updates, timestamp: value.timestamp }
		: null;
}
