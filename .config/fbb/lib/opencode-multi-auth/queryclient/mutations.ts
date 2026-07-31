import { randomUUID } from "node:crypto";
import type { MutationOptions } from "@tanstack/query-core";
import { z } from "zod";
import type { AccountPaths } from "../types.ts";
import {
	resetRequestHeaders,
	type ResetCredentials,
} from "./queries/reset-credits.ts";
import { accountQueryKey, queryClientFor } from "./client.ts";
import { optionalDateSchema, terminalTextSchema } from "./schemas.ts";

const resetCreditsUrl =
	"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const requestTimeoutMs = 10_000;
const ConsumeResponseSchema = z.object({
	code: terminalTextSchema.optional(),
	windows_reset: z.number().finite().optional(),
	credit: z
		.object({
			redeemed_at: optionalDateSchema,
		})
		.optional(),
});

type ConsumeResetCreditVariables = {
	credentials: ResetCredentials;
	creditId: string;
};

export type ConsumeResetCreditData = {
	code: string | null;
	windowsReset: number | null;
	redeemedAt: string | null;
};

export async function mutateAccount<T>(
	paths: AccountPaths,
	mutationKey: string,
	mutationFn: () => Promise<T>,
): Promise<T> {
	const client = queryClientFor(paths);
	const mutation = client.queryClient
		.getMutationCache()
		.build<T, Error, void, unknown>(client.queryClient, {
			mutationKey: ["codex", "account", mutationKey],
			mutationFn,
		});
	const result = await mutation.execute(undefined);
	await invalidateAccountQueries(paths);
	return result;
}

export async function consumeResetCredit(
	paths: AccountPaths,
	credentials: ResetCredentials,
	creditId: string,
): Promise<{
	data: ConsumeResetCreditData;
	cacheInvalidationError: string | null;
}> {
	const client = queryClientFor(paths);
	const mutation = client.queryClient
		.getMutationCache()
		.build<
			ConsumeResetCreditData,
			Error,
			ConsumeResetCreditVariables,
			unknown
		>(client.queryClient, consumeResetCreditMutationOptions());
	const data = await mutation.execute({ credentials, creditId });
	try {
		await invalidateAccountQueries(paths);
		return { data, cacheInvalidationError: null };
	} catch {
		return {
			data,
			cacheInvalidationError:
				"reset credit redeemed, but cache invalidation failed",
		};
	}
}

function consumeResetCreditMutationOptions() {
	return {
		mutationKey: ["codex", "account", "consume-reset-credit"],
		mutationFn: async ({
			credentials,
			creditId,
		}: ConsumeResetCreditVariables): Promise<ConsumeResetCreditData> => {
			const response = await fetch(`${resetCreditsUrl}/consume`, {
				method: "POST",
				headers: {
					...resetRequestHeaders(credentials),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					credit_id: creditId,
					redeem_request_id: randomUUID(),
				}),
				signal: AbortSignal.timeout(requestTimeoutMs),
			});
			if (response.ok === false) {
				throw new Error(
					`reset credit consume request failed with ${response.status}`,
				);
			}
			const parsed = ConsumeResponseSchema.safeParse(await response.json());
			if (parsed.success === false) {
				throw new Error(
					"reset credit consume response has an unexpected shape",
				);
			}
			return {
				code: parsed.data.code || null,
				windowsReset: parsed.data.windows_reset ?? null,
				redeemedAt: parsed.data.credit?.redeemed_at ?? null,
			};
		},
	} satisfies MutationOptions;
}

async function invalidateAccountQueries(paths: AccountPaths): Promise<void> {
	const client = queryClientFor(paths);
	await client.queryClient.invalidateQueries({
		queryKey: accountQueryKey,
		refetchType: "none",
	});
	await client.queryPersister.removeQueries({ queryKey: accountQueryKey });
}
