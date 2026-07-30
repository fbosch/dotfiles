import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProgressBar } from "../../progress-bar.ts";
import { discoverAccounts, toPublicDiscovery } from "../discovery.ts";
import { renderAccountCards } from "../list-presentation.ts";
import { beginLogin, completeLogin, switchAccount } from "../mutations.ts";
import { usageFromPayload } from "../providers/codex.ts";
import { mutateAccount } from "../queryclient/mutations.ts";
import { queryUsage } from "../queryclient/usage.ts";
import { recoverPendingLogin } from "../transactions.ts";
import type { AccountPaths } from "../types.ts";

async function fixturePaths(
	auth: unknown,
	aliases: unknown,
): Promise<AccountPaths> {
	const root = await mkdtemp(join(tmpdir(), "openai-accounts-"));
	const authPath = join(root, "auth.json");
	const aliasesPath = join(root, "account-aliases.json");
	await mkdir(root, { recursive: true });
	await Promise.all([
		writeFile(authPath, JSON.stringify(auth)),
		writeFile(aliasesPath, JSON.stringify(aliases)),
	]);
	return {
		auth: authPath,
		aliases: aliasesPath,
		state: join(root, "state", "login-transaction.json"),
		queryCacheDirectory: join(root, "cache", "queries"),
	};
}

async function readAuth(paths: AccountPaths): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(paths.auth, "utf8")) as Record<
		string,
		unknown
	>;
}

test("discovers aliases without exposing account IDs in public output", async () => {
	const paths = await fixturePaths(
		{
			openai: { accountId: "00000000-0000-0000-0000-00000000abcd" },
			openai_2: { accountId: "11000000-0000-0000-0000-000000001234" },
			anthropic: { accountId: "ignored" },
		},
		{
			openai: {
				"ember-falcon-abcd": "main",
			},
		},
	);

	const discovery = await discoverAccounts(paths);

	expect(discovery.diagnostics).toEqual([]);
	expect(discovery.profiles).toHaveLength(2);
	expect(discovery.profiles[0]).toMatchObject({
		key: "openai",
		accountId: "00000000-0000-0000-0000-00000000abcd",
		generatedLabel: "ember-falcon-abcd",
		alias: "main",
		active: true,
	});
	expect(toPublicDiscovery(discovery)).toEqual({
		profiles: [
			{
				key: "openai",
				generatedLabel: "ember-falcon-abcd",
				alias: "main",
				active: true,
			},
			{
				key: "openai_2",
				generatedLabel: "zenith-falcon-1234",
				alias: null,
				active: false,
			},
		],
		diagnostics: [],
	});
});

test("reports duplicate account profiles", async () => {
	const paths = await fixturePaths(
		{
			openai: { accountId: "00000000-0000-0000-0000-00000000abcd" },
			openai_1: { accountId: "00000000-0000-0000-0000-00000000abcd" },
		},
		{ openai: {} },
	);

	const discovery = await discoverAccounts(paths);

	expect(discovery.diagnostics).toEqual([
		{
			code: "duplicate-account-profile",
			message: "duplicate account profile: openai_1",
		},
	]);
});

test("switches an inactive alias into the active OpenAI profile", async () => {
	const paths = await fixturePaths(
		{
			openai: { accountId: "00000000-0000-0000-0000-00000000abcd" },
			openai_1: { accountId: "11000000-0000-0000-0000-000000001234" },
		},
		{ openai: { "ember-falcon-abcd": "main", "zenith-falcon-1234": "work" } },
	);

	const discovery = await switchAccount("work", paths);

	expect(discovery.profiles[0]).toMatchObject({
		key: "openai",
		alias: "work",
		active: true,
	});
	expect(await readAuth(paths)).toEqual({
		openai: { accountId: "11000000-0000-0000-0000-000000001234" },
		openai_1: { accountId: "00000000-0000-0000-0000-00000000abcd" },
	});
});

test("replaces an alias while retaining the prior active profile", async () => {
	const paths = await fixturePaths(
		{
			openai: { accountId: "00000000-0000-0000-0000-00000000abcd" },
			openai_1: { accountId: "11000000-0000-0000-0000-000000001234" },
		},
		{ openai: { "ember-falcon-abcd": "main", "zenith-falcon-1234": "work" } },
	);

	await beginLogin("work", paths);
	await writeFile(
		paths.auth,
		JSON.stringify({
			...(await readAuth(paths)),
			openai: { accountId: "22000000-0000-0000-0000-00000000beef" },
		}),
	);
	const discovery = await completeLogin(paths);

	expect(discovery.profiles).toEqual([
		{
			key: "openai",
			accountId: "22000000-0000-0000-0000-00000000beef",
			displayColor: 39,
			generatedLabel: "maple-falcon-beef",
			alias: "work",
			active: true,
		},
		{
			key: "openai_2",
			accountId: "00000000-0000-0000-0000-00000000abcd",
			displayColor: 39,
			generatedLabel: "ember-falcon-abcd",
			alias: "main",
			active: false,
		},
	]);
	expect(await readAuth(paths)).toEqual({
		openai: { accountId: "22000000-0000-0000-0000-00000000beef" },
		openai_2: { accountId: "00000000-0000-0000-0000-00000000abcd" },
	});
});

