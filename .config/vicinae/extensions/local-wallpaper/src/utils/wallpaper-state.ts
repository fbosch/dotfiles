import { Cache } from "@vicinae/api";
import type { FillMode } from "../types";

const cache = new Cache();
const CACHE_KEY = "local-wallpaper-state";

export type WallpaperConfig = {
	path: string;
	fillMode: FillMode;
};

export type WallpaperCollectionEntry = {
	monitor: string;
	path: string;
	fillMode: FillMode;
};

export type WallpaperCollection = {
	id: string;
	name: string;
	entries: WallpaperCollectionEntry[];
	createdAt: number;
	updatedAt: number;
};

type WallpaperState = {
	favorites: string[];
	collections: WallpaperCollection[];
};

const defaultState: WallpaperState = {
	favorites: [],
	collections: [],
};

function readState(): WallpaperState {
	const rawValue = cache.get(CACHE_KEY);
	if (rawValue === undefined) {
		return defaultState;
	}

	try {
		const parsed = JSON.parse(rawValue) as WallpaperState;
		const favorites = Array.isArray(parsed.favorites)
			? parsed.favorites.filter((path) => typeof path === "string")
			: [];
		const collections = Array.isArray(parsed.collections)
			? parsed.collections.filter((collection) => {
				return (
					typeof collection.id === "string" &&
					typeof collection.name === "string" &&
					Array.isArray(collection.entries)
				);
			})
			: [];

		return { favorites, collections };
	} catch {
		cache.remove(CACHE_KEY);
		return defaultState;
	}
}

function writeState(state: WallpaperState): void {
	cache.set(CACHE_KEY, JSON.stringify(state));
}

export function listFavorites(): string[] {
	return readState().favorites;
}

export function listCollections(): WallpaperCollection[] {
	return readState().collections;
}

export function toggleFavorite(path: string): boolean {
	const state = readState();
	const favoriteSet = new Set(state.favorites);

	if (favoriteSet.has(path)) {
		favoriteSet.delete(path);
		writeState({ ...state, favorites: Array.from(favoriteSet) });
		return false;
	}

	favoriteSet.add(path);
	writeState({ ...state, favorites: Array.from(favoriteSet) });
	return true;
}

export function saveCollection(
	name: string,
	assignments: Map<string, WallpaperConfig>,
): WallpaperCollection {
	const state = readState();
	const timestamp = Date.now();
	const collection: WallpaperCollection = {
		id: `${timestamp}`,
		name,
		entries: Array.from(assignments.entries()).map(([monitor, config]) => ({
			monitor,
			path: config.path,
			fillMode: config.fillMode,
		})),
		createdAt: timestamp,
		updatedAt: timestamp,
	};

	const collections = [collection, ...state.collections].slice(0, 30);
	writeState({ ...state, collections });
	return collection;
}

export function deleteCollection(collectionId: string): void {
	const state = readState();
	const collections = state.collections.filter(
		(collection) => collection.id !== collectionId,
	);
	writeState({ ...state, collections });
}
