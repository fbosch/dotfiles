import {
	chmod,
	mkdir,
	open,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AccountPaths, MutationLock } from "./types.ts";

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray(value) === false
	);
}

export async function readJsonObject(path: string): Promise<JsonObject> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read ${path}: ${message}`);
	}

	if (isJsonObject(parsed) === false) {
		throw new Error(`invalid JSON object in ${path}`);
	}

	return parsed;
}

export async function writeJsonAtomic(
	path: string,
	value: unknown,
	fallbackMode: number,
	preserveExistingMode = true,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = join(
		dirname(path),
		`.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
	);
	const mode = preserveExistingMode
		? await existingMode(path, fallbackMode)
		: fallbackMode;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
			mode,
		});
		await chmod(temporaryPath, mode);
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

export async function acquireMutationLock(
	paths: AccountPaths,
): Promise<MutationLock> {
	const path = join(
		dirname(preferredLoginTransactionPath(paths)),
		"mutation.lock",
	);
	await mkdir(dirname(path), { recursive: true });

	try {
		const handle = await open(path, "wx", 0o600);
		await handle.writeFile(JSON.stringify({ pid: process.pid }));
		return {
			release: async () => {
				await handle.close();
				await unlink(path).catch((error: unknown) => {
					if (isNotFound(error)) {
						return;
					}
					throw error;
				});
			},
		};
	} catch (error) {
		if (
			isAlreadyExists(error) === false ||
			(await removeStaleLock(path)) === false
		) {
			throw new Error("another account mutation is already in progress");
		}
		return acquireMutationLock(paths);
	}
}

export async function loginTransactionPath(
	paths: AccountPaths,
): Promise<string> {
	const path = preferredLoginTransactionPath(paths);
	if (paths.legacyState && (await fileExists(path)) === false) {
		if (await fileExists(paths.legacyState)) {
			return paths.legacyState;
		}
	}
	return path;
}

function preferredLoginTransactionPath(paths: AccountPaths): string {
	return paths.state || join(dirname(paths.auth), ".login-transaction.json");
}

export async function removeFile(path: string): Promise<void> {
	await unlink(path).catch((error: unknown) => {
		if (isNotFound(error)) {
			return;
		}
		throw error;
	});
}

export function isNotFound(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function existingMode(
	path: string,
	fallbackMode: number,
): Promise<number> {
	try {
		return (await stat(path)).mode & 0o777;
	} catch (error) {
		if (isNotFound(error)) {
			return fallbackMode;
		}
		throw error;
	}
}

async function removeStaleLock(path: string): Promise<boolean> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown };
		if (typeof value.pid !== "number" || processExists(value.pid)) {
			return false;
		}
		await unlink(path);
		return true;
	} catch {
		return false;
	}
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function isAlreadyExists(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "EEXIST";
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isNotFound(error)) {
			return false;
		}
		throw error;
	}
}
