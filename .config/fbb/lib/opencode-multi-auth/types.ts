import { join } from "node:path";

export type AccountPaths = {
	auth: string;
	aliases: string;
	state?: string;
	legacyState?: string;
};

export type AccountProfile = {
	key: string;
	accountId: string | null;
	generatedLabel: string | null;
	alias: string | null;
	active: boolean;
};

export type AccountDiscovery = {
	profiles: AccountProfile[];
	diagnostics: Diagnostic[];
};

export type Diagnostic = {
	code: string;
	message: string;
};

export type PublicAccountProfile = Omit<AccountProfile, "accountId">;

export type PublicAccountDiscovery = {
	profiles: PublicAccountProfile[];
	diagnostics: Diagnostic[];
};

export type UsageWindow = {
	remainingPercent: number | null;
	resetAt: string | null;
};

export type AccountUsage = {
	primary: UsageWindow;
	secondary: UsageWindow;
};

export type AccountUsageDiscovery = {
	usageByProfile: Map<string, AccountUsage>;
	diagnostics: Diagnostic[];
};

export type PublicAccountListProfile = PublicAccountProfile & {
	usage: AccountUsage | null;
};

export type MutationLock = {
	release: () => Promise<void>;
};

export function defaultPaths(
	env: NodeJS.ProcessEnv = process.env,
): AccountPaths {
	const home = env.HOME || "";
	const dataHome = env.XDG_DATA_HOME || join(home, ".local", "share");
	const configHome = env.XDG_CONFIG_HOME || join(home, ".config");
	const stateHome = env.XDG_STATE_HOME || join(home, ".local", "state");

	return {
		auth: join(dataHome, "opencode", "auth.json"),
		aliases: join(configHome, "fbb", "data", "account-aliases.json"),
		state: join(stateHome, "fbb", "openai-accounts", "login-transaction.json"),
		legacyState: join(stateHome, "fbb", "ocma", "login-transaction.json"),
	};
}
