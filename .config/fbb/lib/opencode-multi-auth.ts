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

const adjectives = [
	"ember",
	"cobalt",
	"amber",
	"jade",
	"coral",
	"indigo",
	"silver",
	"scarlet",
	"atlas",
	"lotus",
	"cedar",
	"pine",
	"aurora",
	"frost",
	"orbit",
	"dune",
	"maple",
	"zenith",
];

const nouns = [
	"falcon",
	"otter",
	"comet",
	"harbor",
	"meadow",
	"emberfox",
	"lynx",
	"kestrel",
	"glacier",
	"thicket",
	"river",
	"moss",
	"canyon",
	"beacon",
	"auroraforge",
	"wave",
	"ridge",
];

type JsonObject = Record<string, unknown>;

export type OcmaPaths = {
	auth: string;
	aliases: string;
	state?: string;
};

export type AccountProfile = {
	key: string;
	accountId: string | null;
	generatedLabel: string | null;
	alias: string | null;
	active: boolean;
};

export type AccountDiscovery = {
	profiles: AccountProfile[];
	diagnostics: Diagnostic[];
};

export type Diagnostic = {
	code: string;
	message: string;
};

export type PublicAccountProfile = Omit<AccountProfile, "accountId">;

export type PublicAccountDiscovery = {
	profiles: PublicAccountProfile[];
	diagnostics: Diagnostic[];
};

type LoginTransaction = {
	schema: "fbb.ocma-login/v1";
	phase: "prepared" | "aliases-pending" | "auth-written";
	alias: string;
	reservedKey: string;
	priorAliasLabel: string | null;
};

export type MutationLock = {
	release: () => Promise<void>;
};

export function defaultPaths(env: NodeJS.ProcessEnv = process.env): OcmaPaths {
	const home = env.HOME || "";
	const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
	const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
	const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state");

	return {
		auth: join(dataHome, "opencode", "auth.json"),
		aliases: join(configHome, "fbb", "data", "account-aliases.json"),
		state: join(stateHome, "fbb", "ocma", "login-transaction.json"),
	};
}

export async function discoverAccounts(
	paths: OcmaPaths = defaultPaths(),
): Promise<AccountDiscovery> {
	const [auth, aliases] = await Promise.all([
		readJsonObject(paths.auth),
		readJsonObject(paths.aliases),
	]);
	const openaiAliases = aliases.openai;
	if (isJsonObject(openaiAliases) === false) {
		throw new Error(`invalid OpenAI aliases in ${paths.aliases}`);
	}

	const profiles = Object.entries(auth)
		.filter(([key]) => key === "openai" || key.startsWith("openai_"))
		.map(([key, value]) => profileFromEntry(key, value, openaiAliases))
		.sort(compareProfiles);

	const diagnostics = discoveryDiagnostics(profiles);
	if (profiles.some((profile) => profile.active) === false) {
		diagnostics.push({
			code: "active-profile-missing",
			message: "active OpenAI profile is missing",
		});
	}
	if (await readLoginTransaction(paths)) {
		diagnostics.push({
			code: "login-transaction-pending",
			message: "an interrupted OpenAI login requires recovery before mutation",
		});
	}

	return { profiles, diagnostics };
}

export function toPublicDiscovery(
	discovery: AccountDiscovery,
): PublicAccountDiscovery {
	return {
		profiles: discovery.profiles.map(({ accountId: _, ...profile }) => profile),
		diagnostics: discovery.diagnostics,
	};
}

function profileFromEntry(
	key: string,
	value: unknown,
	aliases: JsonObject,
): AccountProfile {
	if (isJsonObject(value) === false) {
		return {
			key,
			accountId: null,
			generatedLabel: null,
			alias: null,
			active: key === "openai",
		};
	}

	const accountId = accountIdForEntry(value);
	const generatedLabel = accountId ? generatedLabelFor(accountId) : null;
	const alias =
		generatedLabel && typeof aliases[generatedLabel] === "string"
			? aliases[generatedLabel]
			: null;

	return { key, accountId, generatedLabel, alias, active: key === "openai" };
}

