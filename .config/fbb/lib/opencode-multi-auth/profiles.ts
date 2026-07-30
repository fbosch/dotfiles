import type { JsonObject } from "./storage.ts";
import type { AccountDiscovery, AccountProfile, Diagnostic } from "./types.ts";

export function discoveryDiagnostics(profiles: AccountProfile[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const seenAccounts = new Set<string>();
	const seenAliases = new Set<string>();
	const seenLabels = new Map<string, string>();

	for (const profile of profiles) {
		if (profile.accountId === null) {
			diagnostics.push({
				code: "account-identity-unresolved",
				message: `unable to resolve account identity for ${profile.key}`,
			});
			continue;
		}
		if (seenAccounts.has(profile.accountId)) {
			diagnostics.push({
				code: "duplicate-account-profile",
				message: `duplicate account profile: ${profile.key}`,
			});
		}
		seenAccounts.add(profile.accountId);

		if (profile.generatedLabel) {
			const existing = seenLabels.get(profile.generatedLabel);
			if (existing && existing !== profile.accountId) {
				diagnostics.push({
					code: "generated-label-collision",
					message: `generated label collision: ${profile.generatedLabel}`,
				});
			}
			seenLabels.set(profile.generatedLabel, profile.accountId);
		}
		if (profile.alias && seenAliases.has(profile.alias)) {
			diagnostics.push({
				code: "duplicate-alias",
				message: `duplicate account alias: ${profile.alias}`,
			});
		}
		if (profile.alias) {
			seenAliases.add(profile.alias);
		}
	}

	return diagnostics;
}

export function compareProfiles(
	left: AccountProfile,
	right: AccountProfile,
): number {
	if (left.active !== right.active) {
		return left.active ? -1 : 1;
	}
	return left.key.localeCompare(right.key, undefined, { numeric: true });
}

export function normalizeAlias(alias: string): string {
	const normalized = alias.trim();
	if (normalized === "" || /[\r\n]/.test(normalized)) {
		throw new Error("account alias must be a non-empty single line");
	}
	return normalized;
}

export function aliasLabel(aliases: JsonObject, alias: string): string | null {
	const labels = Object.entries(aliases)
		.filter(([, value]) => value === alias)
		.map(([label]) => label);
	if (labels.length > 1) {
		throw new Error(`account alias is not unique: ${alias}`);
	}
	return labels[0] || null;
}

export function deleteAliasesForValue(
	aliases: JsonObject,
	alias: string,
): void {
	for (const [label, value] of Object.entries(aliases)) {
		if (value === alias) {
			delete aliases[label];
		}
	}
}

export function assertMutableDiscovery(discovery: AccountDiscovery): void {
	if (discovery.diagnostics.length > 0) {
		throw new Error("profiles must be resolved and unique before mutation");
	}
}
