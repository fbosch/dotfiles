import { profileColor } from "../../profile-color.ts";
import { queryClientFor } from "../queryclient/client.ts";
import {
	resetCreditsQueryOptions,
	resetCreditsSummary,
} from "../queryclient/queries/reset-credits.ts";
import {
	fetchUsageUncached,
	usageQueryOptions,
} from "../queryclient/queries/usage.ts";
import {
	acquireMutationLock,
	isJsonObject,
	readJsonObject,
	type JsonObject,
	writeJsonAtomic,
} from "../storage.ts";
import type {
	AccountDiscovery,
	AccountPaths,
	AccountProfile,
	AccountResetCreditDiscovery,
	AccountUsageDiscovery,
} from "../types.ts";

const activeProfileKey = "openai";
const oauthClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const oauthRefreshUrl = "https://auth.openai.com/oauth/token";
const oauthRefreshTimeoutMs = 15_000;
const mutationLockRetryDelayMs = 50;
const mutationLockTimeoutMs = 10_000;
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

export const loginCommand = [
	"opencode",
	"auth",
	"login",
	"--provider",
	"openai",
];

export function aliasesFor(aliases: JsonObject, path: string): JsonObject {
	if (isJsonObject(aliases.openai) === false) {
		throw new Error(`invalid Codex aliases in ${path}`);
	}
	return aliases.openai;
}

export function profilesFromAuth(
	auth: JsonObject,
	aliases: JsonObject,
): AccountProfile[] {
	return Object.entries(auth)
		.filter(([key]) => key === activeProfileKey || key.startsWith("openai_"))
		.map(([key, value]) => profileFromEntry(key, value, aliases));
}

export function accountIdForEntry(entry: JsonObject): string | null {
	const explicitId = normalizedString(entry.accountId);
	const tokenId = accountIdFromAccessToken(entry.access);
	if (explicitId && tokenId && explicitId !== tokenId) {
		return null;
	}
	return explicitId || tokenId;
}

export function generatedLabelFor(accountId: string): string {
	const seed = accountId.replace(/[^0-9a-fA-F]/g, "") || "00";
	return `${adjectives[byteAt(seed, 0) % adjectives.length]}-${nouns[byteAt(seed, 2) % nouns.length]}-${accountId.slice(-4)}`;
}

export function nextProfileKey(auth: JsonObject): string {
	let index = 1;
	while (`openai_${index}` in auth) {
		index += 1;
	}
	return `openai_${index}`;
}

export async function discoverUsage(
	discovery: AccountDiscovery,
	auth: JsonObject,
	paths: AccountPaths,
	forceRefresh = false,
): Promise<AccountUsageDiscovery> {
	const result = await discoverProfileValues(
		discovery,
		auth,
		(profileKey, entry) =>
			fetchUsage(
				credentialsForEntry(entry),
				paths,
				forceRefresh,
				(credentials) =>
					refreshProfileCredentials(profileKey, credentials, paths),
			),
		"usage",
	);
	return {
		usageByProfile: result.valuesByProfile,
		diagnostics: result.diagnostics,
	};
}

export async function fetchUsage(
	credentials: { accessToken: string; accountId: string },
	paths: AccountPaths,
	forceRefresh = false,
	refreshCredentials?: (
		credentials: { accessToken: string; accountId: string },
	) => Promise<{ accessToken: string; accountId: string }>,
) {
	if (forceRefresh) {
		return fetchUsageUncached(credentials, refreshCredentials);
	}
	const client = queryClientFor(paths);
	const options = usageQueryOptions(credentials, refreshCredentials);
	if (client.queryClient.getQueryState(options.queryKey) === undefined) {
		await client.queryPersister.restoreQueries(client.queryClient, {
			queryKey: options.queryKey,
			exact: true,
		});
	}
	return client.queryClient.fetchQuery(options);
}

