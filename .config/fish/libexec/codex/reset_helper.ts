#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { err, ok } from "neverthrow";
import { z } from "zod";
import { cacheRoot, readJsonFile, writeJsonAtomic, type AppResult } from "../shared/fs.js";

const backendUrl = "https://chatgpt.com/backend-api";
const cacheFile = join(cacheRoot(), "codex-reset", "credits.json");
const cacheTtlSeconds = 8 * 60 * 60;

const AuthFileSchema = z
    .object({
        access_token: z.string().min(1).optional(),
        account_id: z.string().min(1).optional(),
        tokens: z
            .object({
                access_token: z.string().min(1).optional(),
                account_id: z.string().min(1).optional(),
            })
            .optional(),
    })
    .passthrough();
const CreditSchema = z
    .object({
        id: z.string(),
        status: z.string().nullish(),
        reset_type: z.string().nullish(),
        granted_at: z.string().nullish(),
        expires_at: z.string().nullish(),
        title: z.string().nullish(),
        redeemed_at: z.string().nullish(),
    })
    .passthrough();
const CreditsSchema = z
    .object({
        available_count: z.number().default(0),
        credits: z.array(CreditSchema).default([]),
    })
    .passthrough();
const WindowSchema = z
    .object({
        used_percent: z.number().optional(),
        limit_window_seconds: z.number().optional(),
        reset_after_seconds: z.number().optional(),
    })
    .nullish();
const UsageSchema = z
    .object({
        rate_limit: z
            .object({
                primary_window: WindowSchema,
                secondary_window: WindowSchema,
            })
            .default({}),
    })
    .passthrough();
const ConsumeSchema = z
    .object({
        code: z.string().optional(),
        windows_reset: z.number().optional(),
        credit: z
            .object({
                redeemed_at: z.string().optional(),
            })
            .optional(),
    })
    .passthrough();
const CacheSchema = z.object({
    version: z.number().default(1),
    accounts: z
        .record(
            z.string(),
            z.object({
                fetched_at: z.number(),
                payload: CreditsSchema,
            }),
        )
        .default({}),
});

type Credits = z.infer<typeof CreditsSchema>;
type Usage = z.infer<typeof UsageSchema>;
type Credentials = { accessToken: string; accountId: string };
const commands = ["status", "consume-preview", "consume"] as const;
type Command = typeof commands[number];
type Arguments = {
    command: Command;
    authFile: string;
    creditId?: string;
    refresh: boolean;
};
type ValueOptionHandler = (args: Arguments, value: string) => void;

const valueOptionHandlers: Record<string, ValueOptionHandler> = {
    "--auth": (args, value) => {
        args.authFile = value;
    },
    "--credit-id": (args, value) => {
        args.creditId = value;
    },
};

function defaultAuthFile(): string {
    return join(process.env.CODEX_HOME || join(process.env.HOME || "", ".codex"), "auth.json");
}

function usage(): void {
    console.log("Usage: reset_helper.ts <status|consume-preview|consume> [--auth PATH] [--credit-id ID] [--refresh]");
}

function isCommand(value: string | undefined): value is Command {
    return commands.includes(value as Command);
}

function parseCommand(value: string | undefined): AppResult<Command> {
    if (!isCommand(value)) {
        return err("command must be status, consume-preview, or consume");
    }

    return ok(value);
}

function parseValueOption(
    option: string,
    value: string | undefined,
    setValue: ValueOptionHandler,
    args: Arguments,
): AppResult<number> {
    if (!value) {
        return err(`${option} requires a value`);
    }

    setValue(args, value);
    return ok(1);
}

function parseFlagOption(command: Command, option: string, args: Arguments): AppResult<number> {
    if (option !== "--refresh") {
        return err(`unknown or invalid option: ${option}`);
    }
    if (command !== "status") {
        return err(`unknown or invalid option: ${option}`);
    }

    args.refresh = true;
    return ok(0);
}

function parseOption(
    command: Command,
    option: string,
    value: string | undefined,
    args: Arguments,
): AppResult<number> {
    const setValue = valueOptionHandlers[option];
    if (setValue) {
        return parseValueOption(option, value, setValue, args);
    }

    return parseFlagOption(command, option, args);
}

