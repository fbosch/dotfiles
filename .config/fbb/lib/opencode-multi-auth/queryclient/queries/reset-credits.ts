import type { QueryOptions } from "@tanstack/query-core";
import { z } from "zod";
import type { AccountResetCredits } from "../../types.ts";
import {
	accountCredentialKey,
	resetCreditsCacheTimeMs,
	resetCreditsQueryKey,
} from "../client.ts";
import { optionalDateSchema, terminalTextSchema } from "../schemas.ts";

const resetCreditsUrl =
	"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const requestTimeoutMs = 10_000;
const ResetCreditSchema = z.object({
	id: terminalTextSchema.min(1),
	status: terminalTextSchema.nullish(),
	reset_type: terminalTextSchema.nullish(),
	granted_at: optionalDateSchema,
	expires_at: optionalDateSchema,
	title: terminalTextSchema.nullish(),
});
const ResetCreditsSchema = z.object({
	available_count: z.number().int().nonnegative().default(0),
	credits: z.array(ResetCreditSchema).default([]),
});

export type ResetCredentials = { accessToken: string; accountId: string };

export type DetailedResetCredit = {
	id: string;
	status: string;
	resetType: string | null;
	grantedAt: string | null;
	expiresAt: string | null;
	expiresIn: string;
	urgency: "urgent" | "soon" | "later" | "unknown";
	title: string | null;
};

export type DetailedResetCredits = {
	availableCount: number;
	credits: DetailedResetCredit[];
};

export function resetCreditsQueryOptions(credentials: ResetCredentials) {
	return {
		queryKey: [
			...resetCreditsQueryKey,
			accountCredentialKey(credentials.accountId),
		],
		queryFn: () => fetchResetCredits(credentials),
		staleTime: resetCreditsCacheTimeMs,
	} satisfies QueryOptions;
}

export async function fetchResetCredits(
	credentials: ResetCredentials,
): Promise<DetailedResetCredits> {
	const response = await fetch(resetCreditsUrl, {
		headers: resetRequestHeaders(credentials),
		signal: AbortSignal.timeout(requestTimeoutMs),
	});
	if (response.ok === false) {
		throw new Error(`reset credits request failed with ${response.status}`);
	}
	return detailedResetCreditsFromPayload(await response.json());
}

export function detailedResetCreditsFromPayload(
	payload: unknown,
): DetailedResetCredits {
	const parsed = ResetCreditsSchema.safeParse(payload);
	if (parsed.success === false) {
		throw new Error("reset credits response has an unexpected shape");
	}
	return {
		availableCount: parsed.data.available_count,
		credits: parsed.data.credits
			.map((credit) => ({
				id: credit.id,
				status: credit.status || "unknown",
				resetType: credit.reset_type ?? null,
				grantedAt: credit.granted_at ?? null,
				expiresAt: credit.expires_at ?? null,
				expiresIn: durationUntil(credit.expires_at ?? null),
				urgency: resetCreditUrgency(credit.expires_at ?? null),
				title: credit.title ?? null,
			}))
			.sort(
				(left, right) =>
					expiryTimestamp(left.expiresAt) - expiryTimestamp(right.expiresAt),
			),
	};
}

export function resetCreditsFromPayload(payload: unknown): AccountResetCredits {
	return resetCreditsSummary(detailedResetCreditsFromPayload(payload));
}

export function resetCreditsSummary(
	credits: DetailedResetCredits,
): AccountResetCredits {
	const nextCredit = selectAvailableCredit(credits.credits);
	return {
		availableCount: credits.availableCount,
		nextExpiresAt: nextCredit?.expiresAt || null,
		urgency: nextCredit?.urgency || "unknown",
	};
}

export function selectAvailableCredit(
	credits: DetailedResetCredit[],
	creditId?: string,
): DetailedResetCredit | null {
	const available = credits.filter((credit) => credit.status === "available");
	if (creditId) {
		return available.find((credit) => credit.id === creditId) || null;
	}
	return available[0] || null;
}

export function resetRequestHeaders(
	credentials: ResetCredentials,
): Record<string, string> {
	return {
		Authorization: `Bearer ${credentials.accessToken}`,
		"ChatGPT-Account-Id": credentials.accountId,
	};
}

function expiryTimestamp(expiresAt: string | null): number {
	const timestamp = expiresAt ? Date.parse(expiresAt) : Number.POSITIVE_INFINITY;
	return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function resetCreditUrgency(
	expiresAt: string | null,
): DetailedResetCredit["urgency"] {
	const milliseconds = expiryTimestamp(expiresAt) - Date.now();
	if (Number.isFinite(milliseconds) === false) return "unknown";
	if (milliseconds <= 86_400_000) return "urgent";
	if (milliseconds <= 7 * 86_400_000) return "soon";
	return "later";
}

function durationUntil(expiresAt: string | null): string {
	const timestamp = expiryTimestamp(expiresAt);
	if (Number.isFinite(timestamp) === false) return "unknown";
	if (timestamp <= Date.now()) return "expired";
	return `${Math.ceil((timestamp - Date.now()) / 86_400_000)}d`;
}
