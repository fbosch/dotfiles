import type { AccountPaths, AccountUsage } from "../types.ts";
import { queryClientFor, usageQueryKey } from "./client.ts";

export async function queryUsage(
	paths: AccountPaths,
	profileKey: string,
	request: () => Promise<AccountUsage>,
): Promise<AccountUsage> {
	const client = queryClientFor(paths);
	const usage = await client.queryClient.fetchQuery({
		queryKey: [...usageQueryKey, profileKey],
		queryFn: request,
	});
	await client.queryPersister.persistQueryByKey(
		[...usageQueryKey, profileKey],
		client.queryClient,
	);
	return usage;
}
