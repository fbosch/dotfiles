import {
	compareProfiles,
	discoveryDiagnostics,
	profileFromEntry,
	requireOpenAIAliases,
} from "./profiles.ts";
import { readJsonObject } from "./storage.ts";
import { hasPendingLogin } from "./transactions.ts";
import type {
	AccountDiscovery,
	OcmaPaths,
	PublicAccountDiscovery,
} from "./types.ts";

export async function discoverAccounts(
	paths: OcmaPaths,
): Promise<AccountDiscovery> {
	const [auth, aliases] = await Promise.all([
		readJsonObject(paths.auth),
		readJsonObject(paths.aliases),
	]);
	const openaiAliases = requireOpenAIAliases(aliases, paths.aliases);
	const profiles = Object.entries(auth)
		.filter(([key]) => key === "openai" || key.startsWith("openai_"))
		.map(([key, value]) => profileFromEntry(key, value, openaiAliases))
		.sort(compareProfiles);
	const diagnostics = discoveryDiagnostics(profiles);
	if (profiles.some((profile) => profile.active) === false) {
		diagnostics.push({
			code: "active-profile-missing",
			message: "active OpenAI profile is missing",
		});
	}
	if (await hasPendingLogin(paths)) {
		diagnostics.push({
			code: "login-transaction-pending",
			message: "an interrupted OpenAI login requires recovery before mutation",
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
