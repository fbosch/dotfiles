import { compareProfiles, discoveryDiagnostics } from "./profiles.ts";
import { aliasesFor, profilesFromAuth } from "./providers/codex.ts";
import { readJsonObject } from "./storage.ts";
import { hasPendingLogin } from "./transactions.ts";
import type {
	AccountDiscovery,
	AccountPaths,
	PublicAccountDiscovery,
} from "./types.ts";

export async function discoverAccounts(
	paths: AccountPaths,
): Promise<AccountDiscovery> {
	const [auth, aliases] = await Promise.all([
		readJsonObject(paths.auth),
		readJsonObject(paths.aliases),
	]);
	const profiles = profilesFromAuth(
		auth,
		aliasesFor(aliases, paths.aliases),
	).sort(compareProfiles);
	const diagnostics = discoveryDiagnostics(profiles);
	if (profiles.some((profile) => profile.active) === false) {
		diagnostics.push({
			code: "active-profile-missing",
			message: "active profile is missing",
		});
	}
	if (await hasPendingLogin(paths)) {
		diagnostics.push({
			code: "login-transaction-pending",
			message: "an interrupted login requires recovery before mutation",
		});
	}
	return { profiles, diagnostics };
}

export function toPublicDiscovery(
	discovery: AccountDiscovery,
): PublicAccountDiscovery {
	return {
		profiles: discovery.profiles.map(({ accountId: _, ...profile }) => profile),
		diagnostics: discovery.diagnostics,
	};
}
