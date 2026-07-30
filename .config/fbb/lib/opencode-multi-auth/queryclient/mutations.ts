import type { AccountPaths } from "../types.ts";
import { queryClientFor, usageQueryKey } from "./client.ts";

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
	await client.queryClient.invalidateQueries({
		queryKey: usageQueryKey,
		refetchType: "none",
	});
	await client.queryPersister.removeQueries({ queryKey: usageQueryKey });
	return result;
}
