import { z } from "zod";
import type { AccountResetCredits } from "../../types.ts";
import { resetCreditsCacheTimeMs, resetCreditsQueryKey } from "../client.ts";

const resetCreditsUrl =
	"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const requestTimeoutMs = 10_000;
const ResetCreditSchema = z.object({
	status: z.string().nullish(),
	expires_at: z.string().nullish(),
});
const ResetCreditsSchema = z.object({
	available_count: z.number().nonnegative().default(0),
	credits: z.array(ResetCreditSchema).default([]),
});

export function resetCreditsQueryOptions(
	profileKey: string,
	credentials: { accessToken: string; accountId: string },
) {
	return {
		queryKey: [...resetCreditsQueryKey, profileKey],
		queryFn: async (): Promise<AccountResetCredits> => {
			const response = await fetch(resetCreditsUrl, {
				headers: {
					Authorization: `Bearer ${credentials.accessToken}`,
					"ChatGPT-Account-Id": credentials.accountId,
				},
				signal: AbortSignal.timeout(requestTimeoutMs),
			});
			if (response.ok === false) {
				throw new Error(`reset credits request failed with ${response.status}`);
			}
			return resetCreditsFromPayload(await response.json());
		},
		staleTime: resetCreditsCacheTimeMs,
	};
}

export function resetCreditsFromPayload(payload: unknown): AccountResetCredits {
	const parsed = ResetCreditsSchema.safeParse(payload);
	if (parsed.success === false) {
		throw new Error("reset credits response has an unexpected shape");
	}
	const nextExpiresAt = parsed.data.credits
		.filter((credit) => credit.status === "available")
		.map((credit) => credit.expires_at)
		.filter((expiresAt): expiresAt is string => expiresAt !== null)
		.sort((left, right) => Date.parse(left) - Date.parse(right))[0];
	return {
		availableCount: parsed.data.available_count,
		nextExpiresAt: nextExpiresAt || null,
		urgency: resetCreditUrgency(nextExpiresAt || null),
	};
}

function resetCreditUrgency(
	nextExpiresAt: string | null,
): AccountResetCredits["urgency"] {
	if (nextExpiresAt === null) {
		return "unknown";
	}
	const milliseconds = Date.parse(nextExpiresAt) - Date.now();
	if (Number.isNaN(milliseconds)) {
		return "unknown";
	}
	if (milliseconds <= 86_400_000) {
		return "urgent";
	}
	if (milliseconds <= 7 * 86_400_000) {
		return "soon";
	}
	return "later";
}
