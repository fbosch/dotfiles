import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { profileColor } from "../profile-color.ts";
import { credentialsForEntry, generatedLabelFor } from "./providers/codex.ts";
import {
	queryClientFor,
	resetCreditsQueryKey,
	usageQueryKey,
} from "./queryclient/client.ts";
import { consumeResetCredit } from "./queryclient/mutations.ts";
import {
	fetchResetCredits,
	resetCreditsQueryOptions,
	selectAvailableCredit,
	type DetailedResetCredit,
	type DetailedResetCredits,
} from "./queryclient/queries/reset-credits.ts";
import { usageQueryOptions } from "./queryclient/queries/usage.ts";
import {
	isJsonObject,
	isNotFound,
	readJsonObject,
	type JsonObject,
} from "./storage.ts";
import type { AccountPaths, AccountUsage } from "./types.ts";

export type { DetailedResetCredit } from "./queryclient/queries/reset-credits.ts";

export type ResetProfile = {
	key: string;
	profileLabel: string;
	displayColor?: number | null;
	active: boolean;
	credentials: { accessToken: string; accountId: string } | null;
	error: string | null;
};

export type ResetStatusData = {
	active: {
		profileLabel: string;
		availableCount: number;
		credits: DetailedResetCredit[];
		usage: ReturnType<typeof statusUsage>;
		error: string | null;
	};
	accounts: Array<{
		profileLabel: string;
		displayColor?: number | null;
		availableCount: number;
		urgency: DetailedResetCredit["urgency"];
		active: boolean;
		error: string | null;
	}>;
};

export type ResetPreviewData = {
	profileLabel: string;
	displayColor?: number | null;
	credit: DetailedResetCredit | null;
};

export type ResetConsumeData = {
	profileLabel: string;
	displayColor?: number | null;
	code: string | null;
	windowsReset: number | null;
	redeemedAt: string | null;
};

export function resetProfilesFromOpenCodeAuth(
	auth: JsonObject,
	aliases: JsonObject,
): ResetProfile[] {
	return Object.entries(auth)
		.filter(([key]) => key === "openai" || key.startsWith("openai_"))
		.map(([key, entry]) => resetProfileFromEntry(key, entry, aliases, key === "openai"));
}

export async function resetProfilesFromLegacyAuth(
	authPath: string,
	aliases: JsonObject,
): Promise<ResetProfile[]> {
	const activeAuth = await readJsonObject(authPath);
	const profilesPath = join(dirname(authPath), "auth-profiles.json");
	const active = resetProfileFromEntry("active", activeAuth, aliases, true);
	try {
		await stat(profilesPath);
	} catch (error) {
		if (isNotFound(error) === false) {
			throw error;
		}
		return [active];
	}
	const inactiveAuth = await readJsonObject(profilesPath);
	const profiles = isJsonObject(inactiveAuth.profiles)
		? inactiveAuth.profiles
		: inactiveAuth;
	const activeAccountId = active.credentials?.accountId;
	const seenAccountIds = new Set(activeAccountId ? [activeAccountId] : []);
	return [
		active,
		...Object.entries(profiles)
			.filter(([key]) => key !== "version" && key !== "profiles")
			.map(([key, entry]) => resetProfileFromEntry(key, entry, aliases, false))
			.filter((profile) => {
				const accountId = profile.credentials?.accountId;
				if (accountId === undefined || seenAccountIds.has(accountId)) {
					return false;
				}
				seenAccountIds.add(accountId);
				return true;
			}),
	];
}

function resetProfileFromEntry(
	key: string,
	entry: unknown,
	aliases: JsonObject,
	active: boolean,
): ResetProfile {
	const credentials = credentialsFromLegacyEntry(entry);
	const accountId = credentials?.accountId || null;
	const generatedLabel = accountId ? generatedLabelFor(accountId) : null;
	const alias = generatedLabel && typeof aliases[generatedLabel] === "string" ? aliases[generatedLabel] : null;
	return {
		key,
		profileLabel: alias || generatedLabel || key,
		displayColor: accountId ? profileColor(accountId) : null,
		active,
		credentials,
		error: credentials ? null : "profile is missing credentials",
	};
}

function credentialsFromLegacyEntry(entry: unknown): ResetProfile["credentials"] {
	if (isJsonObject(entry) === false) {
		return null;
	}
	try {
		return credentialsForEntry(entry);
	} catch {
		const tokens = isJsonObject(entry.tokens) ? entry.tokens : {};
		const accessToken =
			normalizedString(entry.access_token) || normalizedString(tokens.access_token);
		const accountId =
			normalizedString(entry.account_id) || normalizedString(tokens.account_id);
		return accessToken && accountId ? { accessToken, accountId } : null;
	}
}

function normalizedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function clearResetStatusCache(paths: AccountPaths): Promise<void> {
	const client = queryClientFor(paths);
	for (const queryKey of [resetCreditsQueryKey, usageQueryKey]) {
		client.queryClient.removeQueries({ queryKey });
		await client.queryPersister.removeQueries({ queryKey });
	}
}

export async function resetStatus(
	profiles: ResetProfile[],
	paths: AccountPaths,
	refresh: boolean,
): Promise<ResetStatusData> {
	if (refresh) {
		await clearResetStatusCache(paths);
	}
	const results = await Promise.all(
		profiles.map((profile) => resetStatusForProfile(profile, paths)),
	);
	const active = results.find((result) => result.profile.active);
	if (active?.credits === null || active === undefined || active.resetError) {
		throw new Error(active?.resetError || "active reset credits are unavailable");
	}
	return {
		active: {
			profileLabel: active.profile.profileLabel,
			availableCount: active.credits.availableCount,
			credits: active.credits.credits,
			usage: active.usage ? statusUsage(active.usage) : [],
			error: active.usageError,
		},
		accounts: results.map(accountStatus),
	};
}

export async function previewResetCredit(
	profile: ResetProfile,
	creditId?: string,
): Promise<DetailedResetCredit | null> {
	const credentials = requiredCredentials(profile);
	const credits = await fetchResetCredits(credentials);
	return selectAvailableCredit(credits.credits, creditId);
}

export async function redeemResetCredit(
	profile: ResetProfile,
	creditId: string,
	paths: AccountPaths,
): Promise<{
	data: Awaited<ReturnType<typeof consumeResetCredit>>["data"];
	cacheInvalidationError: string | null;
}> {
	const credentials = requiredCredentials(profile);
	const credits = await fetchResetCredits(credentials);
	if (selectAvailableCredit(credits.credits, creditId) === null) {
		throw new Error("reset credit is unavailable");
	}
	return consumeResetCredit(paths, credentials, creditId);
}

function statusUsage(usage: AccountUsage): Array<{
	name: "primary" | "secondary";
	remaining: number | null;
	window: string | null;
	resetsIn: string | null;
	resetsAt: string | null;
}> {
	return (["primary", "secondary"] as const).map((name) => ({
		name,
		remaining: usage[name].remainingPercent,
		window: formatDuration(usage[name].limitWindowSeconds ?? null),
		resetsIn: formatDuration(usage[name].resetAfterSeconds ?? null),
		resetsAt: usage[name].resetAt,
	}));
}

async function resetStatusForProfile(
	profile: ResetProfile,
	paths: AccountPaths,
) {
	if (profile.credentials === null) {
		return {
			profile,
			credits: null,
			usage: null,
			resetError: profile.error,
			usageError: null,
		};
	}
	const queryClient = queryClientFor(paths).queryClient;
	const [credits, usage] = await Promise.allSettled([
		queryClient.fetchQuery(resetCreditsQueryOptions(profile.credentials)),
		queryClient.fetchQuery(usageQueryOptions(profile.credentials)),
	]);
	return {
		profile,
		credits: credits.status === "fulfilled" ? credits.value : null,
		usage: usage.status === "fulfilled" ? usage.value : null,
		resetError: credits.status === "rejected" ? safeError(credits.reason) : null,
		usageError: usage.status === "rejected" ? safeError(usage.reason) : null,
	};
}

function accountStatus(
	result: Awaited<ReturnType<typeof resetStatusForProfile>>,
): ResetStatusData["accounts"][number] {
	return {
		profileLabel: result.profile.profileLabel,
		displayColor: result.profile.displayColor ?? null,
		availableCount: result.credits?.availableCount ?? 0,
		urgency:
			selectAvailableCredit(result.credits?.credits || [])?.urgency || "unknown",
		active: result.profile.active,
		error: result.resetError || result.usageError || result.profile.error,
	};
}

function requiredCredentials(
	profile: ResetProfile,
): NonNullable<ResetProfile["credentials"]> {
	if (profile.credentials === null) {
		throw new Error(profile.error || "active profile is missing credentials");
	}
	return profile.credentials;
}

function safeError(error: unknown): string {
	return error instanceof Error ? error.message : "request failed";
}

function formatDuration(seconds: number | null): string | null {
	if (seconds === null || Number.isFinite(seconds) === false) return null;
	if (seconds >= 86_400) return `${Math.round(seconds / 86_400)}d`;
	if (seconds >= 3_600) return `${Math.round(seconds / 3_600)}h`;
	if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
	return `${Math.floor(seconds)}s`;
}