export async function discoverResetCredits(
	discovery: AccountDiscovery,
	auth: JsonObject,
	paths: AccountPaths,
): Promise<AccountResetCreditDiscovery> {
	const queryClient = queryClientFor(paths).queryClient;
	const result = await discoverProfileValues(
		discovery,
		auth,
		(profileKey, entry) =>
			queryClient.fetchQuery(
				resetCreditsQueryOptions(
					credentialsForEntry(entry),
					(credentials) =>
						refreshProfileCredentials(profileKey, credentials, paths),
				),
			).then(resetCreditsSummary),
		"reset credits",
	);
	return {
		resetCreditsByProfile: result.valuesByProfile,
		diagnostics: result.diagnostics,
	};
}

async function discoverProfileValues<T>(
	discovery: AccountDiscovery,
	auth: JsonObject,
	fetchValue: (profileKey: string, entry: JsonObject) => Promise<T>,
	label: string,
): Promise<{
	valuesByProfile: Map<string, T>;
	diagnostics: AccountDiscovery["diagnostics"];
}> {
	const results = await Promise.all(
		discovery.profiles.map(async (profile) => {
			const entry = auth[profile.key];
			if (isJsonObject(entry) === false) {
				return [profile.key, new Error("invalid Codex profile")] as const;
			}
			try {
				return [profile.key, await fetchValue(profile.key, entry)] as const;
			} catch (error) {
				return [
					profile.key,
					error instanceof Error ? error : new Error(String(error)),
				] as const;
			}
		}),
	);
	const valuesByProfile = new Map<string, T>();
	const diagnostics = [];
	for (const [key, result] of results) {
		if (result instanceof Error) {
			diagnostics.push({
				code: `${label.replaceAll(" ", "-")}-unavailable`,
				message: `${label} unavailable for ${key}`,
			});
			continue;
		}
		valuesByProfile.set(key, result);
	}
	return { valuesByProfile, diagnostics };
}

export function activeKey(): string {
	return activeProfileKey;
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
			displayColor: null,
			generatedLabel: null,
			alias: null,
			active: key === activeProfileKey,
		};
	}
	const accountId = accountIdForEntry(value);
	const generatedLabel = accountId ? generatedLabelFor(accountId) : null;
	const alias =
		generatedLabel && typeof aliases[generatedLabel] === "string"
			? aliases[generatedLabel]
			: null;
	return {
		key,
		accountId,
		displayColor: accountId ? profileColor(accountId) : null,
		generatedLabel,
		alias,
		active: key === activeProfileKey,
	};
}

export function credentialsForEntry(entry: JsonObject): {
	accessToken: string;
	accountId: string;
} {
	const accessToken = typeof entry.access === "string" ? entry.access : null;
	const accountId = accountIdForEntry(entry);
	if (accessToken === null || accountId === null) {
		throw new Error("Codex profile is missing credentials");
	}
	return {
		accessToken,
		accountId,
	};
}

export async function refreshExpiredProfileCredentials(
	discovery: AccountDiscovery,
	paths: AccountPaths,
): Promise<{ auth: JsonObject; diagnostics: AccountDiscovery["diagnostics"] }> {
	const auth = await readJsonObject(paths.auth);
	const diagnostics: AccountDiscovery["diagnostics"] = [];
	for (const profile of discovery.profiles) {
		const entry = auth[profile.key];
		if (isJsonObject(entry) === false || profileNeedsRefresh(entry) === false) {
			continue;
		}
		try {
			await refreshProfileCredentials(
				profile.key,
				credentialsForEntry(entry),
				paths,
			);
		} catch {
			diagnostics.push({
				code: "token-refresh-unavailable",
				message: `token refresh unavailable for ${profile.key}`,
			});
		}
	}
	return { auth: await readJsonObject(paths.auth), diagnostics };
}