function parseArguments(argv: string[]): AppResult<Arguments> {
    const [commandValue, ...rest] = argv;
    const commandResult = parseCommand(commandValue);
    if (commandResult.isErr()) {
        return err(commandResult.error);
    }

    const args: Arguments = { command: commandResult.value, authFile: defaultAuthFile(), refresh: false };
    for (let index = 0; index < rest.length; index += 1) {
        const optionResult = parseOption(commandResult.value, rest[index], rest[index + 1], args);
        if (optionResult.isErr()) {
            return err(optionResult.error);
        }

        index += optionResult.value;
    }

    return ok(args);
}

function loadCredentials(authFile: string): AppResult<Credentials> {
    const authResult = readJsonFile(authFile, AuthFileSchema);
    if (authResult.isErr()) {
        return err(`failed to read auth file: ${authResult.error}`);
    }

    const auth = authResult.value;
    const accessToken = auth.access_token || auth.tokens?.access_token;
    const accountId = auth.account_id || auth.tokens?.account_id;
    if (!accessToken || !accountId) {
        return err(`auth file is missing access_token or account_id: ${authFile}`);
    }

    return ok({ accessToken, accountId });
}

async function requestJson(
    path: string,
    credentials: Credentials,
    init: RequestInit = {},
): Promise<AppResult<unknown>> {
    try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${credentials.accessToken}`);
        headers.set("ChatGPT-Account-Id", credentials.accountId);
        const response = await fetch(`${backendUrl}${path}`, {
            ...init,
            headers,
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            return err(`HTTP ${response.status}`);
        }

        return ok(await response.json());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

async function fetchCredits(credentials: Credentials): Promise<AppResult<Credits>> {
    const response = await requestJson("/wham/rate-limit-reset-credits", credentials);
    if (response.isErr()) {
        return err(response.error);
    }

    const parsed = CreditsSchema.safeParse(response.value);
    if (!parsed.success) {
        return err("reset credits response has an unexpected shape");
    }

    return ok(parsed.data);
}

async function fetchUsage(credentials: Credentials): Promise<AppResult<Usage>> {
    const response = await requestJson("/wham/usage", credentials);
    if (response.isErr()) {
        return err(response.error);
    }

    const parsed = UsageSchema.safeParse(response.value);
    if (!parsed.success) {
        return err("usage response has an unexpected shape");
    }

    return ok(parsed.data);
}

function readCache(): z.infer<typeof CacheSchema> {
    if (!existsSync(cacheFile)) {
        return { version: 1, accounts: {} };
    }

    const cacheResult = readJsonFile(cacheFile, CacheSchema);
    return cacheResult.isOk() ? cacheResult.value : { version: 1, accounts: {} };
}

function cacheIsFresh(fetchedAt: number): boolean {
    return Date.now() / 1000 - fetchedAt < cacheTtlSeconds;
}

async function creditsForAccount(credentials: Credentials, refresh: boolean): Promise<AppResult<Credits>> {
    const cache = readCache();
    const entry = cache.accounts[credentials.accountId];
    if (!refresh && entry && cacheIsFresh(entry.fetched_at)) {
        return ok(entry.payload);
    }

    const creditsResult = await fetchCredits(credentials);
    if (creditsResult.isErr()) {
        return creditsResult;
    }

    cache.accounts[credentials.accountId] = {
        fetched_at: Math.floor(Date.now() / 1000),
        payload: creditsResult.value,
    };
    const writeResult = writeJsonAtomic(cacheFile, cache, 0o600);
    if (writeResult.isErr()) {
        return err(`failed to write reset cache: ${writeResult.error}`);
    }

    return creditsResult;
}

function parseExpiry(value?: string | null): number | null {
    if (!value) {
        return null;
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
}

function urgencyForExpiry(value?: string | null): "urgent" | "soon" | "later" | "unknown" {
    const expiry = parseExpiry(value);
    if (expiry === null) {
        return "unknown";
    }

    const secondsRemaining = (expiry - Date.now()) / 1000;
    if (secondsRemaining <= 24 * 60 * 60) {
        return "urgent";
    }
    if (secondsRemaining <= 7 * 24 * 60 * 60) {
        return "soon";
    }
    return "later";
}

function humanSeconds(seconds?: number): string | null {
    if (seconds === undefined) {
        return null;
    }
    if (seconds < 60) {
        return `${seconds}s`;
    }
    if (seconds < 3_600) {
        return `${Math.floor(seconds / 60)}m`;
    }
    if (seconds < 86_400) {
        return `${Math.floor((seconds / 3_600) * 10) / 10}h`;
    }
    return `${Math.floor((seconds / 86_400) * 10) / 10}d`;
}

function creditNickname(id: string): string {
    const guid = id.replace(/^.*_/, "");
    if (!/^[0-9a-fA-F]{12,}$/.test(guid)) {
        return id;
    }

    const adjectives = [
        "ember", "cobalt", "amber", "jade", "coral", "indigo", "silver", "scarlet", "atlas",
        "lotus", "cedar", "pine", "aurora", "frost", "orbit", "dune", "maple", "zenith",
    ];
    const nouns = [
        "falcon", "otter", "comet", "harbor", "meadow", "emberfox", "lynx", "kestrel", "glacier",
        "thicket", "river", "moss", "canyon", "beacon", "auroraforge", "wave", "ridge",
    ];
    const adjective = adjectives[Number.parseInt(guid.slice(6, 8), 16) % adjectives.length];
    const noun = nouns[Number.parseInt(guid.slice(8, 10), 16) % nouns.length];
    const suffix = guid.slice(-4);
    return `${adjective}-${noun}-${suffix}`;
}

function formatCredits(credits: Credits) {
    return credits.credits
        .map((credit) => {
            const expiry = parseExpiry(credit.expires_at);
            return {
                id: credit.id,
                nickname: creditNickname(credit.id),
                status: credit.status || "unknown",
                resetType: credit.reset_type || null,
                grantedAt: credit.granted_at || null,
                expiresAt: credit.expires_at || null,
                expiresIn: expiry === null ? "unknown" : expiry <= Date.now() ? "expired" : `${Math.ceil((expiry - Date.now()) / 86_400_000)}d`,
                urgency: urgencyForExpiry(credit.expires_at),
                title: credit.title || null,
            };
        })
        .sort((left, right) => (parseExpiry(left.expiresAt) || Infinity) - (parseExpiry(right.expiresAt) || Infinity));
}

function formatUsage(usage: Usage) {
    const rateLimit = usage.rate_limit || {};
    return [
        { name: "primary", window: rateLimit.primary_window },
        { name: "secondary", window: rateLimit.secondary_window },
    ].map(({ name, window }) => {
        if (!window || window.used_percent === undefined) {
            return { name, remaining: null, window: null, resetsIn: null };
        }

        return {
            name,
            remaining: Math.max(0, Math.min(100, 100 - Math.floor(window.used_percent))),
            window: humanSeconds(window.limit_window_seconds),
            resetsIn: humanSeconds(window.reset_after_seconds),
        };
    });
}

function summaryForCredits(credits: Credits) {
    const available = formatCredits(credits).filter((credit) => credit.status === "available");
    return {
        availableCount: credits.available_count,
        urgency: available[0]?.urgency || "unknown",
    };
}

function profileCredentials(authFile: string, activeAccountId: string): Credentials[] {
    const profilesFile = join(dirname(authFile), "auth-profiles.json");
    if (!existsSync(profilesFile)) {
        return [];
    }

    const profileDocument = readJsonFile(profilesFile, z.object({ profiles: z.record(z.string(), z.unknown()).default({}) }));
    if (profileDocument.isErr()) {
        return [];
    }

    const profiles: Credentials[] = [];
    for (const profile of Object.values(profileDocument.value.profiles)) {
        const parsed = AuthFileSchema.safeParse(profile);
        if (!parsed.success) {
            continue;
        }
        const accessToken = parsed.data.access_token || parsed.data.tokens?.access_token;
        const accountId = parsed.data.account_id || parsed.data.tokens?.account_id;
        if (accessToken && accountId && accountId !== activeAccountId) {
            profiles.push({ accessToken, accountId });
        }
    }

    return profiles;
}

async function status(args: Arguments, credentials: Credentials): Promise<AppResult<unknown>> {
    const [creditsResult, usageResult] = await Promise.all([
        creditsForAccount(credentials, args.refresh),
        fetchUsage(credentials),
    ]);
    if (creditsResult.isErr()) {
        return err(`failed to read reset credits: ${creditsResult.error}`);
    }
    if (usageResult.isErr()) {
        return err(`failed to read usage: ${usageResult.error}`);
    }

    const accounts: Array<{
        accountId: string;
        availableCount?: number;
        urgency?: "urgent" | "soon" | "later" | "unknown";
        active: boolean;
        error?: string;
    }> = [
        {
            accountId: credentials.accountId,
            ...summaryForCredits(creditsResult.value),
            active: true,
        },
    ];
    for (const profile of profileCredentials(args.authFile, credentials.accountId)) {
        const profileCredits = await creditsForAccount(profile, args.refresh);
        if (profileCredits.isErr()) {
            accounts.push({ accountId: profile.accountId, active: false, error: profileCredits.error });
            continue;
        }
        accounts.push({ accountId: profile.accountId, ...summaryForCredits(profileCredits.value), active: false });
    }

    return ok({
        active: {
            accountId: credentials.accountId,
            availableCount: creditsResult.value.available_count,
            credits: formatCredits(creditsResult.value),
            usage: formatUsage(usageResult.value),
        },
        accounts,
    });
}

function selectCredit(credits: Credits, creditId?: string) {
    const available = credits.credits.filter((credit) => credit.status === "available");
    if (!creditId) {
        return available.sort(
            (left, right) => (parseExpiry(left.expires_at) ?? Infinity) - (parseExpiry(right.expires_at) ?? Infinity),
        )[0] || null;
    }
    return available.find((credit) => credit.id === creditId) || null;
}

async function previewConsume(args: Arguments, credentials: Credentials): Promise<AppResult<unknown>> {
    const creditsResult = await fetchCredits(credentials);
    if (creditsResult.isErr()) {
        return err(`failed to read reset credits: ${creditsResult.error}`);
    }

    const credit = selectCredit(creditsResult.value, args.creditId);
    if (!credit) {
        return ok({ credit: null });
    }

    return ok({ credit: formatCredits({ available_count: 0, credits: [credit] })[0] });
}

async function consume(args: Arguments, credentials: Credentials): Promise<AppResult<unknown>> {
    if (!args.creditId) {
        return err("--credit-id is required");
    }

    const creditsResult = await fetchCredits(credentials);
    if (creditsResult.isErr()) {
        return err(`failed to read reset credits: ${creditsResult.error}`);
    }
    if (!selectCredit(creditsResult.value, args.creditId)) {
        return err(`credit is not available: ${args.creditId}`);
    }

    const response = await requestJson("/wham/rate-limit-reset-credits/consume", credentials, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credit_id: args.creditId, redeem_request_id: randomUUID() }),
    });
    if (response.isErr()) {
        return err(`failed to consume reset credit: ${response.error}`);
    }

    const parsed = ConsumeSchema.safeParse(response.value);
    if (!parsed.success) {
        return err("consume response has an unexpected shape");
    }

    return ok({
        code: parsed.data.code || null,
        windowsReset: parsed.data.windows_reset || null,
        redeemedAt: parsed.data.credit?.redeemed_at || null,
    });
}

async function main(): Promise<number> {
    const argsResult = parseArguments(process.argv.slice(2));
    if (argsResult.isErr()) {
        console.error(`codex_reset_helper: ${argsResult.error}`);
        usage();
        return 2;
    }

    const credentialsResult = loadCredentials(argsResult.value.authFile);
    if (credentialsResult.isErr()) {
        console.error(`codex_reset_helper: ${credentialsResult.error}`);
        return 1;
    }

    const args = argsResult.value;
    const credentials = credentialsResult.value;
    const result = args.command === "status"
        ? await status(args, credentials)
        : args.command === "consume-preview"
            ? await previewConsume(args, credentials)
            : await consume(args, credentials);
    if (result.isErr()) {
        console.error(`codex_reset_helper: ${result.error}`);
        return 1;
    }

    console.log(JSON.stringify(result.value));
    return 0;
}

process.exit(await main());
