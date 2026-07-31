import type { QueryOptions } from "@tanstack/query-core";
import { z } from "zod";
import type { AccountUsage, UsageWindow } from "../../types.ts";
import { accountCredentialKey, usageQueryKey } from "../client.ts";

const usageUrl = "https://chatgpt.com/backend-api/wham/usage";
const requestTimeoutMs = 10_000;
const FiniteNumberSchema = z.custom<number>(
	(value) => typeof value === "number" && Number.isFinite(value),
);
const UsedPercentSchema = FiniteNumberSchema.refine(
	(value) => value >= 0 && value <= 100,
);
const maxWindowSeconds = 31_536_000;
const WindowSecondsSchema = FiniteNumberSchema.refine(
	(value) => value >= 0 && value <= maxWindowSeconds,
);
const UsageWindowSchema = z
	.object({
		used_percent: UsedPercentSchema.optional(),
		reset_after_seconds: WindowSecondsSchema.optional(),
		limit_window_seconds: WindowSecondsSchema.optional(),
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

export function usageQueryOptions(
	credentials: { accessToken: string; accountId: string },
) {
	return {
		queryKey: [...usageQueryKey, accountCredentialKey(credentials.accountId)],
		queryFn: () => fetchUsageUncached(credentials),
	} satisfies QueryOptions;
}

export async function fetchUsageUncached(credentials: {
	accessToken: string;
	accountId: string;
}): Promise<AccountUsage> {
	const response = await fetch(usageUrl, {
		headers: {
			Authorization: `Bearer ${credentials.accessToken}`,
			"ChatGPT-Account-Id": credentials.accountId,
		},
		signal: AbortSignal.timeout(requestTimeoutMs),
	});
	if (response.ok === false) {
		throw new Error(`usage request failed with ${response.status}`);
	}
	return usageFromPayload(await response.json());
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
		resetAfterSeconds: resetAfterSeconds ?? null,
		limitWindowSeconds: window?.limit_window_seconds ?? null,
	};
}
