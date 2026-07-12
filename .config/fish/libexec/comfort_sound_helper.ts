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
type ArchiveSoundIndexes = {
    name: number;
    pathValue: number;
    assetObject: number | null;
    assetId: number | null;
    properties: number | null;
};

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

    const assets = readdirSync(BASE, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".asset"))
        .map((entry) => soundAssetFromDirectory(entry.name))
        .filter((asset): asset is SoundAsset => asset !== null);

    assets.sort((a, b) => a.name.localeCompare(b.name));
    return ok(assets);
}

function soundAssetFromDirectory(directoryName: string): SoundAsset | null {
    const infoPath = join(BASE, directoryName, "Info.plist");
    if (!existsSync(infoPath)) {
        return null;
    }

    return soundAssetFromInfo(infoPath, directoryName);
}

function soundAssetFromInfo(infoPath: string, directoryName: string): SoundAsset | null {
    const nameResult = readRawPlistValue(infoPath, "MobileAssetProperties.SoundName");
    if (nameResult.isErr() || nameResult.value === "") {
        return null;
    }

    const metadata = readSoundMetadata(infoPath);
    if (metadata === null) {
        return null;
    }

    return {
        name: nameResult.value,
        resourcePath: `file://${RESOURCES}/${nameResult.value}.m4a`,
        assetId: directoryName.replace(/\.asset$/, ""),
        ...metadata,
    };
}

function readSoundMetadata(infoPath: string): Omit<SoundAsset, "name" | "resourcePath" | "assetId"> | null {
    const values: string[] = [];
    for (const keyPath of [
        "MobileAssetProperties.SoundGroup",
        "MobileAssetProperties.FormatVersion",
        "MobileAssetProperties.CompatibilityVersion",
    ]) {
        const valueResult = readRawPlistValue(infoPath, keyPath);
        if (valueResult.isErr()) {
            return null;
        }
        values.push(valueResult.value);
    }

    const [soundGroup, formatVersion, compatibilityVersion] = values.map((value) => Number.parseInt(value, 10));
    if (Number.isNaN(soundGroup + formatVersion + compatibilityVersion)) {
        return null;
    }

    return { soundGroup, formatVersion, compatibilityVersion };
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
    const targetResult = findSoundAsset(targetInput);
    if (targetResult.isErr()) {
        return err(targetResult.error);
    }

    const tempDir = mkdtempSync(join(tmpdir(), "comfort-sound-"));
    const domainPlist = join(tempDir, "domain.plist");
    const archiveBin = join(tempDir, "selected.bplist");
    const archiveXml = join(tempDir, "selected.xml");

    try {
        const archiveHex = unwrapOrThrow(updateSoundArchive(domainPlist, archiveBin, archiveXml, targetResult.value));
        unwrapOrThrow(writeSelectedSound(archiveHex));
        reloadHeardProcess();
        return ok(targetResult.value.name);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function findSoundAsset(targetInput: string): AppResult<SoundAsset> {
    const assetsResult = listAssets();
    if (assetsResult.isErr()) {
        return err(assetsResult.error);
    }

    const assets = assetsResult.value;
    if (assets.length === 0) {
        return err("no installed comfort sounds found");
    }

    const target = new Map(assets.map((asset) => [normalize(asset.name), asset])).get(normalize(targetInput));
    if (target === undefined) {
        const names = assets.map((asset) => asset.name).join(", ");
        return err(`unknown sound "${targetInput}"\navailable: ${names}`);
    }

    return ok(target);
}

function updateSoundArchive(
    domainPlist: string,
    archiveBin: string,
    archiveXml: string,
    target: SoundAsset,
): AppResult<string> {
    return selectedSoundArchive(domainPlist)
        .andThen((base64) => writeArchive(archiveBin, base64))
        .andThen(() => convertPlist(archiveBin, archiveXml, "xml1"))
        .andThen(() => replaceArchiveSound(archiveXml, target))
        .andThen(() => convertPlist(archiveXml, archiveBin, "binary1"))
        .map(() => readFileSync(archiveBin).toString("hex"));
}

function selectedSoundArchive(domainPlist: string): AppResult<string> {
    return run("defaults", ["export", DOMAIN, domainPlist])
        .andThen(() => readRawPlistValue(domainPlist, "ComfortSoundsSelectedSound"))
        .andThen((base64) => {
            if (base64 === "") {
                return err("ComfortSoundsSelectedSound not initialized; set one sound in System Settings first");
            }

            return ok(base64);
        });
}

function writeArchive(archiveBin: string, base64: string): AppResult<void> {
    writeFileSync(archiveBin, Buffer.from(base64, "base64"));
    return ok(undefined);
}

function convertPlist(sourcePath: string, destinationPath: string, format: "xml1" | "binary1"): AppResult<void> {
    return run("plutil", ["-convert", format, "-o", destinationPath, sourcePath]).map(() => undefined);
}

function writeSelectedSound(archiveHex: string): AppResult<void> {
    return runAll([
        () => run("defaults", ["write", DOMAIN, "ComfortSoundsSelectedSound", "-data", archiveHex]).map(() => undefined),
        () => run("defaults", ["write", DOMAIN, "comfortSoundsEnabled", "-bool", "YES"]).map(() => undefined),
        () =>
            run("defaults", [
                "write",
                DOMAIN,
                "lastEnablementTimestamp",
                String(Math.floor(Date.now() / 1000)),
            ]).map(() => undefined),
    ]);
}

function replaceArchiveSound(archiveXml: string, target: SoundAsset): AppResult<void> {
    const indexes = archiveSoundIndexes(archiveXml);
    return runAll(archiveReplacementOperations(archiveXml, indexes, target)).andThen(() =>
        updateArchiveMetadata(archiveXml, indexes.properties, target),
    );
}

function archiveSoundIndexes(archiveXml: string): ArchiveSoundIndexes {
    const name = unwrapOrThrow(extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundNameKey"));
    const pathObject = unwrapOrThrow(extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundPathKey"));
    const pathValue = unwrapOrThrow(extractUidAtPath(archiveXml, `$objects.${pathObject}.NS\\.relative`));
    const assetObject = unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, "$objects.1.HUComfortSoundAssetKey"));
    const assetIndexes = assetObject === null || assetObject <= 0 ? { assetId: null, properties: null } : readAssetIndexes(archiveXml, assetObject);

    return { name, pathValue, assetObject, ...assetIndexes };
}

function readAssetIndexes(archiveXml: string, assetObject: number): Pick<ArchiveSoundIndexes, "assetId" | "properties"> {
    return {
        assetId: unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, `$objects.${assetObject}.assetId`)),
        properties: unwrapOrThrow(extractUidAtPathIfPresent(archiveXml, `$objects.${assetObject}.properties`)),
    };
}

