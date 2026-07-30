import { join } from "node:path";
import { z } from "zod";
import { type AppResult, readJsonFile } from "./fs.js";

const AccountAliasesSchema = z.record(z.string(), z.record(z.string(), z.string().min(1)));

export type AccountAliases = z.infer<typeof AccountAliasesSchema>;

export type AccountProfile = {
    generatedLabel: string;
    label: string;
    shortLabel: string;
    alias: string | null;
    color: number;
};

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

function aliasesFile(): string {
    const configRoot = process.env.XDG_CONFIG_HOME || join(process.env.HOME || "", ".config");
    return join(configRoot, "fbb", "data", "account-aliases.json");
}

function profileSeed(accountId: string): string {
    const seed = accountId.replace(/[^0-9a-fA-F]/g, "");
    return seed.length === 0 ? "00" : seed;
}

function byteAt(seed: string, offset: number): number {
    const byte = seed.slice(offset, offset + 2);
    return Number.parseInt(byte === "" ? "00" : byte, 16);
}

function accountAlias(aliases: AccountAliases, provider: string, generatedLabel: string): string | null {
    const providerAliases = aliases[provider];
    return providerAliases ? (providerAliases[generatedLabel] ?? null) : null;
}

export function loadAccountAliases(): AppResult<AccountAliases> {
    return readJsonFile(aliasesFile(), AccountAliasesSchema);
}

export function buildAccountProfile(
    provider: string,
    accountId: string,
    aliases: AccountAliases,
    bgMode: "dark" | "light" = "dark",
): AccountProfile {
    const seedHex = profileSeed(accountId);
    const adjectiveIndex = byteAt(seedHex, 0) % adjectives.length;
    const nounIndex = byteAt(seedHex, 2) % nouns.length;
    const palette = bgMode === "light" ? paletteLight : paletteDark;
    const colorIndex = byteAt(seedHex, 4) % palette.length;
    const idTail = accountId.slice(-4);
    const generatedLabel = `${adjectives[adjectiveIndex]}-${nouns[nounIndex]}-${idTail}`;
    const alias = accountAlias(aliases, provider, generatedLabel);

    return {
        generatedLabel,
        label: alias ? `${generatedLabel} (${alias})` : generatedLabel,
        shortLabel: alias ?? generatedLabel,
        alias,
        color: palette[colorIndex],
    };
}
