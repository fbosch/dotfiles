import { isJsonObject, type JsonObject } from "./storage.ts";
import type { AccountDiscovery, AccountProfile, Diagnostic } from "./types.ts";

const adjectives = [
	"ember",
	"cobalt",
	"amber",
	"jade",
	"coral",
	"indigo",
	"silver",
	"scarlet",
	"atlas",
	"lotus",
	"cedar",
	"pine",
	"aurora",
	"frost",
	"orbit",
	"dune",
	"maple",
	"zenith",
];

const nouns = [
	"falcon",
	"otter",
	"comet",
	"harbor",
	"meadow",
	"emberfox",
	"lynx",
	"kestrel",
	"glacier",
	"thicket",
	"river",
	"moss",
	"canyon",
	"beacon",
	"auroraforge",
	"wave",
	"ridge",
];

export function profileFromEntry(
	key: string,
	value: unknown,
	aliases: JsonObject,
): AccountProfile {
	if (isJsonObject(value) === false) {
		return {
			key,
			accountId: null,
			generatedLabel: null,
			alias: null,
			active: key === "openai",
		};
	}

	const accountId = accountIdForEntry(value);
	const generatedLabel = accountId ? generatedLabelFor(accountId) : null;
	const alias =
		generatedLabel && typeof aliases[generatedLabel] === "string"
			? aliases[generatedLabel]
			: null;
	return { key, accountId, generatedLabel, alias, active: key === "openai" };
}

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
				message: `duplicate OpenAI alias: ${profile.alias}`,
			});
		}
		if (profile.alias) {
			seenAliases.add(profile.alias);
		}
	}

	return diagnostics;
}

export function accountIdForEntry(entry: JsonObject): string | null {
	const explicitId = normalizedString(entry.accountId);
	const tokenId = accountIdFromAccessToken(entry.access);
	if (explicitId && tokenId && explicitId !== tokenId) {
		return null;
	}
	return explicitId || tokenId;
}

export function generatedLabelFor(accountId: string): string {
	const seed = accountId.replace(/[^0-9a-fA-F]/g, "") || "00";
	return `${adjectives[byteAt(seed, 0) % adjectives.length]}-${nouns[byteAt(seed, 2) % nouns.length]}-${accountId.slice(-4)}`;
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

export function requireOpenAIAliases(
	aliases: JsonObject,
	path: string,
): JsonObject {
	if (isJsonObject(aliases.openai) === false) {
		throw new Error(`invalid OpenAI aliases in ${path}`);
	}
	return aliases.openai;
}

export function normalizeAlias(alias: string): string {
	const normalized = alias.trim();
	if (normalized === "" || /[\r\n]/.test(normalized)) {
		throw new Error("OpenAI alias must be a non-empty single line");
	}
	return normalized;
}

export function aliasLabel(aliases: JsonObject, alias: string): string | null {
	const labels = Object.entries(aliases)
		.filter(([, value]) => value === alias)
		.map(([label]) => label);
	if (labels.length > 1) {
		throw new Error(`OpenAI alias is not unique: ${alias}`);
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

export function nextInactiveKey(auth: JsonObject): string {
	let index = 1;
	while (`openai_${index}` in auth) {
		index += 1;
	}
	return `openai_${index}`;
}

export function assertMutableDiscovery(discovery: AccountDiscovery): void {
	if (discovery.diagnostics.length > 0) {
		throw new Error(
			"OpenAI profiles must be resolved and unique before mutation",
		);
	}
}

function accountIdFromAccessToken(access: unknown): string | null {
	if (typeof access !== "string") {
		return null;
	}
	const payload = access.split(".")[1];
	if (payload === undefined) {
		return null;
	}
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as unknown;
		if (
			isJsonObject(claims) === false ||
			isJsonObject(claims["https://api.openai.com/auth"]) === false
		) {
			return null;
		}
		return normalizedString(
			claims["https://api.openai.com/auth"].chatgpt_account_id,
		);
	} catch {
		return null;
	}
}

function byteAt(seed: string, offset: number): number {
	return Number.parseInt(seed.slice(offset, offset + 2) || "00", 16);
}

function normalizedString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
