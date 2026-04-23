#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";

const BASE = "/System/Library/AssetsV2/com_apple_MobileAsset_ComfortSoundsAssets";
const DOMAIN = "com.apple.ComfortSounds";
const RESOURCES = "/System/Library/PrivateFrameworks/HearingUtilities.framework/Resources";

type SoundAsset = {
    name: string;
    resourcePath: string;
    assetId: string;
    soundGroup: number;
    formatVersion: number;
    compatibilityVersion: number;
};

type AppResult<T> = Result<T, string>;

function run(command: string, args: string[], cwd?: string): AppResult<string> {
    const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || `${command} failed`).trim();
        return err(output);
    }

    return ok(result.stdout);
}

function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readRawPlistValue(filePath: string, keyPath: string): AppResult<string> {
    return run("plutil", ["-extract", keyPath, "raw", "-o", "-", filePath]).map((value) => value.trim());
}

function listAssets(): AppResult<SoundAsset[]> {
    if (!existsSync(BASE)) {
        return err(`missing assets directory: ${BASE}`);
    }

    const assets: SoundAsset[] = [];

    for (const entry of readdirSync(BASE, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.endsWith(".asset")) {
            continue;
        }

        const infoPath = join(BASE, entry.name, "Info.plist");
        if (!existsSync(infoPath)) {
            continue;
        }

        const nameResult = readRawPlistValue(infoPath, "MobileAssetProperties.SoundName");
        if (nameResult.isErr()) {
            continue;
        }

        const name = nameResult.value;
        if (!name) {
            continue;
        }

        const soundGroupResult = readRawPlistValue(infoPath, "MobileAssetProperties.SoundGroup");
        const formatVersionResult = readRawPlistValue(infoPath, "MobileAssetProperties.FormatVersion");
        const compatibilityVersionResult = readRawPlistValue(infoPath, "MobileAssetProperties.CompatibilityVersion");

        if (soundGroupResult.isErr() || formatVersionResult.isErr() || compatibilityVersionResult.isErr()) {
            continue;
        }

        const soundGroup = Number.parseInt(soundGroupResult.value, 10);
        const formatVersion = Number.parseInt(formatVersionResult.value, 10);
        const compatibilityVersion = Number.parseInt(compatibilityVersionResult.value, 10);

        if (Number.isNaN(soundGroup) || Number.isNaN(formatVersion) || Number.isNaN(compatibilityVersion)) {
            continue;
        }

        assets.push({
            name,
            resourcePath: `file://${RESOURCES}/${name}.m4a`,
            assetId: entry.name.replace(/\.asset$/, ""),
            soundGroup,
            formatVersion,
            compatibilityVersion,
        });
    }

    assets.sort((a, b) => a.name.localeCompare(b.name));
    return ok(assets);
}

function extractUid(xml: string): AppResult<number> {
    const match = xml.match(/<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/);
    if (!match) {
        return err("failed to parse CF$UID");
    }

    return ok(Number.parseInt(match[1], 10));
}

function extractUidAtPath(plistPath: string, keyPath: string): AppResult<number> {
    const xmlResult = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    if (xmlResult.isErr()) {
        return err(xmlResult.error);
    }

    return extractUid(xmlResult.value);
}

function extractUidAtPathIfPresent(plistPath: string, keyPath: string): AppResult<number | null> {
    const xmlResult = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    if (xmlResult.isErr()) {
        return ok(null);
    }

    return extractUid(xmlResult.value).map((value) => value);
}

function extractUidArray(plistPath: string, keyPath: string): AppResult<number[]> {
    const xmlResult = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    if (xmlResult.isErr()) {
        return err(xmlResult.error);
    }

    const matches = [...xmlResult.value.matchAll(/<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/g)];
    return ok(matches.map((match) => Number.parseInt(match[1], 10)));
}

function extractUidArrayIfPresent(plistPath: string, keyPath: string): AppResult<number[] | null> {
    const xmlResult = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    if (xmlResult.isErr()) {
        return ok(null);
    }

    const matches = [...xmlResult.value.matchAll(/<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/g)];
    return ok(matches.map((match) => Number.parseInt(match[1], 10)));
}

function replaceString(plistPath: string, keyPath: string, value: string): AppResult<void> {
    const indexMatch = keyPath.match(/^\$objects\.(\d+)$/);
    if (indexMatch) {
        const index = Number.parseInt(indexMatch[1], 10);
        const replaceResult = run("plutil", ["-replace", keyPath, "-string", value, plistPath]);
        if (replaceResult.isErr()) {
            return err(replaceResult.error);
        }

        const removeResult = run("plutil", ["-remove", `$objects.${index + 1}`, plistPath]);
        if (removeResult.isErr()) {
            return err(removeResult.error);
        }

        return ok(undefined);
    }

    const result = run("plutil", ["-replace", keyPath, "-string", value, plistPath]);
    if (result.isErr()) {
        return err(result.error);
    }

    return ok(undefined);
}

