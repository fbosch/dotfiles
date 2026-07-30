import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderProgressBar } from "../../progress-bar.ts";
import { discoverAccounts, toPublicDiscovery } from "../discovery.ts";
import { renderAccountCards } from "../list-presentation.ts";
import { beginLogin, completeLogin, switchAccount } from "../mutations.ts";
import { fetchUsage } from "../providers/codex.ts";
import { accountQueryKey, queryClientFor } from "../queryclient/client.ts";
import {
	consumeResetCredit,
	mutateAccount,
} from "../queryclient/mutations.ts";
import {
	detailedResetCreditsFromPayload,
	resetCreditsFromPayload,
	selectAvailableCredit,
} from "../queryclient/queries/reset-credits.ts";
import {
	resetProfilesFromLegacyAuth,
	resetProfilesFromOpenCodeAuth,
	resetStatus,
} from "../reset.ts";
import {
	renderResetConsume,
	renderResetPreview,
	renderResetStatus,
} from "../reset-presentation.ts";
import {
	usageFromPayload,
	usageQueryOptions,
} from "../queryclient/queries/usage.ts";
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
			primary_window: {
				used_percent: 23.7,
				reset_after_seconds: 60,
				limit_window_seconds: 18_000,
			},
			secondary_window: { used_percent: 100, reset_after_seconds: 3_600 },
		},
	});

	expect(usage).toMatchObject({
		primary: { remainingPercent: 77 },
		secondary: { remainingPercent: 0 },
	});
	expect(usage.primary.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	expect(usage.primary.limitWindowSeconds).toBe(18_000);
	expect(usage.secondary.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("rejects malformed usage payloads", () => {
	expect(() =>
		usageFromPayload({
			rate_limit: { primary_window: { used_percent: "nope" } },
		}),
	).toThrow("usage response has an unexpected shape");
	expect(() =>
		usageFromPayload({
			rate_limit: { primary_window: { used_percent: -1 } },
		}),
	).toThrow("usage response has an unexpected shape");
	expect(() =>
		usageFromPayload({
			rate_limit: { primary_window: { used_percent: 101 } },
		}),
	).toThrow("usage response has an unexpected shape");
	expect(() =>
		usageFromPayload({
			rate_limit: { primary_window: { reset_after_seconds: -1 } },
		}),
	).toThrow("usage response has an unexpected shape");
	expect(() =>
		usageFromPayload({
			rate_limit: {
				primary_window: { reset_after_seconds: Number.MAX_VALUE },
			},
		}),
	).toThrow("usage response has an unexpected shape");
});

test("caches usage until account mutations invalidate it", async () => {
	const paths = await fixturePaths({}, { openai: {} });
	const payload = {
		rate_limit: {
			primary_window: { used_percent: 25 },
			secondary_window: null,
		},
	};
	let requests = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		requests += 1;
		return Response.json(payload);
	}) as unknown as typeof fetch;

	try {
		const queryClient = queryClientFor(paths).queryClient;
		const options = usageQueryOptions({
			accessToken: "token",
			accountId: "account",
		});
		expect(await queryClient.fetchQuery(options)).toMatchObject({
			primary: { remainingPercent: 75 },
		});
		expect(await queryClient.fetchQuery(options)).toMatchObject({
			primary: { remainingPercent: 75 },
		});
		expect(requests).toBe(1);
		await Bun.sleep(10);
		expect(await readdir(paths.queryCacheDirectory || "")).toHaveLength(1);
		expect(
			await fetchUsage(
				{ accessToken: "token", accountId: "account" },
				paths,
				true,
			),
		).toMatchObject({ primary: { remainingPercent: 75 } });
		expect(requests).toBe(2);

		await mutateAccount(paths, "test", async () => undefined);
		expect(await readdir(paths.queryCacheDirectory || "")).toHaveLength(0);
		expect(await queryClient.fetchQuery(options)).toMatchObject({
			primary: { remainingPercent: 75 },
		});
		expect(requests).toBe(3);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("summarizes available reset credits without exposing their IDs", () => {
	expect(
		resetCreditsFromPayload({
		available_count: 2,
		credits: [
			{
				id: "later",
				status: "available",
				expires_at: "2099-01-08T00:00:00.000Z",
			},
			{
				id: "first",
				status: "available",
				expires_at: "2099-01-01T00:00:00.000Z",
			},
			{
				id: "redeemed",
				status: "redeemed",
				expires_at: "2099-01-02T00:00:00.000Z",
			},
			],
		}),
	).toEqual({
		availableCount: 2,
		nextExpiresAt: "2099-01-01T00:00:00.000Z",
		urgency: "later",
	});
});

test("normalizes detailed reset credits and selects the earliest available credit", () => {
	const credits = detailedResetCreditsFromPayload({
		available_count: 2,
		credits: [
			{
				id: "later",
				status: "available",
				reset_type: "primary",
				granted_at: "2099-01-01T00:00:00.000Z",
				expires_at: "2099-01-08T00:00:00.000Z",
				title: "Reset primary",
				extra: "stripped",
			},
			{
				id: "first",
				status: "available",
				reset_type: null,
				granted_at: null,
				expires_at: "2099-01-01T00:00:00.000Z",
				title: null,
			},
			{
				id: "spent",
				status: "redeemed",
				reset_type: "primary",
				granted_at: "2099-01-01T00:00:00.000Z",
				expires_at: "2099-01-02T00:00:00.000Z",
				title: "Spent",
			},
		],
	});

	expect(credits.credits.find((credit) => credit.id === "later")).toMatchObject({
		id: "later",
		resetType: "primary",
		grantedAt: "2099-01-01T00:00:00.000Z",
		expiresAt: "2099-01-08T00:00:00.000Z",
	});
	expect(selectAvailableCredit(credits.credits)?.id).toBe("first");
	expect(selectAvailableCredit(credits.credits, "spent")).toBeNull();
	expect(selectAvailableCredit(credits.credits, "later")?.id).toBe("later");
});

test("resolves reset profiles from OpenCode auth without serializing account IDs", () => {
	const profiles = resetProfilesFromOpenCodeAuth(
		{
			openai: { access: "active-secret", accountId: "account-active-abcd" },
			openai_1: { access: "inactive-secret", accountId: "account-other-1234" },
		},
		{ "ember-falcon-abcd": "main" },
	);

	expect(profiles).toMatchObject([
		{ key: "openai", active: true },
		{ key: "openai_1", active: false },
	]);
	const publicProfiles = profiles.map(({ credentials: _, ...profile }) => profile);
	expect(JSON.stringify(publicProfiles)).not.toContain("account-active-abcd");
	expect(JSON.stringify(publicProfiles)).not.toContain("active-secret");
});

test("deduplicates the active account in legacy reset profiles", async () => {
	const root = await mkdtemp(join(tmpdir(), "legacy-reset-profiles-"));
	const authPath = join(root, "auth.json");
	await Promise.all([
		writeFile(
			authPath,
			JSON.stringify({ access_token: "active", account_id: "account-active" }),
		),
		writeFile(
			join(root, "auth-profiles.json"),
			JSON.stringify({
				profiles: {
					active: {
						tokens: {
							access_token: "duplicate",
							account_id: "account-active",
						},
					},
					other: {
						tokens: {
							access_token: "other",
							account_id: "account-other",
						},
					},
				},
			}),
		),
	]);

	const profiles = await resetProfilesFromLegacyAuth(authPath, {});

	expect(profiles).toHaveLength(2);
	expect(profiles.map((profile) => profile.credentials?.accountId)).toEqual([
		"account-active",
		"account-other",
	]);
});

test("refreshes reset credits and usage together", async () => {
	const paths = await fixturePaths({}, {});
	let usageRequests = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.endsWith("/wham/usage")) {
			usageRequests += 1;
			return Response.json({
				rate_limit: {
					primary_window: { used_percent: usageRequests === 1 ? 10 : 20 },
				},
			});
		}
		return Response.json({ available_count: 0, credits: [] });
	}) as typeof fetch;
	const profiles = [
		{
			key: "openai",
			profileLabel: "main",
			active: true,
			credentials: { accessToken: "secret", accountId: "account" },
			error: null,
		},
	];

	try {
		expect((await resetStatus(profiles, paths, false)).active.usage[0]?.remaining).toBe(90);
		expect((await resetStatus(profiles, paths, true)).active.usage[0]?.remaining).toBe(80);
		expect(usageRequests).toBe(2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects terminal control characters in reset-credit details", () => {
	expect(() =>
		detailedResetCreditsFromPayload({
			available_count: 1,
			credits: [
				{
					id: "credit",
					status: "available",
					title: "forged\nrow",
				},
			],
		}),
	).toThrow("reset credits response has an unexpected shape");
});

test("validates consume responses and sends a unique redemption request", async () => {
	const paths = await fixturePaths({}, {});
	const queryClient = queryClientFor(paths).queryClient;
	const associatedQueryKey = [...accountQueryKey, "mutation-test"];
	queryClient.setQueryData(associatedQueryKey, "cached");
	const originalFetch = globalThis.fetch;
	let request: Request | null = null;
	globalThis.fetch = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		request = new Request(input, init);
		return Response.json({
			code: "redeemed",
			windows_reset: 2,
			credit: { redeemed_at: "2099-01-01T00:00:00.000Z" },
			extra: "stripped",
		});
	}) as unknown as typeof fetch;

	try {
		expect(
			await consumeResetCredit(
				paths,
				{ accessToken: "secret", accountId: "account" },
				"credit",
			),
		).toEqual({
			data: {
				code: "redeemed",
				windowsReset: 2,
				redeemedAt: "2099-01-01T00:00:00.000Z",
			},
			cacheInvalidationError: null,
		});
		const capturedRequest = request as Request | null;
		expect(capturedRequest).not.toBeNull();
		if (capturedRequest === null) {
			throw new Error("consume request was not captured");
		}
		expect(capturedRequest.method).toBe("POST");
		expect(capturedRequest.url).toBe(
			"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
		);
		expect(capturedRequest.headers.get("Authorization")).toBe("Bearer secret");
		expect(capturedRequest.headers.get("ChatGPT-Account-Id")).toBe("account");
		const body = (await capturedRequest.json()) as Record<string, string>;
		expect(body.credit_id).toBe("credit");
		expect(body.redeem_request_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(queryClient.getQueryState(associatedQueryKey)?.isInvalidated).toBe(true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("rejects malformed reset-credit consume responses", async () => {
	const paths = await fixturePaths({}, {});
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		Response.json({ windows_reset: "invalid" })) as unknown as typeof fetch;
	try {
		await expect(
			consumeResetCredit(
				paths,
				{ accessToken: "secret", accountId: "account" },
				"credit",
			),
		).rejects.toThrow("reset credit consume response has an unexpected shape");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("accepts consume responses with omitted optional result fields", async () => {
	const paths = await fixturePaths({}, {});
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
	try {
		expect(
			await consumeResetCredit(
				paths,
				{ accessToken: "secret", accountId: "account" },
				"credit",
			),
		).toEqual({
			data: { code: null, windowsReset: null, redeemedAt: null },
			cacheInvalidationError: null,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("renders reset status as account cards with credit details", () => {
	const output = renderResetStatus(
		{
			active: {
				profileLabel: "main",
				availableCount: 1,
				credits: [
					{
						id: "credit-1",
						status: "available",
						resetType: "codex_rate_limits",
						grantedAt: null,
						expiresAt: "2099-01-01T00:00:00.000Z",
						expiresIn: "2d",
						urgency: "soon",
						title: "Full reset",
					},
				],
				usage: [
					{
						name: "primary",
						remaining: 75,
						window: "7d",
						resetsIn: "2d",
						resetsAt: "2099-01-01T00:00:00.000Z",
					},
				],
				error: null,
			},
			accounts: [
				{
					profileLabel: "main",
					availableCount: 1,
					urgency: "soon",
					active: true,
					error: null,
				},
			],
		},
		{ colorEnabled: false, plain: false },
	);

	expect(output).toContain("* main active");
	expect(output).toContain("reset tokens  1 available");
	expect(output).toContain("reset credit  available");
	expect(output).toContain("ID credit-1");
});

test("renders reset preview and consume results", () => {
	expect(
		renderResetPreview(
			{ profileLabel: "main", credit: null },
			{ colorEnabled: false, plain: true },
		),
	).toBe("Info     No available reset credits.");
	expect(
		renderResetConsume(
			{
				profileLabel: "main",
				code: "redeemed",
				windowsReset: 2,
				redeemedAt: "2099-01-01T00:00:00.000Z",
			},
			{ colorEnabled: false, plain: false },
		),
	).toContain("* main active\n  reset credit  redeemed");
	expect(
		renderResetConsume(
			{
				profileLabel: "main",
				displayColor: 39,
				code: null,
				windowsReset: null,
				redeemedAt: null,
			},
			{ colorEnabled: true, plain: false },
		),
	).toContain("\u001b[1;38;5;39mmain\u001b[0m");
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
				resetCredits: {
					availableCount: 2,
					nextExpiresAt: "2099-01-01T00:00:00.000Z",
					urgency: "later",
				},
			},
		],
		{ colorEnabled: false, plain: false, columns: 80 },
	);

	expect(cards).toContain("* main active");
	expect(cards).toContain("━━━━━━━━━━╸─── 75% remaining");
	expect(cards).toContain("secondary  unavailable");
	expect(cards).toMatch(/reset tokens  2 available  expires in \d+d/);
});

test("renders reset tokens in narrow account cards", () => {
	const cards = renderAccountCards(
		[
			{
				key: "openai",
				displayColor: null,
				generatedLabel: "ember-falcon-abcd",
				alias: "main",
				active: true,
				usage: null,
				resetCredits: {
					availableCount: 0,
					nextExpiresAt: null,
					urgency: "unknown",
				},
			},
		],
		{ colorEnabled: false, plain: true, columns: 20 },
	);

	expect(cards).toContain("Reset tokens\n    0 available");
});

test("renders a terminal-safe empty state in plain output", () => {
	const cards = renderAccountCards([], {
		colorEnabled: false,
		plain: true,
		columns: 20,
	});

	expect(cards).toBe(
		"Info     No accounts found.\n  Run `ocma login <alias>` to add an account.",
	);
});

test("escapes control characters in narrow account cards", () => {
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
