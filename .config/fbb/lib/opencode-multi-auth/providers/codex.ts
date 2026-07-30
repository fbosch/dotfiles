import { profileColor } from "../../profile-color.ts";
import { queryClientFor } from "../queryclient/client.ts";
import {
	resetCreditsQueryOptions,
	resetCreditsSummary,
} from "../queryclient/queries/reset-credits.ts";
import { usageQueryOptions } from "../queryclient/queries/usage.ts";
import { isJsonObject, type JsonObject } from "../storage.ts";
import type {
	AccountDiscovery,
	AccountPaths,
	AccountProfile,
	AccountResetCreditDiscovery,
	AccountUsageDiscovery,
} from "../types.ts";

const activeProfileKey = "openai";
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
): Promise<AccountUsageDiscovery> {
	const queryClient = queryClientFor(paths).queryClient;
	const result = await discoverProfileValues(
		discovery,
		auth,
		(profileKey, entry) =>
			queryClient.fetchQuery(
				usageQueryOptions(credentialsForEntry(entry)),
			),
		"usage",
	);
	return {
		usageByProfile: result.valuesByProfile,
		diagnostics: result.diagnostics,
	};
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
				resetCreditsQueryOptions(credentialsForEntry(entry)),
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

function byteAt(seed: string, offset: number): number {
	return Number.parseInt(seed.slice(offset, offset + 2) || "00", 16);
}

function normalizedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