function replaceInteger(plistPath: string, keyPath: string, value: number): AppResult<void> {
    const indexMatch = keyPath.match(/^\$objects\.(\d+)$/);
    if (indexMatch) {
        const index = Number.parseInt(indexMatch[1], 10);
        const replaceResult = run("plutil", ["-replace", keyPath, "-integer", String(value), plistPath]);
        if (replaceResult.isErr()) {
            return err(replaceResult.error);
        }

        const removeResult = run("plutil", ["-remove", `$objects.${index + 1}`, plistPath]);
        if (removeResult.isErr()) {
            return err(removeResult.error);
        }

        return ok(undefined);
    }

    const result = run("plutil", ["-replace", keyPath, "-integer", String(value), plistPath]);
    if (result.isErr()) {
        return err(result.error);
    }

    return ok(undefined);
}

function setIfPresentString(
    plistPath: string,
    indexByKey: Map<string, number>,
    key: string,
    value: string,
): AppResult<void> {
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
        return replaceString(plistPath, `$objects.${idx}`, value);
    }

    return ok(undefined);
}

function setIfPresentInteger(
    plistPath: string,
    indexByKey: Map<string, number>,
    key: string,
    value: number,
): AppResult<void> {
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
        return replaceInteger(plistPath, `$objects.${idx}`, value);
    }

    return ok(undefined);
}

function runAll(operations: Array<() => AppResult<void>>): AppResult<void> {
    for (const operation of operations) {
        const result = operation();
        if (result.isErr()) {
            return err(result.error);
        }
    }

    return ok(undefined);
}

function unwrapOrThrow<T>(result: AppResult<T>): T {
    if (result.isErr()) {
        throw new Error(result.error);
    }

    return result.value;
}

function reloadHeardProcess(): void {
    const uidResult = run("id", ["-u"]);
    if (uidResult.isErr()) {
        return;
    }

    const uid = uidResult.value.trim();
    const pidsRaw = spawnSync("pgrep", ["-u", uid, "-x", "heard"], { encoding: "utf8" });
    if (pidsRaw.status !== 0 || !pidsRaw.stdout.trim()) {
        return;
    }

    const firstPid = pidsRaw.stdout.trim().split(/\s+/)[0];
    if (!firstPid) {
        return;
    }

    spawnSync("kill", ["-HUP", firstPid], { stdio: "ignore" });
}

