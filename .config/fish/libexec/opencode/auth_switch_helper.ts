#!/usr/bin/env bun

import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { err, ok } from "neverthrow";
import { z } from "zod";
import { type AppResult, existingMode, readJsonFile, writeJsonAtomic } from "../shared/fs.js";

type JsonObject = Record<string, unknown>;

type ProviderProfile = {
    key: string;
    accountId: string;
    generatedLabel: string;
    label: string;
    alias: string | null;
    color: number;
};

const aliasMap = [
    ["openai", "indigo-harbor-ddce", "fbb"],
    ["openai", "atlas-thicket-3afa", "jpb"],
    ["openai", "aurora-auroraforge-efd2", "work"],
] as const;

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

const paletteDark = [39, 45, 51, 75, 81, 87, 111, 117, 123, 159, 195, 214, 220, 226];
const paletteLight = [18, 19, 20, 22, 23, 24, 52, 53, 54, 88, 89, 90, 94, 124];

const ListArgsSchema = z.object({
    command: z.enum(["list", "aliases"]),
    authFile: z.string().min(1),
    bgMode: z.enum(["dark", "light"]).default("dark"),
});

const ApplyArgsSchema = z.object({
    command: z.literal("apply"),
    authFile: z.string().min(1),
    codexAuthFile: z.string().min(1),
    codexProfilesFile: z.string().min(1),
    provider: z.string().min(1),
    targetKey: z.string().min(1),
});

const AuthEntrySchema = z.record(z.string(), z.unknown());
const AuthFileSchema = z.record(z.string(), AuthEntrySchema);
const OpenAIAccessTokenSchema = z.object({
    "https://api.openai.com/auth": z
        .object({
            chatgpt_account_id: z.string().min(1).optional(),
        })
        .optional(),
});
const CodexAuthSchema = z
    .object({
        tokens: z
            .object({
                account_id: z.string().min(1).optional(),
            })
            .passthrough()
            .default({}),
    })
    .passthrough();
