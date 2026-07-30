import { z } from "zod";
import { accountIdForEntry } from "./profiles.ts";
import { readJsonObject } from "./storage.ts";
import type {
	AccountDiscovery,
	AccountUsage,
	AccountUsageDiscovery,
	OcmaPaths,
	UsageWindow,
} from "./types.ts";

const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
const requestTimeoutMs = 10_000;
const UsageWindowSchema = z
	.object({
		used_percent: z.number().finite().optional(),
		reset_after_seconds: z.number().finite().optional(),
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

export async function discoverAccountUsage(
	discovery: AccountDiscovery,
	paths: OcmaPaths,
): Promise<AccountUsageDiscovery> {
	const auth = await readJsonObject(paths.auth);
	const results = await Promise.all(
		discovery.profiles.map(async (profile) => {
			const entry = auth[profile.key];
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
				return usageFailure(profile.key);
			}
			return [
				profile.key,
				await usageForEntry(entry as Record<string, unknown>),
			] as const;
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

function usageFailure(key: string): readonly [string, Error] {
	return [key, new Error("invalid OpenAI profile")];
}

async function usageForEntry(
	entry: Record<string, unknown>,
): Promise<AccountUsage | Error> {
	const accessToken = typeof entry.access === "string" ? entry.access : null;
	const accountId = accountIdForEntry(entry);
	if (accessToken === null || accountId === null) {
		return new Error("OpenAI profile is missing usage credentials");
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
			return new Error(`usage request failed with ${response.status}`);
		}
		return usageFromPayload(await response.json());
	} catch (error) {
		return error instanceof Error ? error : new Error(String(error));
	}
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