test("recovers an interrupted login without changing aliases", async () => {
	const paths = await fixturePaths(
		{ openai: { accountId: "00000000-0000-0000-0000-00000000abcd" } },
		{ openai: { "ember-falcon-abcd": "main" } },
	);

	await beginLogin("work", paths);
	await writeFile(
		paths.auth,
		JSON.stringify({
			...(await readAuth(paths)),
			openai: { accountId: "22000000-0000-0000-0000-00000000beef" },
		}),
	);
	expect(await recoverPendingLogin(paths)).toBe(true);

	expect(await readAuth(paths)).toEqual({
		openai: { accountId: "00000000-0000-0000-0000-00000000abcd" },
	});
	expect(await discoverAccounts(paths)).toMatchObject({
		profiles: [{ key: "openai", alias: "main", active: true }],
		diagnostics: [],
	});
});

test("formats usage windows without exposing credentials", () => {
	const usage = usageFromPayload({
		rate_limit: {
			primary_window: { used_percent: 23.7, reset_after_seconds: 60 },
			secondary_window: { used_percent: 100, reset_after_seconds: 3_600 },
		},
	});

	expect(usage).toMatchObject({
		primary: { remainingPercent: 77 },
		secondary: { remainingPercent: 0 },
	});
	expect(usage.primary.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	expect(usage.secondary.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("rejects malformed usage payloads", () => {
	expect(() =>
		usageFromPayload({
			rate_limit: { primary_window: { used_percent: "nope" } },
		}),
	).toThrow("usage response has an unexpected shape");
});

test("caches usage until account mutations invalidate it", async () => {
	const paths = await fixturePaths({}, { openai: {} });
	const usage = {
		primary: { remainingPercent: 75, resetAt: null },
		secondary: { remainingPercent: null, resetAt: null },
	};
	let requests = 0;
	const request = async () => {
		requests += 1;
		return usage;
	};

	expect(await queryUsage(paths, "openai", request)).toEqual(usage);
	expect(await queryUsage(paths, "openai", request)).toEqual(usage);
	expect(requests).toBe(1);
	expect(await readdir(paths.queryCacheDirectory || "")).toHaveLength(1);

	await mutateAccount(paths, "test", async () => undefined);
	expect(await readdir(paths.queryCacheDirectory || "")).toHaveLength(0);
	expect(await queryUsage(paths, "openai", request)).toEqual(usage);
	expect(requests).toBe(2);
});

test("renders compact quota cards with Unicode partial-block progress", () => {
	const cards = renderAccountCards(
		[
			{
				key: "openai",
				displayColor: 39,
				generatedLabel: "ember-falcon-abcd",
				alias: "main",
				active: true,
				usage: {
					primary: { remainingPercent: 75, resetAt: null },
					secondary: { remainingPercent: null, resetAt: null },
				},
			},
		],
		{ colorEnabled: false, plain: false, columns: 80 },
	);

	expect(cards).toContain("OpenAI accounts (1)");
	expect(cards).toContain("* main active [openai]");
	expect(cards).toContain("━━━━━━━━━━╸─── 75% remaining");
	expect(cards).toContain("secondary  unavailable");
});

test("renders a terminal-safe empty state in plain output", () => {
	const cards = renderAccountCards([], {
		colorEnabled: false,
		plain: true,
		columns: 20,
	});

	expect(cards).toBe(
		"OpenAI accounts (0)\nInfo     No accounts found.\n  Run `ocma login <alias>` to add an account.",
	);
});

test("escapes control characters and stacks narrow account cards", () => {
	const cards = renderAccountCards(
		[
			{
				key: "openai_\u001b[2J",
				displayColor: null,
				generatedLabel: null,
				alias: "work\u0007",
				active: false,
				usage: null,
			},
		],
		{ colorEnabled: false, plain: false, columns: 20 },
	);

	expect(cards).toContain("work\\x07 inactive");
	expect(cards).toContain("    openai_\\x1b[2J");
	expect(cards).not.toContain("\u001b");
});

test("renders progress with partial Unicode blocks", () => {
	expect(renderProgressBar(75)).toEqual({
		fullCells: 10,
		partialCell: "╸",
		emptyCells: 3,
	});
	expect(renderProgressBar(150, 2)).toEqual({
		fullCells: 2,
		partialCell: "",
		emptyCells: 0,
	});
});