function archiveReplacementOperations(
    archiveXml: string,
    indexes: ArchiveSoundIndexes,
    target: SoundAsset,
): Array<() => AppResult<void>> {
    const operations: Array<() => AppResult<void>> = [
        () => replaceString(archiveXml, `$objects.${indexes.name}`, target.name),
        () => replaceString(archiveXml, `$objects.${indexes.pathValue}`, target.resourcePath),
        () => replaceInteger(archiveXml, "$objects.1.HUComfortSoundGroupKey", target.soundGroup),
    ];

    if (indexes.assetId !== null) {
        operations.push(() => replaceString(archiveXml, `$objects.${indexes.assetId}`, target.assetId));
    }
    if (indexes.assetObject !== null && indexes.assetObject > 0) {
        operations.push(() => replaceInteger(archiveXml, `$objects.${indexes.assetObject}.formatVersion`, target.formatVersion));
        operations.push(() =>
            replaceInteger(archiveXml, `$objects.${indexes.assetObject}.compatibilityVersion`, target.compatibilityVersion),
        );
    }

    return operations;
}

function updateArchiveMetadata(archiveXml: string, propertiesIdx: number | null, target: SoundAsset): AppResult<void> {
    if (propertiesIdx === null) {
        return ok(undefined);
    }

    const valueIdxByKey = metadataValueIndexes(archiveXml, propertiesIdx);

    return runAll([
        () => setIfPresentString(archiveXml, valueIdxByKey, "SoundName", target.name),
        () => setIfPresentInteger(archiveXml, valueIdxByKey, "SoundGroup", target.soundGroup),
        () => setIfPresentInteger(archiveXml, valueIdxByKey, "FormatVersion", target.formatVersion),
        () => setIfPresentInteger(archiveXml, valueIdxByKey, "CompatibilityVersion", target.compatibilityVersion),
    ]);
}

function metadataValueIndexes(archiveXml: string, propertiesIdx: number): Map<string, number> {
    const keyIndexes = arrayOrEmpty(extractUidArrayIfPresent(archiveXml, `$objects.${propertiesIdx}.NS\\.keys`));
    const valueIndexes = arrayOrEmpty(extractUidArrayIfPresent(archiveXml, `$objects.${propertiesIdx}.NS\\.objects`));
    const valueIndexByKey = new Map<string, number>();

    for (const [index, keyIndex] of keyIndexes.entries()) {
        const valueIndex = valueIndexes[index];
        if (valueIndex !== undefined) {
            valueIndexByKey.set(unwrapOrThrow(readRawPlistValue(archiveXml, `$objects.${keyIndex}`)), valueIndex);
        }
    }

    return valueIndexByKey;
}

function arrayOrEmpty(result: AppResult<number[] | null>): number[] {
    return unwrapOrThrow(result) ?? [];
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

    if (command !== "set") {
        console.error(`comfort_sound_helper: unknown command: ${command}`);
        return 1;
    }

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

process.exit(main());
