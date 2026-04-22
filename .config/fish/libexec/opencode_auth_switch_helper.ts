#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { err, ok } from "neverthrow";
import { z } from "zod";
import { type AppResult, existingMode, readJsonFile, writeJsonAtomic } from "./shared/fs.js";

type JsonObject = Record<string, unknown>;

type ProviderProfile = {
    key: string;
    accountId: string;
    generatedLabel: string;
    label: string;
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
    command: z.literal("list"),
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
const CodexAuthSchema = z
    .object({
        tokens: z
            .object({
                account_id: z.string().min(1).optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();
const CodexProfilesSchema = z
    .object({
        profiles: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough();

function usage(): void {
    console.log("Usage: opencode_auth_switch_helper.ts <list|apply> ...");
    console.log("Commands:");
    console.log("  list <auth_file> [dark|light]");
    console.log("  apply <auth_file> <codex_auth_file> <codex_profiles_file> <provider> <target_key>");
}

function accountIdForEntry(key: string, entry: JsonObject): string {
    return typeof entry.accountId === "string" && entry.accountId.trim().length > 0 ? entry.accountId : key;
}

function listProviderNames(auth: Record<string, JsonObject>): string[] {
    const keys = Object.keys(auth);
    return keys.filter((key) => !key.includes("_") && keys.some((candidate) => candidate.startsWith(`${key}_`)));
}

function profileKeysForProvider(auth: Record<string, JsonObject>, provider: string): string[] {
    return Object.keys(auth).filter((key) => key.startsWith(`${provider}_`));
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

function swapActiveProvider(
    auth: Record<string, JsonObject>,
    provider: string,
    targetKey: string,
): AppResult<Record<string, JsonObject>> {
    if (!(provider in auth) || !(targetKey in auth)) {
        return err("missing provider key");
    }

    const inactiveKey = deriveInactiveKey(auth, provider, targetKey);
    if (inactiveKey !== targetKey && inactiveKey in auth) {
        return err("inactive key already exists");
    }

    const activeValue = auth[provider];
    const selectedValue = auth[targetKey];
    const nextAuth: Record<string, JsonObject> = {};

    for (const key of Object.keys(auth)) {
        if (key === provider) {
            nextAuth[key] = selectedValue;
            continue;
        }

        if (key === targetKey) {
            if (inactiveKey === targetKey) {
                nextAuth[key] = activeValue;
            }
            continue;
        }

        nextAuth[key] = auth[key];
    }

    if (inactiveKey !== targetKey) {
        nextAuth[inactiveKey] = activeValue;
    }

    return ok(nextAuth);
}

function syncCodexProfiles(
    codexAuthFile: string,
    codexProfilesFile: string,
    selectedAccountId: string,
): AppResult<string> {
    if (!selectedAccountId || !existsSync(codexAuthFile)) {
        return ok("codex unchanged");
    }

    const codexAuthResult = readJsonFile(codexAuthFile, CodexAuthSchema);
    if (codexAuthResult.isErr()) {
        return ok(`codex auth parse failed: ${codexAuthFile}`);
    }

    let codexProfiles: z.infer<typeof CodexProfilesSchema> = { profiles: {} };
    if (existsSync(codexProfilesFile)) {
        const codexProfilesResult = readJsonFile(codexProfilesFile, CodexProfilesSchema);
        if (codexProfilesResult.isErr()) {
            return ok(`codex profiles file invalid: ${codexProfilesFile}`);
        }
        codexProfiles = codexProfilesResult.value;
    }

    const currentAccountId = codexAuthResult.value.tokens?.account_id || "";
    if (currentAccountId) {
        codexProfiles.profiles[currentAccountId] = codexAuthResult.value;
    }

    const profilesWriteResult = writeJsonAtomic(
        codexProfilesFile,
        codexProfiles,
        existingMode(codexProfilesFile) ?? 0o600,
    );
    if (profilesWriteResult.isErr()) {
        return err(profilesWriteResult.error);
    }

    if (!(selectedAccountId in codexProfiles.profiles)) {
        return ok(`codex profile missing for: ${selectedAccountId} (run codex login once)`);
    }

    const codexAuthWriteResult = writeJsonAtomic(
        codexAuthFile,
        codexProfiles.profiles[selectedAccountId],
        existingMode(codexAuthFile) ?? 0o600,
    );
    if (codexAuthWriteResult.isErr()) {
        return ok("codex update failed");
    }

    return ok(`codex switched: ${selectedAccountId}`);
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
    const selectedAccountId = typeof selectedEntry.accountId === "string" ? selectedEntry.accountId : "";
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

function main(): number {
    const [, , command, ...rest] = process.argv;
    if (!command || command === "-h" || command === "--help") {
        usage();
        return command ? 0 : 1;
    }

    if (command === "list") {
        const parsedArgs = ListArgsSchema.safeParse({
            command,
            authFile: rest[0],
            bgMode: rest[1] || "dark",
        });
        if (!parsedArgs.success) {
            const summary = parsedArgs.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ");
            console.error(`opencode_auth_switch_helper: invalid args (${summary})`);
            return 1;
        }

        const listResult = listProfiles(parsedArgs.data.authFile, parsedArgs.data.bgMode);
        if (listResult.isErr()) {
            console.error(`opencode_auth_switch_helper: ${listResult.error}`);
            return 1;
        }

        if (listResult.value.length > 0) {
            console.log(listResult.value.join("\n"));
        }
        return 0;
    }

    if (command === "apply") {
        const parsedArgs = ApplyArgsSchema.safeParse({
            command,
            authFile: rest[0],
            codexAuthFile: rest[1],
            codexProfilesFile: rest[2],
            provider: rest[3],
            targetKey: rest[4],
        });
        if (!parsedArgs.success) {
            const summary = parsedArgs.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ");
            console.error(`opencode_auth_switch_helper: invalid args (${summary})`);
            return 1;
        }

        const applyResult = applySelection(
            parsedArgs.data.authFile,
            parsedArgs.data.codexAuthFile,
            parsedArgs.data.codexProfilesFile,
            parsedArgs.data.provider,
            parsedArgs.data.targetKey,
        );
        if (applyResult.isErr()) {
            console.error(`opencode_auth_switch_helper: ${applyResult.error}`);
            return 1;
        }

        console.log(applyResult.value.codexStatus);
        return 0;
    }

    usage();
    return 1;
}

process.exit(main());
