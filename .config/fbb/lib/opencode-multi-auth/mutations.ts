import { discoverAccounts } from "./discovery.ts";
import {
	accountIdForEntry,
	aliasLabel,
	assertMutableDiscovery,
	deleteAliasesForValue,
	generatedLabelFor,
	nextInactiveKey,
	normalizeAlias,
	requireOpenAIAliases,
} from "./profiles.ts";
import { isJsonObject, readJsonObject, writeJsonAtomic } from "./storage.ts";
import {
	type LoginTransaction,
	readLoginTransaction,
	removeLoginTransaction,
	writeLoginTransaction,
} from "./transactions.ts";
import type { AccountDiscovery, OcmaPaths } from "./types.ts";

export async function switchAccount(
	aliasOrLabel: string,
	paths: OcmaPaths,
): Promise<AccountDiscovery> {
	const target = normalizeAlias(aliasOrLabel);
	const discovery = await discoverAccounts(paths);
	assertMutableDiscovery(discovery);
	const matches = discovery.profiles.filter(
		(profile) => profile.alias === target || profile.generatedLabel === target,
	);
	if (matches.length !== 1) {
		throw new Error(`unable to resolve a unique OpenAI profile for: ${target}`);
	}
	if (matches[0].active) {
		return discovery;
	}

	const auth = await readJsonObject(paths.auth);
	const activeEntry = auth.openai;
	const targetEntry = auth[matches[0].key];
	if (
		isJsonObject(activeEntry) === false ||
		isJsonObject(targetEntry) === false
	) {
		throw new Error("OpenAI profile changed while preparing switch");
	}
	auth.openai = targetEntry;
	auth[matches[0].key] = activeEntry;
	await writeJsonAtomic(paths.auth, auth, 0o600);
	return discoverAccounts(paths);
}

export async function beginLogin(
	alias: string,
	paths: OcmaPaths,
): Promise<void> {
	const requestedAlias = normalizeAlias(alias);
	if (await readLoginTransaction(paths)) {
		throw new Error("an incomplete ocma login transaction requires recovery");
	}

	const discovery = await discoverAccounts(paths);
	assertMutableDiscovery(discovery);
	const auth = await readJsonObject(paths.auth);
	const aliases = await readJsonObject(paths.aliases);
	const openaiAliases = requireOpenAIAliases(aliases, paths.aliases);
	const activeEntry = auth.openai;
	if (isJsonObject(activeEntry) === false) {
		throw new Error("active OpenAI profile is invalid");
	}

	const transaction: LoginTransaction = {
		schema: "fbb.ocma-login/v1",
		phase: "prepared",
		alias: requestedAlias,
		reservedKey: nextInactiveKey(auth),
		priorAliasLabel: aliasLabel(openaiAliases, requestedAlias),
	};
	await writeLoginTransaction(paths, transaction);
	try {
		auth[transaction.reservedKey] = activeEntry;
		await writeJsonAtomic(paths.auth, auth, 0o600);
	} catch (error) {
		await removeLoginTransaction(paths);
		throw error;
	}
}

export async function completeLogin(
	paths: OcmaPaths,
): Promise<AccountDiscovery> {
	const transaction = await readLoginTransaction(paths);
	if (transaction === null) {
		throw new Error("no pending ocma login transaction");
	}
	if (transaction.phase !== "prepared") {
		throw new Error("ocma login transaction is not ready to complete");
	}

	const auth = await readJsonObject(paths.auth);
	const aliases = await readJsonObject(paths.aliases);
	const openaiAliases = requireOpenAIAliases(aliases, paths.aliases);
	const activeEntry = auth.openai;
	const reservedEntry = auth[transaction.reservedKey];
	if (
		isJsonObject(activeEntry) === false ||
		isJsonObject(reservedEntry) === false
	) {
		throw new Error(
			"OpenCode login did not leave a valid active OpenAI profile",
		);
	}

	const activeAccountId = accountIdForEntry(activeEntry);
	if (activeAccountId === null) {
		throw new Error("unable to resolve the newly logged-in OpenAI account");
	}
	const newLabel = generatedLabelFor(activeAccountId);
	const labelAlias =
		typeof openaiAliases[newLabel] === "string"
			? openaiAliases[newLabel]
			: null;
	if (labelAlias !== null && labelAlias !== transaction.alias) {
		throw new Error(
			`the newly logged-in account already belongs to alias: ${labelAlias}`,
		);
	}

	const replacementKeys = Object.entries(auth)
		.filter(([key, value]) =>
			isReplacement(key, value, transaction, activeAccountId),
		)
		.map(([key]) => key);
	const discardReserved = accountIdForEntry(reservedEntry) === activeAccountId;
	const nextAliases = structuredClone(aliases);
	const nextOpenaiAliases = requireOpenAIAliases(nextAliases, paths.aliases);
	deleteAliasesForValue(nextOpenaiAliases, transaction.alias);
	nextOpenaiAliases[newLabel] = transaction.alias;

	await writeLoginTransaction(paths, {
		...transaction,
		phase: "aliases-pending",
	});
	await writeJsonAtomic(paths.aliases, nextAliases, 0o644);
	for (const key of replacementKeys) {
		delete auth[key];
	}
	if (discardReserved) {
		delete auth[transaction.reservedKey];
	}
	await writeJsonAtomic(paths.auth, auth, 0o600);
	await writeLoginTransaction(paths, { ...transaction, phase: "auth-written" });
	await removeLoginTransaction(paths);
	return discoverAccounts(paths);
}

function isReplacement(
	key: string,
	value: unknown,
	transaction: LoginTransaction,
	activeAccountId: string,
): boolean {
	if (
		key === "openai" ||
		key === transaction.reservedKey ||
		isJsonObject(value) === false
	) {
		return false;
	}
	const accountId = accountIdForEntry(value);
	return (
		accountId === activeAccountId ||
		generatedLabelFor(accountId || "") === transaction.priorAliasLabel
	);
}