async function refreshProfileCredentials(
	profileKey: string,
	expected: { accessToken: string; accountId: string },
	paths: AccountPaths,
): Promise<{ accessToken: string; accountId: string }> {
	const lock = await acquireMutationLockWithWait(paths);
	try {
		const auth = await readJsonObject(paths.auth);
		const entry = auth[profileKey];
		if (isJsonObject(entry) === false) {
			throw new Error("Codex profile is missing credentials");
		}
		const current = credentialsForEntry(entry);
		if (current.accountId !== expected.accountId) {
			throw new Error("Codex profile changed during token refresh");
		}
		if (current.accessToken !== expected.accessToken) {
			return current;
		}

		const refreshToken = typeof entry.refresh === "string" ? entry.refresh : null;
		if (refreshToken === null || refreshToken === "") {
			throw new Error("Codex profile is missing a refresh token");
		}
		const response = await fetch(oauthRefreshUrl, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: oauthClientId,
			}).toString(),
			signal: AbortSignal.timeout(oauthRefreshTimeoutMs),
			redirect: "error",
		});
		if (response.ok === false) {
			throw new Error(`OpenAI OAuth refresh failed with ${response.status}`);
		}
		const refreshed = refreshedCredentials(
			await response.json(),
			current.accountId,
		);
		auth[profileKey] = {
			...entry,
			type: "oauth",
			access: refreshed.accessToken,
			refresh: refreshed.refreshToken,
			expires: refreshed.expires,
			accountId: refreshed.accountId,
		};
		await writeJsonAtomic(paths.auth, auth, 0o600, false);
		return { accessToken: refreshed.accessToken, accountId: refreshed.accountId };
	} finally {
		await lock.release();
	}
}

function accountIdFromAccessToken(access: unknown): string | null {
	const claims = tokenClaims(access);
	if (
		claims === null ||
		isJsonObject(claims["https://api.openai.com/auth"]) === false
	) {
		return null;
	}
	return normalizedString(
		claims["https://api.openai.com/auth"].chatgpt_account_id,
	);
}

function byteAt(seed: string, offset: number): number {
	return Number.parseInt(seed.slice(offset, offset + 2) || "00", 16);
}

function normalizedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function profileNeedsRefresh(entry: JsonObject): boolean {
	return typeof entry.expires !== "number" || entry.expires <= Date.now();
}

async function acquireMutationLockWithWait(paths: AccountPaths) {
	const deadline = Date.now() + mutationLockTimeoutMs;
	while (true) {
		try {
			return await acquireMutationLock(paths);
		} catch (error) {
			if (
				error instanceof Error === false ||
				error.message !== "another account mutation is already in progress" ||
				Date.now() >= deadline
			) {
				throw error;
			}
			await Bun.sleep(mutationLockRetryDelayMs);
		}
	}
}

function refreshedCredentials(
	value: unknown,
	accountId: string,
): {
	accessToken: string;
	refreshToken: string;
	accountId: string;
	expires: number;
} {
	if (isJsonObject(value) === false) {
		throw new Error("OpenAI OAuth refresh returned an invalid response");
	}
	const accessToken = requiredToken(value.access_token, "access");
	const refreshToken = requiredToken(value.refresh_token, "refresh");
	const expiresIn = tokenLifetime(value.expires_in);
	const returnedAccountId =
		accountIdFromOAuthToken(value.id_token) ||
		accountIdFromAccessToken(value.access_token);
	if (returnedAccountId && returnedAccountId !== accountId) {
		throw new Error("OpenAI OAuth refresh returned credentials for another account");
	}
	const expires = Date.now() + expiresIn * 1000;
	if (Number.isFinite(expires) === false) {
		throw new Error("OpenAI OAuth refresh returned an invalid expiry");
	}
	return { accessToken, refreshToken, accountId, expires };
}

function requiredToken(value: unknown, label: "access" | "refresh"): string {
	if (typeof value !== "string" || value === "") {
		throw new Error(`OpenAI OAuth refresh did not return a ${label} token`);
	}
	return value;
}

function tokenLifetime(value: unknown): number {
	if (value === undefined) {
		return 3600;
	}
	if (typeof value !== "number" || Number.isFinite(value) === false || value < 0) {
		throw new Error("OpenAI OAuth refresh returned an invalid expiry");
	}
	return value;
}

function accountIdFromOAuthToken(value: unknown): string | null {
	const claims = tokenClaims(value);
	if (claims === null) {
		return null;
	}
	return normalizedString(claims.chatgpt_account_id);
}

function tokenClaims(value: unknown): JsonObject | null {
	if (typeof value !== "string") {
		return null;
	}
	const payload = value.split(".")[1];
	if (payload === undefined) {
		return null;
	}
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as unknown;
		return isJsonObject(claims) ? claims : null;
	} catch {
		return null;
	}
}
