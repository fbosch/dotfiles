#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";

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

type AppResult<T> = Result<T, string>;

const EMPTY_RESULT: UpdateResult = { count: 0, updates: [] };
const DEFAULT_MAX_INPUTS = 20;

function usage(): void {
    console.log("Usage: flake_check_updates.ts [FLAKE_PATH]");
    console.log("Env overrides:");
    console.log("  FLAKE_CHECK_MAX_INPUTS       default 20");
}

function emitResult(result: UpdateResult): void {
    console.log(JSON.stringify(result));
}

function parsePositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
}

function loadLock(lockPath: string): AppResult<FlakeLock> {
    try {
        const raw = readFileSync(lockPath, "utf8");
        return ok(JSON.parse(raw) as FlakeLock);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function restoreOriginalLock(lockPath: string, originalLockRaw: string): AppResult<void> {
    try {
        writeFileSync(lockPath, originalLockRaw, "utf8");
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function runNixUpdate(flakePath: string, input: string): AppResult<void> {
    const result = spawnSync("nix", ["flake", "update", "--update-input", input], {
        cwd: flakePath,
        stdio: "ignore",
    });

    if (result.error) {
        const message = result.error.message || `failed update for input ${input}`;
        return err(message);
    }

    if (result.status !== 0) {
        return err(`update failed for input ${input} (exit ${result.status ?? "unknown"})`);
    }

    return ok(undefined);
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
    const maxInputs = parsePositiveIntEnv("FLAKE_CHECK_MAX_INPUTS", DEFAULT_MAX_INPUTS);

    if (!existsSync(lockPath)) {
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const initialLockResult = loadLock(lockPath);
    if (initialLockResult.isErr()) {
        console.error(`flake_check_updates: failed to read lock file: ${initialLockResult.error}`);
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const initialLock = initialLockResult.value;
    if (!initialLock.nodes?.root?.inputs) {
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const rootInputs = initialLock.nodes.root.inputs;
    const allInputs = Object.keys(rootInputs).sort();
    const inputList = allInputs.slice(0, maxInputs);
    const originalLockRaw = readFileSync(lockPath, "utf8");
    const updates: UpdateInfo[] = [];
    const warnings: string[] = [];

    if (allInputs.length > maxInputs) {
        warnings.push(`input scan capped at ${maxInputs}/${allInputs.length}`);
    }

    try {
        for (const input of inputList) {
            const restoreResult = restoreOriginalLock(lockPath, originalLockRaw);
            if (restoreResult.isErr()) {
                console.error(`flake_check_updates: failed to restore lock file: ${restoreResult.error}`);
                emitResult(EMPTY_RESULT);
                return 1;
            }

            const nodeName = rootInputs[input];
            if (!nodeName) {
                continue;
            }

            const nodeData = initialLock.nodes?.[nodeName];
            const currentRev = nodeData?.locked?.rev;
            if (!currentRev) {
                continue;
            }

            const updateResult = runNixUpdate(resolvedFlakePath, input);
            if (updateResult.isErr()) {
                warnings.push(`${input}: ${updateResult.error}`);
                continue;
            }

            const updatedLockResult = loadLock(lockPath);
            if (updatedLockResult.isErr()) {
                warnings.push(`${input}: failed to read updated lock (${updatedLockResult.error})`);
                continue;
            }

            const updatedNode = updatedLockResult.value.nodes?.[nodeName];
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
        restoreOriginalLock(lockPath, originalLockRaw);
        console.error(`flake_check_updates: ${error instanceof Error ? error.message : String(error)}`);
        emitResult(EMPTY_RESULT);
        return 1;
    }

    const finalRestoreResult = restoreOriginalLock(lockPath, originalLockRaw);
    if (finalRestoreResult.isErr()) {
        console.error(`flake_check_updates: failed final lock restore: ${finalRestoreResult.error}`);
        emitResult(EMPTY_RESULT);
        return 1;
    }

    for (const warning of warnings) {
        console.error(`flake_check_updates: ${warning}`);
    }

    emitResult({ count: updates.length, updates });
    return 0;
}

process.exit(main());