function discoveryDiagnostics(profiles: AccountProfile[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const seenAccounts = new Set<string>();
	const seenAliases = new Set<string>();
	const seenLabels = new Map<string, string>();

	for (const profile of profiles) {
		if (profile.accountId === null) {
			diagnostics.push({
				code: "account-identity-unresolved",
				message: `unable to resolve account identity for ${profile.key}`,
			});
			continue;
		}

		if (seenAccounts.has(profile.accountId)) {
			diagnostics.push({
				code: "duplicate-account-profile",
				message: `duplicate account profile: ${profile.key}`,
			});
		}
		seenAccounts.add(profile.accountId);

		if (profile.generatedLabel) {
			const existing = seenLabels.get(profile.generatedLabel);
			if (existing && existing !== profile.accountId) {
				diagnostics.push({
					code: "generated-label-collision",
					message: `generated label collision: ${profile.generatedLabel}`,
				});
			}
			seenLabels.set(profile.generatedLabel, profile.accountId);
		}

		if (profile.alias && seenAliases.has(profile.alias)) {
			diagnostics.push({
				code: "duplicate-alias",
				message: `duplicate OpenAI alias: ${profile.alias}`,
			});
		}
		if (profile.alias) {
			seenAliases.add(profile.alias);
		}
	}

	return diagnostics;
}

function accountIdForEntry(entry: JsonObject): string | null {
	const explicitId = normalizedString(entry.accountId);
	const tokenId = accountIdFromAccessToken(entry.access);
	if (explicitId && tokenId && explicitId !== tokenId) {
		return null;
	}

	return explicitId || tokenId;
}

function accountIdFromAccessToken(access: unknown): string | null {
	if (typeof access !== "string") {
		return null;
	}

	const payload = access.split(".")[1];
	if (payload === undefined) {
		return null;
	}

	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as unknown;
		if (
			isJsonObject(claims) === false ||
			isJsonObject(claims["https://api.openai.com/auth"]) === false
		) {
			return null;
		}
		return normalizedString(
			claims["https://api.openai.com/auth"].chatgpt_account_id,
		);
	} catch {
		return null;
	}
}

function generatedLabelFor(accountId: string): string {
	const seed = accountId.replace(/[^0-9a-fA-F]/g, "") || "00";
	const adjective = adjectives[byteAt(seed, 0) % adjectives.length];
	const noun = nouns[byteAt(seed, 2) % nouns.length];
	return `${adjective}-${noun}-${accountId.slice(-4)}`;
}

function byteAt(seed: string, offset: number): number {
	return Number.parseInt(seed.slice(offset, offset + 2) || "00", 16);
}

function compareProfiles(left: AccountProfile, right: AccountProfile): number {
	if (left.active !== right.active) {
		return left.active ? -1 : 1;
	}

	return left.key.localeCompare(right.key, undefined, { numeric: true });
}

function normalizedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isJsonObject(value: unknown): value is JsonObject {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray(value) === false
	);
}

async function readJsonObject(path: string): Promise<JsonObject> {
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

export async function acquireMutationLock(
	paths: OcmaPaths = defaultPaths(),
): Promise<MutationLock> {
	const path = mutationLockPath(paths);
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
			throw new Error("another ocma mutation is already in progress");
		}
		return acquireMutationLock(paths);
	}
}