const CodexProfilesSchema = z
    .object({
        profiles: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough();

function usage(): void {
    console.log("Usage: opencode/auth_switch_helper.ts <list|apply> ...");
    console.log("Commands:");
    console.log("  list <auth_file> [dark|light]");
    console.log("  aliases <auth_file> [dark|light]");
    console.log("  apply <auth_file> <codex_auth_file> <codex_profiles_file> <provider> <target_key>");
}

function accountIdForEntry(key: string, entry: JsonObject): string {
    if (typeof entry.accountId === "string" && entry.accountId.trim().length > 0) {
        return entry.accountId;
    }

    if (typeof entry.access !== "string") {
        return key;
    }

    const payload = entry.access.split(".")[1];
    if (!payload) {
        return key;
    }

    try {
        const claims = OpenAIAccessTokenSchema.safeParse(
            JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        );
        return claims.success ? (claims.data["https://api.openai.com/auth"]?.chatgpt_account_id ?? key) : key;
    } catch {
        return key;
    }
}

function listProviderNames(auth: Record<string, JsonObject>): string[] {
    const keys = Object.keys(auth);
    return keys.filter((key) => !key.includes("_") && keys.some((candidate) => candidate.startsWith(`${key}_`)));
}

function profileKeysForProvider(auth: Record<string, JsonObject>, provider: string): string[] {
    return Object.keys(auth).filter((key) => key === provider || key.startsWith(`${provider}_`));
}

function buildProfileLabel(
    provider: string,
    key: string,
    accountId: string,
    bgMode: "dark" | "light",
): ProviderProfile {
    let seedHex = accountId.replace(/[^0-9a-fA-F]/g, "");
    if (seedHex.length === 0) {
        seedHex = "00";
    }

    const aHex = seedHex.slice(0, 2) || "00";
    const nHex = seedHex.slice(2, 4) || "00";
    const cHex = seedHex.slice(4, 6) || "00";
    const aIndex = (Number.parseInt(aHex, 16) % adjectives.length) + 1;
    const nIndex = (Number.parseInt(nHex, 16) % nouns.length) + 1;
    const palette = bgMode === "light" ? paletteLight : paletteDark;
    const colorIndex = (Number.parseInt(cHex, 16) % palette.length) + 1;
    const idTail = accountId.slice(Math.max(0, accountId.length - 4)) || accountId;
    const generatedLabel = `${adjectives[aIndex - 1]}-${nouns[nIndex - 1]}-${idTail}`;
    const alias = aliasMap.find(
        ([aliasProvider, generated]) => aliasProvider === provider && generated === generatedLabel,
    )?.[2];

    return {
        key,
        accountId,
        generatedLabel,
        label: alias ? `${generatedLabel} (${alias})` : generatedLabel,
        alias: alias ?? null,
        color: palette[colorIndex - 1],
    };
}

function listProfiles(authFile: string, bgMode: "dark" | "light"): AppResult<string[]> {
    const authResult = readJsonFile(authFile, AuthFileSchema);
    if (authResult.isErr()) {
        return err(authResult.error);
    }

    const auth = authResult.value as Record<string, JsonObject>;
    const lines: string[] = [];
    for (const provider of listProviderNames(auth)) {
        for (const key of profileKeysForProvider(auth, provider)) {
            const entry = auth[key] || {};
            const profile = buildProfileLabel(provider, key, accountIdForEntry(key, entry), bgMode);
            lines.push([provider, profile.key, profile.label, String(profile.color)].join("\t"));
        }
    }

    return ok(lines);
}

function listAccountAliases(authFile: string, bgMode: "dark" | "light"): AppResult<string[]> {
    const authResult = readJsonFile(authFile, AuthFileSchema);
    if (authResult.isErr()) {
        return err(authResult.error);
    }

    const auth = authResult.value as Record<string, JsonObject>;
    const providers = listProviderNames(auth);
    const aliases = new Map<string, string>();
    for (const [key, entry] of Object.entries(auth)) {
        const provider = providers.find((candidate) => key === candidate || key.startsWith(`${candidate}_`));
        if (!provider) {
            continue;
        }

        const accountId = accountIdForEntry(key, entry);
        if (aliases.has(accountId)) {
            continue;
        }

        const profile = buildProfileLabel(provider, key, accountId, bgMode);
        aliases.set(accountId, profile.alias ?? profile.generatedLabel);
    }

    return ok([...aliases].map(([accountId, alias]) => [accountId, alias].join("\t")));
}

function deriveInactiveKey(auth: Record<string, JsonObject>, provider: string, targetKey: string): string {
    if (new RegExp(`^${provider}_[0-9]+$`).test(targetKey)) {
        return targetKey;
    }

    let index = 1;
    while (true) {
        const candidate = `${provider}_${index}`;
        if (candidate === targetKey || !(candidate in auth)) {
            return candidate;
        }
        index += 1;
    }
}

function swappedAuthEntry(
    key: string,
    value: JsonObject,
    provider: string,
    targetKey: string,
    inactiveKey: string,
    activeValue: JsonObject,
    selectedValue: JsonObject,
): [string, JsonObject] | null {
    if (key === provider) {
        return [key, selectedValue];
    }
    if (key === targetKey) {
        return inactiveKey === targetKey ? [key, activeValue] : null;
    }
    return [key, value];
}

function swappedAuthEntries(
    auth: Record<string, JsonObject>,
    provider: string,
    targetKey: string,
    inactiveKey: string,
): [string, JsonObject][] {
    const activeValue = auth[provider];
    const selectedValue = auth[targetKey];
    const entries = Object.entries(auth).flatMap(([key, value]) => {
        const entry = swappedAuthEntry(key, value, provider, targetKey, inactiveKey, activeValue, selectedValue);
        return entry === null ? [] : [entry];
    });

    if (inactiveKey !== targetKey) {
        entries.push([inactiveKey, activeValue]);
    }

    return entries;
}

function validateSwap(auth: Record<string, JsonObject>, provider: string, targetKey: string): AppResult<void> {
    if ([provider, targetKey].every((key) => key in auth) === false) {
        return err("missing provider key");
    }

    const inactiveKey = deriveInactiveKey(auth, provider, targetKey);
    if (inactiveKey !== targetKey && inactiveKey in auth) {
        return err("inactive key already exists");
    }

    return ok(undefined);
}

function swapActiveProvider(
    auth: Record<string, JsonObject>,
    provider: string,
    targetKey: string,
): AppResult<Record<string, JsonObject>> {
    const validationResult = validateSwap(auth, provider, targetKey);
    if (validationResult.isErr()) {
        return err(validationResult.error);
    }

    const inactiveKey = deriveInactiveKey(auth, provider, targetKey);
    return ok(Object.fromEntries(swappedAuthEntries(auth, provider, targetKey, inactiveKey)));
}

function canSyncCodexProfiles(selectedAccountId: string, codexAuthFile: string): boolean {
    return selectedAccountId !== "" && existsSync(codexAuthFile);
}

function loadCodexProfiles(codexProfilesFile: string): AppResult<z.infer<typeof CodexProfilesSchema>> {
    if (existsSync(codexProfilesFile) === false) {
        return ok({ profiles: {} });
    }

    const result = readJsonFile(codexProfilesFile, CodexProfilesSchema);
    if (result.isErr()) {
        return err(`codex profiles file invalid: ${codexProfilesFile}`);
    }

    return ok(result.value);
}

function writeSelectedCodexProfile(
    codexAuthFile: string,
    profiles: z.infer<typeof CodexProfilesSchema>["profiles"],
    selectedAccountId: string,
): AppResult<string> {
    const selectedProfile = profiles[selectedAccountId];
    if (selectedProfile === undefined) {
        return ok(`codex profile missing for: ${selectedAccountId} (run codex login once)`);
    }

    const writeResult = writeJsonAtomic(codexAuthFile, selectedProfile, existingMode(codexAuthFile) ?? 0o600);
    if (writeResult.isErr()) {
        return ok("codex update failed");
    }

    return ok(`codex switched: ${selectedAccountId}`);
}

function saveAndSwitchCodexProfile(
    codexAuthFile: string,
    codexProfilesFile: string,
    codexProfiles: z.infer<typeof CodexProfilesSchema>,
    auth: z.infer<typeof CodexAuthSchema>,
    selectedAccountId: string,
): AppResult<string> {
    const accountId = auth.tokens.account_id;
    if (accountId) {
        codexProfiles.profiles[accountId] = auth;
    }

    const writeResult = writeJsonAtomic(codexProfilesFile, codexProfiles, existingMode(codexProfilesFile) ?? 0o600);
    if (writeResult.isErr()) {
        return err(writeResult.error);
    }

    return writeSelectedCodexProfile(codexAuthFile, codexProfiles.profiles, selectedAccountId);
}

function syncCodexProfiles(
    codexAuthFile: string,
    codexProfilesFile: string,
    selectedAccountId: string,
): AppResult<string> {
    if (canSyncCodexProfiles(selectedAccountId, codexAuthFile) === false) {
        return ok("codex unchanged");
    }

    const codexAuthResult = readJsonFile(codexAuthFile, CodexAuthSchema);
    if (codexAuthResult.isErr()) {
        return ok(`codex auth parse failed: ${codexAuthFile}`);
    }

    const codexProfilesResult = loadCodexProfiles(codexProfilesFile);
    if (codexProfilesResult.isErr()) {
        return ok(codexProfilesResult.error);
    }

    return saveAndSwitchCodexProfile(
        codexAuthFile,
        codexProfilesFile,
        codexProfilesResult.value,
        codexAuthResult.value,
        selectedAccountId,
    );
}

function applySelection(
    authFile: string,
    codexAuthFile: string,
    codexProfilesFile: string,
    provider: string,
    targetKey: string,
): AppResult<{ provider: string; selectedAccountId: string; codexStatus: string }> {
    const authResult = readJsonFile(authFile, AuthFileSchema);
    if (authResult.isErr()) {
        return err(authResult.error);
    }

    const auth = authResult.value as Record<string, JsonObject>;
    const swapResult = swapActiveProvider(auth, provider, targetKey);
    if (swapResult.isErr()) {
        return err(swapResult.error);
    }

    const authWriteResult = writeJsonAtomic(authFile, swapResult.value, existingMode(authFile));
    if (authWriteResult.isErr()) {
        return err(authWriteResult.error);
    }

    const selectedEntry = auth[targetKey] || {};
    const resolvedAccountId = accountIdForEntry(targetKey, selectedEntry);
    const selectedAccountId = resolvedAccountId === targetKey ? "" : resolvedAccountId;
    const codexStatusResult = syncCodexProfiles(codexAuthFile, codexProfilesFile, selectedAccountId);
    if (codexStatusResult.isErr()) {
        return err(codexStatusResult.error);
    }

    return ok({
        provider,
        selectedAccountId,
        codexStatus: codexStatusResult.value,
    });
}

function parseArgs<T>(schema: z.ZodType<T>, args: unknown): T | null {
    const parsedArgs = schema.safeParse(args);
    if (parsedArgs.success) {
        return parsedArgs.data;
    }

    const summary = parsedArgs.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    console.error(`opencode_auth_switch_helper: invalid args (${summary})`);
    return null;
}

function emitListResult(result: AppResult<string[]>): number {
    if (result.isErr()) {
        console.error(`opencode_auth_switch_helper: ${result.error}`);
        return 1;
    }

    if (result.value.length > 0) {
        console.log(result.value.join("\n"));
    }
    return 0;
}

function runListCommand(command: "list" | "aliases", args: string[]): number {
    const parsedArgs = parseArgs(ListArgsSchema, {
        command,
        authFile: args[0],
        bgMode: args[1] || "dark",
    });
    if (!parsedArgs) {
        return 1;
    }

    const list = listCommands[command];
    return emitListResult(list(parsedArgs.authFile, parsedArgs.bgMode));
}

function runApplyCommand(args: string[]): number {
    const parsedArgs = parseArgs(ApplyArgsSchema, {
        command: "apply",
        authFile: args[0],
        codexAuthFile: args[1],
        codexProfilesFile: args[2],
        provider: args[3],
        targetKey: args[4],
    });
    if (!parsedArgs) {
        return 1;
    }

    const applyResult = applySelection(
        parsedArgs.authFile,
        parsedArgs.codexAuthFile,
        parsedArgs.codexProfilesFile,
        parsedArgs.provider,
        parsedArgs.targetKey,
    );
    if (applyResult.isErr()) {
        console.error(`opencode_auth_switch_helper: ${applyResult.error}`);
        return 1;
    }

    console.log(applyResult.value.codexStatus);
    return 0;
}

const commandHandlers: Record<string, (args: string[]) => number> = {
    list: (args) => runListCommand("list", args),
    aliases: (args) => runListCommand("aliases", args),
    apply: runApplyCommand,
};

const listCommands: Record<"list" | "aliases", (authFile: string, bgMode: "dark" | "light") => AppResult<string[]>> = {
    list: listProfiles,
    aliases: listAccountAliases,
};

function isHelpCommand(command: string): boolean {
    return command === "-h" || command === "--help";
}

function main(): number {
    const [, , command, ...rest] = process.argv;
    if (!command) {
        usage();
        return 1;
    }
    if (isHelpCommand(command)) {
        usage();
        return 0;
    }

    const handler = commandHandlers[command];
    if (!handler) {
        usage();
        return 1;
    }

    return handler(rest);
}

process.exit(main());
