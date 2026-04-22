#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type FlakeLock = {
    nodes?: Record<string, { locked?: { rev?: string }; inputs?: Record<string, string> }>;
};

type UpdateInfo = {
    name: string;
    currentRev: string;
    currentShort: string;
    newRev: string;
    newShort: string;
};

type UpdateResult = {
    count: number;
    updates: UpdateInfo[];
};

const EMPTY_RESULT: UpdateResult = { count: 0, updates: [] };

function usage(): void {
    console.log("Usage: flake_check_updates.ts [FLAKE_PATH]");
}

function emitResult(result: UpdateResult): void {
    console.log(JSON.stringify(result));
}

function loadLock(lockPath: string): FlakeLock | null {
    try {
        const raw = readFileSync(lockPath, "utf8");
        return JSON.parse(raw) as FlakeLock;
    } catch {
        return null;
    }
}

function runNixUpdate(flakePath: string, input: string): void {
    spawnSync("nix", ["flake", "update", "--update-input", input], {
        cwd: flakePath,
        stdio: "ignore",
    });
}

function shortRev(rev: string): string {
    return rev.slice(0, 7);
}

function main(): number {
    const args = process.argv.slice(2);
    if (args[0] === "-h" || args[0] === "--help") {
        usage();
        return 0;
    }

    const defaultFlakePath = process.env.HOME ? `${process.env.HOME}/nixos` : "~/nixos";
    const rawPath = args[0] ?? defaultFlakePath;
    const flakePath = rawPath.startsWith("~/") && process.env.HOME ? join(process.env.HOME, rawPath.slice(2)) : rawPath;
    const resolvedFlakePath = resolve(flakePath);
    const lockPath = join(resolvedFlakePath, "flake.lock");

    if (!existsSync(lockPath)) {
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const initialLock = loadLock(lockPath);
    if (!initialLock?.nodes?.root?.inputs) {
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const rootInputs = initialLock.nodes.root.inputs;
    const inputList = Object.keys(rootInputs);
    const originalLockRaw = readFileSync(lockPath, "utf8");
    const updates: UpdateInfo[] = [];

    try {
        for (const input of inputList) {
            writeFileSync(lockPath, originalLockRaw, "utf8");

            const nodeName = rootInputs[input];
            if (!nodeName) {
                continue;
            }

            const nodeData = initialLock.nodes?.[nodeName];
            const currentRev = nodeData?.locked?.rev;
            if (!currentRev) {
                continue;
            }

            runNixUpdate(resolvedFlakePath, input);

            const updatedLock = loadLock(lockPath);
            const updatedNode = updatedLock?.nodes?.[nodeName];
            const newRev = updatedNode?.locked?.rev;

            if (!newRev || newRev === currentRev) {
                continue;
            }

            updates.push({
                name: input,
                currentRev,
                currentShort: shortRev(currentRev),
                newRev,
                newShort: shortRev(newRev),
            });
        }
    } catch (error) {
        writeFileSync(lockPath, originalLockRaw, "utf8");
        console.error(`flake_check_updates: ${error instanceof Error ? error.message : String(error)}`);
        emitResult(EMPTY_RESULT);
        return 1;
    }

    writeFileSync(lockPath, originalLockRaw, "utf8");
    emitResult({ count: updates.length, updates });
    return 0;
}

process.exit(main());