export async function recoverPendingLogin(
	paths: OcmaPaths = defaultPaths(),
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

export async function switchAccount(
	aliasOrLabel: string,
	paths: OcmaPaths = defaultPaths(),
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
	paths: OcmaPaths = defaultPaths(),
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

	const priorAliasLabel = aliasLabel(openaiAliases, requestedAlias);
	const reservedKey = nextInactiveKey(auth);
	const transaction: LoginTransaction = {
		schema: "fbb.ocma-login/v1",
		phase: "prepared",
		alias: requestedAlias,
		reservedKey,
		priorAliasLabel,
	};

	await writeLoginTransaction(paths, transaction);
	try {
		auth[reservedKey] = activeEntry;
		await writeJsonAtomic(paths.auth, auth, 0o600);
	} catch (error) {
		await removeLoginTransaction(paths);
		throw error;
	}
}

export async function completeLogin(
	paths: OcmaPaths = defaultPaths(),
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
		.filter(([key, value]) => {
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
		})
		.map(([key]) => key);
	const reservedAccountId = accountIdForEntry(reservedEntry);
	const discardReserved = reservedAccountId === activeAccountId;

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

function assertMutableDiscovery(discovery: AccountDiscovery): void {
	if (discovery.diagnostics.length > 0) {
		throw new Error(
			"OpenAI profiles must be resolved and unique before mutation",
		);
	}
}

function requireOpenAIAliases(aliases: JsonObject, path: string): JsonObject {
	if (isJsonObject(aliases.openai) === false) {
		throw new Error(`invalid OpenAI aliases in ${path}`);
	}
	return aliases.openai;
}

function normalizeAlias(alias: string): string {
	const normalized = alias.trim();
	if (normalized === "" || /[\r\n]/.test(normalized)) {
		throw new Error("OpenAI alias must be a non-empty single line");
	}
	return normalized;
}

function aliasLabel(aliases: JsonObject, alias: string): string | null {
	const labels = Object.entries(aliases)
		.filter(([, value]) => value === alias)
		.map(([label]) => label);
	if (labels.length > 1) {
		throw new Error(`OpenAI alias is not unique: ${alias}`);
	}
	return labels[0] || null;
}

function deleteAliasesForValue(aliases: JsonObject, alias: string): void {
	for (const [label, value] of Object.entries(aliases)) {
		if (value === alias) {
			delete aliases[label];
		}
	}
}

function nextInactiveKey(auth: JsonObject): string {
	let index = 1;
	while (`openai_${index}` in auth) {
		index += 1;
	}
	return `openai_${index}`;
}

function loginTransactionPath(paths: OcmaPaths): string {
	return (
		paths.state || join(dirname(paths.auth), ".ocma-login-transaction.json")
	);
}

function mutationLockPath(paths: OcmaPaths): string {
	return join(dirname(loginTransactionPath(paths)), "mutation.lock");
}

async function readLoginTransaction(
	paths: OcmaPaths,
): Promise<LoginTransaction | null> {
	const path = loginTransactionPath(paths);
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (isJsonObject(value) === false) {
			throw new Error(`invalid ocma login transaction in ${path}`);
		}
		if (
			value.schema !== "fbb.ocma-login/v1" ||
			(value.phase !== "prepared" &&
				value.phase !== "aliases-pending" &&
				value.phase !== "auth-written") ||
			typeof value.alias !== "string" ||
			typeof value.reservedKey !== "string" ||
			(typeof value.priorAliasLabel !== "string" &&
				value.priorAliasLabel !== null)
		) {
			throw new Error(`invalid ocma login transaction in ${path}`);
		}
		return value as LoginTransaction;
	} catch (error) {
		if (isNotFound(error)) {
			return null;
		}
		throw error;
	}
}

async function writeLoginTransaction(
	paths: OcmaPaths,
	transaction: LoginTransaction,
): Promise<void> {
	await writeJsonAtomic(loginTransactionPath(paths), transaction, 0o600);
}

async function removeLoginTransaction(paths: OcmaPaths): Promise<void> {
	await unlink(loginTransactionPath(paths)).catch((error: unknown) => {
		if (isNotFound(error)) {
			return;
		}
		throw error;
	});
}

async function writeJsonAtomic(
	path: string,
	value: unknown,
	fallbackMode: number,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = join(
		dirname(path),
		`.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
	);
	const mode = await existingMode(path, fallbackMode);
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

function isNotFound(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