function setSound(targetInput: string): AppResult<string> {
    const assetsResult = listAssets();
    if (assetsResult.isErr()) {
        return err(assetsResult.error);
    }

    const assets = assetsResult.value;
    if (assets.length === 0) {
        return err("no installed comfort sounds found");
    }

    const byNormalizedName = new Map<string, SoundAsset>();
    for (const asset of assets) {
        byNormalizedName.set(normalize(asset.name), asset);
    }

    const target = byNormalizedName.get(normalize(targetInput));
    if (!target) {
        const names = assets.map((asset) => asset.name).join(", ");
        return err(`unknown sound "${targetInput}"\navailable: ${names}`);
    }

    const tempDir = mkdtempSync(join(tmpdir(), "comfort-sound-"));
    const domainPlist = join(tempDir, "domain.plist");
    const archiveBin = join(tempDir, "selected.bplist");
    const archiveXml = join(tempDir, "selected.xml");

    try {
        unwrapOrThrow(run("defaults", ["export", DOMAIN, domainPlist]));

        const selectedBase64 = unwrapOrThrow(readRawPlistValue(domainPlist, "ComfortSoundsSelectedSound"));
        if (!selectedBase64) {
            return err("ComfortSoundsSelectedSound not initialized; set one sound in System Settings first");
        }

        writeFileSync(archiveBin, Buffer.from(selectedBase64, "base64"));
        unwrapOrThrow(run("plutil", ["-convert", "xml1", "-o", archiveXml, archiveBin]));

        const nameIdx = unwrapOrThrow(extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundNameKey"));
        const pathObjectIdx = unwrapOrThrow(extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundPathKey"));
        const pathValueIdx = unwrapOrThrow(extractUidAtPath(archiveXml, `$objects.${pathObjectIdx}.NS\\.relative`));
        const assetObjectIdx = unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, "$objects.1.HUComfortSoundAssetKey"));
        const assetIdIdx =
            assetObjectIdx !== null && assetObjectIdx > 0
                ? unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, `$objects.${assetObjectIdx}.assetId`))
                : null;
        const propertiesIdx =
            assetObjectIdx !== null && assetObjectIdx > 0
                ? unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, `$objects.${assetObjectIdx}.properties`))
                : null;

        const replacementOperations: Array<() => AppResult<void>> = [
            () => replaceString(archiveXml, `$objects.${nameIdx}`, target.name),
            () => replaceString(archiveXml, `$objects.${pathValueIdx}`, target.resourcePath),
            () => replaceInteger(archiveXml, "$objects.1.HUComfortSoundGroupKey", target.soundGroup),
        ];

        if (assetIdIdx !== null) {
            replacementOperations.push(() => replaceString(archiveXml, `$objects.${assetIdIdx}`, target.assetId));
        }

        if (assetObjectIdx !== null && assetObjectIdx > 0) {
            replacementOperations.push(() => replaceInteger(archiveXml, `$objects.${assetObjectIdx}.formatVersion`, target.formatVersion));
            replacementOperations.push(() =>
                replaceInteger(
                    archiveXml,
                    `$objects.${assetObjectIdx}.compatibilityVersion`,
                    target.compatibilityVersion,
                ),
            );
        }

        const replacementResult = runAll(replacementOperations);
        if (replacementResult.isErr()) {
            return err(replacementResult.error);
        }

        if (propertiesIdx !== null) {
            const keyIdxList = unwrapOrThrow(extractUidArrayIfPresent(archiveXml, `$objects.${propertiesIdx}.NS\\.keys`)) ?? [];
            const valueIdxList =
                unwrapOrThrow(extractUidArrayIfPresent(archiveXml, `$objects.${propertiesIdx}.NS\\.objects`)) ?? [];
            const valueIdxByKey = new Map<string, number>();

            const pairCount = Math.min(keyIdxList.length, valueIdxList.length);
            for (let i = 0; i < pairCount; i += 1) {
                valueIdxByKey.set(
                    unwrapOrThrow(readRawPlistValue(archiveXml, `$objects.${keyIdxList[i]}`)),
                    valueIdxList[i],
                );
            }

            const metadataResult = runAll([
                () => setIfPresentString(archiveXml, valueIdxByKey, "SoundName", target.name),
                () => setIfPresentInteger(archiveXml, valueIdxByKey, "SoundGroup", target.soundGroup),
                () => setIfPresentInteger(archiveXml, valueIdxByKey, "FormatVersion", target.formatVersion),
                () => setIfPresentInteger(archiveXml, valueIdxByKey, "CompatibilityVersion", target.compatibilityVersion),
            ]);
            if (metadataResult.isErr()) {
                return err(metadataResult.error);
            }
        }

        unwrapOrThrow(run("plutil", ["-convert", "binary1", "-o", archiveBin, archiveXml]));

        const archiveHex = readFileSync(archiveBin).toString("hex");

        const writeResult = runAll([
            () =>
                run("defaults", ["write", DOMAIN, "ComfortSoundsSelectedSound", "-data", archiveHex]).map(
                    () => undefined,
                ),
            () => run("defaults", ["write", DOMAIN, "comfortSoundsEnabled", "-bool", "YES"]).map(() => undefined),
            () =>
                run("defaults", [
                    "write",
                    DOMAIN,
                    "lastEnablementTimestamp",
                    String(Math.floor(Date.now() / 1000)),
                ]).map(() => undefined),
        ]);
        if (writeResult.isErr()) {
            return err(writeResult.error);
        }

        reloadHeardProcess();
        return ok(target.name);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function usage(): void {
    console.log("Usage: comfort_sound_helper.ts <list|set> [SOUND_NAME]");
}

function main(): number {
    const [, , command, ...args] = process.argv;

    if (!command || command === "-h" || command === "--help") {
        usage();
        return 0;
    }

    if (command === "list") {
        const assetsResult = listAssets();
        if (assetsResult.isErr()) {
            console.error(`comfort_sound_helper: ${assetsResult.error}`);
            return 1;
        }

        const names = assetsResult.value.map((asset) => asset.name);
        for (const name of names) {
            console.log(name);
        }
        return 0;
    }

    if (command === "set") {
        if (args.length === 0) {
            console.error("comfort_sound_helper: set requires SOUND_NAME");
            return 1;
        }

        const selectedResult = setSound(args.join(" "));
        if (selectedResult.isErr()) {
            console.error(`comfort_sound_helper: ${selectedResult.error}`);
            return 1;
        }

        console.log(selectedResult.value);
        return 0;
    }

    console.error(`comfort_sound_helper: unknown command: ${command}`);
    return 1;
}

process.exit(main());
