#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = "/System/Library/AssetsV2/com_apple_MobileAsset_ComfortSoundsAssets";
const DOMAIN = "com.apple.ComfortSounds";

type SoundAsset = {
    name: string;
    assetId: string;
    soundGroup: number;
    formatVersion: number;
    compatibilityVersion: number;
};

function run(command: string, args: string[]): string {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0) {
        const error = (result.stderr || result.stdout || `${command} failed`).trim();
        throw new Error(error);
    }
    return result.stdout;
}

function normalize(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readRawPlistValue(filePath: string, keyPath: string): string {
    return run("plutil", ["-extract", keyPath, "raw", "-o", "-", filePath]).trim();
}

function listAssets(): SoundAsset[] {
    if (!existsSync(BASE)) {
        throw new Error(`missing assets directory: ${BASE}`);
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

        const name = readRawPlistValue(infoPath, "MobileAssetProperties.SoundName");
        if (!name) {
            continue;
        }

        const soundGroup = Number.parseInt(readRawPlistValue(infoPath, "MobileAssetProperties.SoundGroup"), 10);
        const formatVersion = Number.parseInt(readRawPlistValue(infoPath, "MobileAssetProperties.FormatVersion"), 10);
        const compatibilityVersion = Number.parseInt(
            readRawPlistValue(infoPath, "MobileAssetProperties.CompatibilityVersion"),
            10,
        );

        assets.push({
            name,
            assetId: entry.name.replace(/\.asset$/, ""),
            soundGroup,
            formatVersion,
            compatibilityVersion,
        });
    }

    assets.sort((a, b) => a.name.localeCompare(b.name));
    return assets;
}

function extractUid(xml: string): number {
    const match = xml.match(/<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/);
    if (!match) {
        throw new Error("failed to parse CF$UID");
    }
    return Number.parseInt(match[1], 10);
}

function extractUidAtPath(plistPath: string, keyPath: string): number {
    const xml = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    return extractUid(xml);
}

function extractUidArray(plistPath: string, keyPath: string): number[] {
    const xml = run("plutil", ["-extract", keyPath, "xml1", "-o", "-", plistPath]);
    const matches = [...xml.matchAll(/<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/g)];
    return matches.map((match) => Number.parseInt(match[1], 10));
}

function replaceString(plistPath: string, keyPath: string, value: string): void {
    const indexMatch = keyPath.match(/^\$objects\.(\d+)$/);
    if (indexMatch) {
        const index = Number.parseInt(indexMatch[1], 10);
        run("plutil", ["-replace", keyPath, "-string", value, plistPath]);
        run("plutil", ["-remove", `$objects.${index + 1}`, plistPath]);
        return;
    }

    run("plutil", ["-replace", keyPath, "-string", value, plistPath]);
}

function replaceInteger(plistPath: string, keyPath: string, value: number): void {
    const indexMatch = keyPath.match(/^\$objects\.(\d+)$/);
    if (indexMatch) {
        const index = Number.parseInt(indexMatch[1], 10);
        run("plutil", ["-replace", keyPath, "-integer", String(value), plistPath]);
        run("plutil", ["-remove", `$objects.${index + 1}`, plistPath]);
        return;
    }

    run("plutil", ["-replace", keyPath, "-integer", String(value), plistPath]);
}

function setIfPresentString(plistPath: string, indexByKey: Map<string, number>, key: string, value: string): void {
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
        replaceString(plistPath, `$objects.${idx}`, value);
    }
}

function setIfPresentInteger(plistPath: string, indexByKey: Map<string, number>, key: string, value: number): void {
    const idx = indexByKey.get(key);
    if (idx !== undefined) {
        replaceInteger(plistPath, `$objects.${idx}`, value);
    }
}

