import { z } from "zod";
import { profileColor } from "../../profile-color.ts";
import { queryUsage } from "../queryclient/usage.ts";
import { isJsonObject, type JsonObject } from "../storage.ts";
import type {
	AccountDiscovery,
	AccountPaths,
	AccountProfile,
	AccountUsage,
	AccountUsageDiscovery,
	UsageWindow,
} from "../types.ts";

const activeProfileKey = "openai";
const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
const requestTimeoutMs = 10_000;
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
const FiniteNumberSchema = z.custom<number>(
	(value) => typeof value === "number" && Number.isFinite(value),
);
const UsageWindowSchema = z
	.object({
		used_percent: FiniteNumberSchema.optional(),
		reset_after_seconds: FiniteNumberSchema.optional(),
	})
	.nullish();
const UsageSchema = z.object({
	rate_limit: z
		.object({
			primary_window: UsageWindowSchema,
			secondary_window: UsageWindowSchema,
		})
		.default({}),
});

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
	const results = await Promise.all(
		discovery.profiles.map(async (profile) => {
			const entry = auth[profile.key];
			if (isJsonObject(entry) === false) {
				return [profile.key, new Error("invalid Codex profile")] as const;
			}
			try {
				return [
					profile.key,
					await queryUsage(paths, profile.key, () => requestUsage(entry)),
				] as const;
			} catch (error) {
				return [
					profile.key,
					error instanceof Error ? error : new Error(String(error)),
				] as const;
			}
		}),
	);

	const usageByProfile = new Map<string, AccountUsage>();
	const diagnostics = [];
	for (const [key, result] of results) {
		if (result instanceof Error) {
			diagnostics.push({
				code: "usage-unavailable",
				message: `usage unavailable for ${key}`,
			});
			continue;
		}
		usageByProfile.set(key, result);
	}
	return { usageByProfile, diagnostics };
}

export function usageFromPayload(payload: unknown): AccountUsage {
	const parsed = UsageSchema.safeParse(payload);
	if (parsed.success === false) {
		throw new Error("usage response has an unexpected shape");
	}
	const rateLimit = parsed.data.rate_limit;
	return {
		primary: usageWindow(rateLimit.primary_window),
		secondary: usageWindow(rateLimit.secondary_window),
	};
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

async function requestUsage(entry: JsonObject): Promise<AccountUsage> {
	const accessToken = typeof entry.access === "string" ? entry.access : null;
	const accountId = accountIdForEntry(entry);
	if (accessToken === null || accountId === null) {
		throw new Error("Codex profile is missing usage credentials");
	}
	try {
		const response = await fetch(usageUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"ChatGPT-Account-Id": accountId,
			},
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
		if (response.ok === false) {
			throw new Error(`usage request failed with ${response.status}`);
		}
		return usageFromPayload(await response.json());
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}

function usageWindow(window: z.infer<typeof UsageWindowSchema>): UsageWindow {
	const usedPercent = window?.used_percent;
	const resetAfterSeconds = window?.reset_after_seconds;
	return {
		remainingPercent:
			usedPercent === undefined
				? null
				: Math.max(0, Math.min(100, 100 - Math.floor(usedPercent))),
		resetAt:
			resetAfterSeconds === undefined
				? null
				: new Date(Date.now() + resetAfterSeconds * 1000).toISOString(),
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
