import { readFile } from "node:fs/promises";
import { deleteAliasesForValue, requireOpenAIAliases } from "./profiles.ts";
import {
	isJsonObject,
	isNotFound,
	loginTransactionPath,
	readJsonObject,
	removeFile,
	writeJsonAtomic,
} from "./storage.ts";
import type { OcmaPaths } from "./types.ts";

export type LoginTransaction = {
	schema: "fbb.ocma-login/v1";
	phase: "prepared" | "aliases-pending" | "auth-written";
	alias: string;
	reservedKey: string;
	priorAliasLabel: string | null;
};

export async function hasPendingLogin(paths: OcmaPaths): Promise<boolean> {
	return (await readLoginTransaction(paths)) !== null;
}

export async function recoverPendingLogin(paths: OcmaPaths): Promise<boolean> {
	const transaction = await readLoginTransaction(paths);
	if (transaction === null) {
		return false;
	}
	if (transaction.phase === "auth-written") {
		await removeLoginTransaction(paths);
		return true;
	}

	const auth = await readJsonObject(paths.auth);
	const reservedEntry = auth[transaction.reservedKey];
	if (isJsonObject(reservedEntry)) {
		auth.openai = reservedEntry;
		delete auth[transaction.reservedKey];
		await writeJsonAtomic(paths.auth, auth, 0o600);
	}

	if (transaction.phase === "aliases-pending") {
		const aliases = await readJsonObject(paths.aliases);
		const openaiAliases = requireOpenAIAliases(aliases, paths.aliases);
		deleteAliasesForValue(openaiAliases, transaction.alias);
		if (transaction.priorAliasLabel !== null) {
			openaiAliases[transaction.priorAliasLabel] = transaction.alias;
		}
		await writeJsonAtomic(paths.aliases, aliases, 0o644);
	}

	await removeLoginTransaction(paths);
	return true;
}

export async function readLoginTransaction(
	paths: OcmaPaths,
): Promise<LoginTransaction | null> {
	const path = loginTransactionPath(paths);
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (isLoginTransaction(value) === false) {
			throw new Error(`invalid ocma login transaction in ${path}`);
		}
		return value;
	} catch (error) {
		if (isNotFound(error)) {
			return null;
		}
		throw error;
	}
}

export async function writeLoginTransaction(
	paths: OcmaPaths,
	transaction: LoginTransaction,
): Promise<void> {
	await writeJsonAtomic(loginTransactionPath(paths), transaction, 0o600);
}

export async function removeLoginTransaction(paths: OcmaPaths): Promise<void> {
	await removeFile(loginTransactionPath(paths));
}

function isLoginTransaction(value: unknown): value is LoginTransaction {
	return (
		isJsonObject(value) &&
		value.schema === "fbb.ocma-login/v1" &&
		(value.phase === "prepared" ||
			value.phase === "aliases-pending" ||
			value.phase === "auth-written") &&
		typeof value.alias === "string" &&
		typeof value.reservedKey === "string" &&
		(typeof value.priorAliasLabel === "string" ||
			value.priorAliasLabel === null)
	);
}