function reloadHeardProcess(): void {
    const uid = run("id", ["-u"]).trim();
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

function setSound(targetInput: string): string {
    const assets = listAssets();
    if (assets.length === 0) {
        throw new Error("no installed comfort sounds found");
    }

    const byNormalizedName = new Map<string, SoundAsset>();
    for (const asset of assets) {
        byNormalizedName.set(normalize(asset.name), asset);
    }

    const target = byNormalizedName.get(normalize(targetInput));
    if (!target) {
        const names = assets.map((asset) => asset.name).join(", ");
        throw new Error(`unknown sound "${targetInput}"\navailable: ${names}`);
    }

    const tempDir = mkdtempSync(join(tmpdir(), "comfort-sound-"));
    const domainPlist = join(tempDir, "domain.plist");
    const archiveBin = join(tempDir, "selected.bplist");
    const archiveXml = join(tempDir, "selected.xml");

    try {
        run("defaults", ["export", DOMAIN, domainPlist]);
        const selectedBase64 = readRawPlistValue(domainPlist, "ComfortSoundsSelectedSound");
        if (!selectedBase64) {
            throw new Error("ComfortSoundsSelectedSound not initialized; set one sound in System Settings first");
        }

        writeFileSync(archiveBin, Buffer.from(selectedBase64, "base64"));
        run("plutil", ["-convert", "xml1", "-o", archiveXml, archiveBin]);

        const nameIdx = extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundNameKey");
        const pathObjectIdx = extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundPathKey");
        const pathValueIdx = extractUidAtPath(archiveXml, `$objects.${pathObjectIdx}.NS\\.relative`);

        const assetObjectIdx = extractUidAtPath(archiveXml, "$objects.1.HUComfortSoundAssetKey");
        const assetIdIdx = extractUidAtPath(archiveXml, `$objects.${assetObjectIdx}.assetId`);
        const propertiesIdx = extractUidAtPath(archiveXml, `$objects.${assetObjectIdx}.properties`);

        replaceString(archiveXml, `$objects.${nameIdx}`, target.name);
        replaceString(archiveXml, `$objects.${pathValueIdx}`, `file://${BASE}/${target.assetId}.asset/AssetData/`);
        replaceString(archiveXml, `$objects.${assetIdIdx}`, target.assetId);

        replaceInteger(archiveXml, "$objects.1.HUComfortSoundGroupKey", target.soundGroup);
        replaceInteger(archiveXml, `$objects.${assetObjectIdx}.formatVersion`, target.formatVersion);
        replaceInteger(archiveXml, `$objects.${assetObjectIdx}.compatibilityVersion`, target.compatibilityVersion);

        const keyIdxList = extractUidArray(archiveXml, `$objects.${propertiesIdx}.NS\\.keys`);
        const valueIdxList = extractUidArray(archiveXml, `$objects.${propertiesIdx}.NS\\.objects`);
        const valueIdxByKey = new Map<string, number>();

        const pairCount = Math.min(keyIdxList.length, valueIdxList.length);
        for (let i = 0; i < pairCount; i += 1) {
            const keyName = readRawPlistValue(archiveXml, `$objects.${keyIdxList[i]}`);
            valueIdxByKey.set(keyName, valueIdxList[i]);
        }

        setIfPresentString(archiveXml, valueIdxByKey, "SoundName", target.name);
        setIfPresentInteger(archiveXml, valueIdxByKey, "SoundGroup", target.soundGroup);
        setIfPresentInteger(archiveXml, valueIdxByKey, "FormatVersion", target.formatVersion);
        setIfPresentInteger(archiveXml, valueIdxByKey, "CompatibilityVersion", target.compatibilityVersion);

        run("plutil", ["-convert", "binary1", "-o", archiveBin, archiveXml]);
        const archiveHex = readFileSync(archiveBin).toString("hex");

        run("defaults", ["write", DOMAIN, "ComfortSoundsSelectedSound", "-data", archiveHex]);
        run("defaults", ["write", DOMAIN, "comfortSoundsEnabled", "-bool", "YES"]);
        run("defaults", ["write", DOMAIN, "lastEnablementTimestamp", String(Math.floor(Date.now() / 1000))]);

        reloadHeardProcess();
        return target.name;
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

function usage(): void {
    console.log("Usage: comfort_sound_helper.ts <list|set> [SOUND_NAME]");
}

function main(): void {
    const [, , command, ...args] = process.argv;

    if (!command || command === "-h" || command === "--help") {
        usage();
        process.exit(0);
    }

    if (command === "list") {
        const names = listAssets().map((asset) => asset.name);
        for (const name of names) {
            console.log(name);
        }
        return;
    }

    if (command === "set") {
        if (args.length === 0) {
            throw new Error("set requires SOUND_NAME");
        }
        const selected = setSound(args.join(" "));
        console.log(selected);
        return;
    }

    throw new Error(`unknown command: ${command}`);
}

try {
    main();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`comfort_sound_helper: ${message}`);
    process.exit(1);
}
