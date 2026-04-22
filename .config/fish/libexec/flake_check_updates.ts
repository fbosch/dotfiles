#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_UPDATE_TIMEOUT_MS = 8_000;

function usage(): void {
    console.log("Usage: flake_check_updates.ts [FLAKE_PATH]");
    console.log("Env overrides:");
    console.log("  FLAKE_CHECK_BATCH_SIZE       default 3");
    console.log("  FLAKE_CHECK_TIMEOUT_MS       default 8000");
    console.log("  FLAKE_CHECK_CURSOR           default 1 (set 0 to disable rotating batches)");
    console.log("  FLAKE_CHECK_CURSOR_FILE      optional explicit cursor file path");
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

function parseBoundedPositiveIntEnv(name: string, fallback: number, maxValue: number): number {
    const parsed = parsePositiveIntEnv(name, fallback);
    return Math.min(parsed, maxValue);
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }

    return fallback;
}

function cursorFileForFlake(resolvedFlakePath: string): string {
    if (process.env.FLAKE_CHECK_CURSOR_FILE) {
        return resolve(process.env.FLAKE_CHECK_CURSOR_FILE);
    }

    const cacheRoot = process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : "/tmp");
    const key = createHash("sha1").update(resolvedFlakePath).digest("hex");
    return join(cacheRoot, "flake_check_updates", `${key}.cursor`);
}

function loadCursor(cursorFile: string): number {
    if (!existsSync(cursorFile)) {
        return 0;
    }

    try {
        const raw = readFileSync(cursorFile, "utf8").trim();
        const parsed = Number.parseInt(raw, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
            return 0;
        }

        return parsed;
    } catch {
        return 0;
    }
}

function saveCursor(cursorFile: string, nextCursor: number): AppResult<void> {
    try {
        mkdirSync(dirname(cursorFile), { recursive: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }

    try {
        writeFileSync(cursorFile, `${nextCursor}\n`, "utf8");
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function buildBatch(allInputs: string[], start: number, batchSize: number): string[] {
    if (allInputs.length <= batchSize) {
        return allInputs;
    }

    const batch: string[] = [];
    for (let i = 0; i < batchSize; i += 1) {
        const idx = (start + i) % allInputs.length;
        batch.push(allInputs[idx]);
    }

    return batch;
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

function runNixUpdate(flakePath: string, input: string, timeoutMs: number): AppResult<void> {
    const result = spawnSync("nice", ["-n", "15", "nix", "flake", "update", "--update-input", input], {
        cwd: flakePath,
        stdio: "ignore",
        timeout: timeoutMs,
    });

    if (result.error) {
        const message = result.error.message || `failed update for input ${input}`;
        return err(message);
    }

    if (result.status !== 0) {
        if (result.signal === "SIGTERM") {
            return err(`timeout after ${timeoutMs}ms for input ${input}`);
        }
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
    const batchSize = parseBoundedPositiveIntEnv("FLAKE_CHECK_BATCH_SIZE", DEFAULT_BATCH_SIZE, 25);
    const updateTimeoutMs = parseBoundedPositiveIntEnv("FLAKE_CHECK_TIMEOUT_MS", DEFAULT_UPDATE_TIMEOUT_MS, 60_000);
    const useCursor = parseBooleanEnv("FLAKE_CHECK_CURSOR", true);

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
    const cursorFile = cursorFileForFlake(resolvedFlakePath);
    const cursor = useCursor ? loadCursor(cursorFile) : 0;
    const start = allInputs.length > 0 ? cursor % allInputs.length : 0;
    const inputList = buildBatch(allInputs, start, batchSize);
    const originalLockRaw = readFileSync(lockPath, "utf8");
    const updates: UpdateInfo[] = [];
    const warnings: string[] = [];

    if (allInputs.length > batchSize) {
        warnings.push(`batch scan ${inputList.length}/${allInputs.length} starting at index ${start}`);
    }

    if (useCursor && allInputs.length > 0) {
        const nextCursor = (start + inputList.length) % allInputs.length;
        const saveResult = saveCursor(cursorFile, nextCursor);
        if (saveResult.isErr()) {
            warnings.push(`failed to save cursor: ${saveResult.error}`);
        }
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

            const updateResult = runNixUpdate(resolvedFlakePath, input, updateTimeoutMs);
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
