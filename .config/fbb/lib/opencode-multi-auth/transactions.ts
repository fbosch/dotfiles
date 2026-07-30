import { readFile } from "node:fs/promises";
import { deleteAliasesForValue } from "./profiles.ts";
import { activeKey, aliasesFor } from "./providers/codex.ts";
import {
	isJsonObject,
	isNotFound,
	loginTransactionPath,
	readJsonObject,
	removeFile,
	writeJsonAtomic,
} from "./storage.ts";
import type { AccountPaths } from "./types.ts";

const loginTransactionSchema = "fbb.openai-login/v1";
const legacyLoginTransactionSchema = "fbb.ocma-login/v1";

export type LoginTransaction = {
	schema: typeof loginTransactionSchema;
	phase: "prepared" | "aliases-pending" | "auth-written";
	alias: string;
	reservedKey: string;
	priorAliasLabel: string | null;
};

export async function hasPendingLogin(paths: AccountPaths): Promise<boolean> {
	return (await readLoginTransaction(paths)) !== null;
}

export async function recoverPendingLogin(
	paths: AccountPaths,
): Promise<boolean> {
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
		auth[activeKey()] = reservedEntry;
		delete auth[transaction.reservedKey];
		await writeJsonAtomic(paths.auth, auth, 0o600);
	}

	if (transaction.phase === "aliases-pending") {
		const aliases = await readJsonObject(paths.aliases);
		const accountAliases = aliasesFor(aliases, paths.aliases);
		deleteAliasesForValue(accountAliases, transaction.alias);
		if (transaction.priorAliasLabel !== null) {
			accountAliases[transaction.priorAliasLabel] = transaction.alias;
		}
		await writeJsonAtomic(paths.aliases, aliases, 0o644);
	}

	await removeLoginTransaction(paths);
	return true;
}

export async function readLoginTransaction(
	paths: AccountPaths,
): Promise<LoginTransaction | null> {
	const path = await loginTransactionPath(paths);
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (isLoginTransaction(value) === false) {
			throw new Error(`invalid login transaction in ${path}`);
		}
		return { ...value, schema: loginTransactionSchema };
	} catch (error) {
		if (isNotFound(error)) {
			return null;
		}
		throw error;
	}
}

export async function writeLoginTransaction(
	paths: AccountPaths,
	transaction: LoginTransaction,
): Promise<void> {
	await writeJsonAtomic(await loginTransactionPath(paths), transaction, 0o600);
}

export async function removeLoginTransaction(
	paths: AccountPaths,
): Promise<void> {
	await removeFile(await loginTransactionPath(paths));
}

function isLoginTransaction(value: unknown): value is LoginTransaction {
	return (
		isJsonObject(value) &&
		(value.schema === loginTransactionSchema ||
			value.schema === legacyLoginTransactionSchema) &&
		(value.phase === "prepared" ||
			value.phase === "aliases-pending" ||
			value.phase === "auth-written") &&
		typeof value.alias === "string" &&
		typeof value.reservedKey === "string" &&
		(typeof value.priorAliasLabel === "string" ||
			value.priorAliasLabel === null)
	);
}
