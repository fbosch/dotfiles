#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { batchScanWarning, cursorFileForFlake, prepareInputBatch } from "./update_batch.js";

type AppResult<T> = Result<T, string>;

type UpdateInfo = {
    name: string;
    currentShort: string;
    newShort: string;
};

type ScanResult = {
    source: "cache" | "live";
    timestamp: string;
    checkedAtEpoch: number;
    lockHash: string;
    scannedCount: number;
    totalInputs: number;
    partial: boolean;
    count: number;
    updates: UpdateInfo[];
};

type ScanUpdatesResult = {
    updates: UpdateInfo[];
    scannedCount: number;
    totalInputs: number;
    partial: boolean;
};

type FlakeLock = {
    nodes?: Record<string, { locked?: { rev?: string }; inputs?: Record<string, string> }>;
};

const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_UPDATE_TIMEOUT_MS = 8_000;

const ArgsSchema = z.object({
    command: z.literal("scan"),
    flakePath: z.string().min(1),
});

const EnvSchema = z.object({
    FLAKE_UPDATE_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(315360000).default(600),
    FLAKE_UPDATE_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(DEFAULT_BATCH_SIZE),
    FLAKE_UPDATE_CURSOR: z
        .preprocess((value) => {
            if (value === undefined) {
                return undefined;
            }
            if (typeof value !== "string") {
                return value;
            }

            const normalized = value.trim().toLowerCase();
            if (["1", "true", "yes", "on"].includes(normalized)) {
                return true;
            }
            if (["0", "false", "no", "off"].includes(normalized)) {
                return false;
            }

            return value;
        }, z.boolean())
        .default(true),
    FLAKE_UPDATE_CURSOR_FILE: z.string().min(1).optional(),
    FLAKE_UPDATE_FORCE: z
        .preprocess((value) => {
            if (value === undefined) {
                return undefined;
            }
            if (typeof value !== "string") {
                return value;
            }

            const normalized = value.trim().toLowerCase();
            if (["1", "true", "yes", "on"].includes(normalized)) {
                return true;
            }
            if (["0", "false", "no", "off"].includes(normalized)) {
                return false;
            }

            return value;
        }, z.boolean())
        .default(false),
    FLAKE_UPDATE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(DEFAULT_UPDATE_TIMEOUT_MS),
    XDG_CACHE_HOME: z.string().min(1).optional(),
    HOME: z.string().min(1).optional(),
});

function usage(): void {
    console.log("Usage: flake_update_engine.ts scan <FLAKE_PATH>");
    console.log("   or: flake_update_engine.ts lines <FLAKE_PATH>");
    console.log("Env overrides:");
    console.log("  FLAKE_UPDATE_CACHE_TTL_SECONDS default 600");
    console.log(`  FLAKE_UPDATE_BATCH_SIZE       default ${DEFAULT_BATCH_SIZE}`);
    console.log("  FLAKE_UPDATE_CURSOR           default 1 (set 0 to disable rotating batches)");
    console.log("  FLAKE_UPDATE_CURSOR_FILE      optional explicit cursor file path");
    console.log("  FLAKE_UPDATE_FORCE             default 0");
    console.log(`  FLAKE_UPDATE_TIMEOUT_MS        default ${DEFAULT_UPDATE_TIMEOUT_MS}`);
}

function emitLineMode(result: ScanResult): void {
    console.log(`count\t${result.count}`);
    console.log(`partial\t${result.partial}`);
    console.log(`scannedCount\t${result.scannedCount}`);
    console.log(`totalInputs\t${result.totalInputs}`);
    console.log(`source\t${result.source}`);
    console.log(`timestamp\t${result.timestamp}`);
    for (const update of result.updates) {
        console.log(["update", update.name, update.currentShort, update.newShort].join("\t"));
    }
}

function cacheFilePath(): string {
    const cacheRoot =
        process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : join("/tmp", ".cache"));
    return join(cacheRoot, "flake-updates.json");
}

function ensureCacheDir(filePath: string): AppResult<void> {
    try {
        mkdirSync(resolve(filePath, ".."), { recursive: true });
        return ok(undefined);
    } catch {
        const parent = filePath.slice(0, filePath.lastIndexOf("/"));
        if (parent.length === 0) {
            return ok(undefined);
        }

        try {
            mkdirSync(parent, { recursive: true });
            return ok(undefined);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return err(message);
        }
    }
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

function lockHash(lockRaw: string): string {
    return createHash("sha256").update(lockRaw).digest("hex");
}

function shortRev(rev: string): string {
    return rev.slice(0, 7);
}

function restoreLock(lockPath: string, originalLockRaw: string): AppResult<void> {
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
        return err(result.error.message || `update failed for input ${input}`);
    }

    if (result.signal === "SIGTERM") {
        return err(`timeout after ${timeoutMs}ms for input ${input}`);
    }

    if (result.status !== 0) {
        return err(`update failed for input ${input} (exit ${result.status ?? "unknown"})`);
    }

    return ok(undefined);
}

function readCache(filePath: string): AppResult<ScanResult | null> {
    if (!existsSync(filePath)) {
        return ok(null);
    }

    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as ScanResult;
        return ok(parsed);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function writeCache(filePath: string, result: ScanResult): AppResult<void> {
    const ensureResult = ensureCacheDir(filePath);
    if (ensureResult.isErr()) {
        return err(ensureResult.error);
    }

    try {
        writeFileSync(filePath, `${JSON.stringify(result)}\n`, "utf8");
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function cachedResultUsable(result: ScanResult, expectedHash: string, ttlSeconds: number): boolean {
    if (result.partial) {
        return false;
    }

    if (result.lockHash !== expectedHash) {
        return false;
    }

    const age = Math.floor(Date.now() / 1000) - result.checkedAtEpoch;
    return age >= 0 && age < ttlSeconds;
}

function asCachedResult(result: ScanResult): ScanResult {
    return {
        ...result,
        source: "cache",
    };
}

function loadCachedResult(cachePath: string, expectedHash: string, ttlSeconds: number): AppResult<ScanResult | null> {
    const cachedResult = readCache(cachePath);
    if (cachedResult.isErr()) {
        return err(cachedResult.error);
    }

    if (cachedResult.value && cachedResultUsable(cachedResult.value, expectedHash, ttlSeconds)) {
        return ok(asCachedResult(cachedResult.value));
    }

    return ok(null);
}

type ScanInputOptions = {
    flakePath: string;
    lockPath: string;
    originalLockRaw: string;
    initialLock: FlakeLock;
    rootInputs: Record<string, string>;
    timeoutMs: number;
};

function scanInput(options: ScanInputOptions, input: string): AppResult<UpdateInfo | undefined> {
    const restoreResult = restoreLock(options.lockPath, options.originalLockRaw);
    if (restoreResult.isErr()) {
        return err(restoreResult.error);
    }

    const currentRev = inputRevision(options.initialLock, options.rootInputs, input);
    if (!currentRev) {
        return ok(undefined);
    }

    const updatedLock = updateInputLock(options, input);
    if (!updatedLock) {
        return ok(undefined);
    }

    return ok(createUpdateInfo(input, currentRev, inputRevision(updatedLock, options.rootInputs, input)));
}

function inputRevision(lock: FlakeLock, rootInputs: Record<string, string>, input: string): string | undefined {
    const nodeName = rootInputs[input];
    if (!nodeName) {
        return undefined;
    }

    return lock.nodes?.[nodeName]?.locked?.rev;
}

function updateInputLock(options: ScanInputOptions, input: string): FlakeLock | undefined {
    const updateResult = runNixUpdate(options.flakePath, input, options.timeoutMs);
    if (updateResult.isErr()) {
        console.error(`flake_update_engine: ${updateResult.error}`);
        return undefined;
    }

    const updatedLockResult = loadLock(options.lockPath);
    if (updatedLockResult.isErr()) {
        console.error(`flake_update_engine: ${updatedLockResult.error}`);
        return undefined;
    }

    return updatedLockResult.value;
}

function createUpdateInfo(input: string, currentRev: string, newRev: string | undefined): UpdateInfo | undefined {
    if (!newRev) {
        return undefined;
    }

    if (newRev === currentRev) {
        return undefined;
    }

    return { name: input, currentShort: shortRev(currentRev), newShort: shortRev(newRev) };
}

function scanUpdates(
    flakePath: string,
    timeoutMs: number,
    batchSize: number,
    useCursor: boolean,
    cursorFile: string,
): AppResult<ScanUpdatesResult> {
    const contextResult = loadScanContext(flakePath);
    if (contextResult.isErr()) {
        return err(contextResult.error);
    }

    const context = contextResult.value;
    const allInputs = Object.keys(context.rootInputs).sort();
    const batch = prepareInputBatch(allInputs, batchSize, useCursor, cursorFile);
    const originalLockRaw = readFileSync(context.lockPath, "utf8");
    reportBatchDiagnostics(batch, allInputs.length, batchSize);
    const updatesResult = scanBatch(
        {
            flakePath,
            lockPath: context.lockPath,
            originalLockRaw,
            initialLock: context.initialLock,
            rootInputs: context.rootInputs,
            timeoutMs,
        },
        batch.inputs,
    );
    if (updatesResult.isErr()) {
        return err(updatesResult.error);
    }

    return ok({
        updates: updatesResult.value,
        scannedCount: batch.inputs.length,
        totalInputs: allInputs.length,
        partial: allInputs.length > batch.inputs.length,
    });
}

type ScanContext = {
    lockPath: string;
    initialLock: FlakeLock;
    rootInputs: Record<string, string>;
};

function loadScanContext(flakePath: string): AppResult<ScanContext> {
    const lockPath = join(flakePath, "flake.lock");
    const initialLockResult = loadLock(lockPath);
    if (initialLockResult.isErr()) {
        return err(initialLockResult.error);
    }

    const rootInputs = initialLockResult.value.nodes?.root?.inputs;
    if (!rootInputs) {
        return err("failed to get flake inputs");
    }

    return ok({ lockPath, initialLock: initialLockResult.value, rootInputs });
}

function reportBatchDiagnostics(
    batch: ReturnType<typeof prepareInputBatch>,
    totalInputs: number,
    batchSize: number,
): void {
    if (batch.cursorError) {
        console.error(`flake_update_engine: failed to save cursor (${batch.cursorError})`);
    }

    const batchWarning = batchScanWarning(batch, totalInputs, batchSize);
    if (batchWarning) {
        console.error(`flake_update_engine: ${batchWarning}`);
    }
}

function scanBatch(options: ScanInputOptions, inputs: string[]): AppResult<UpdateInfo[]> {
    try {
        return collectScannedUpdates(options, inputs);
    } finally {
        restoreLock(options.lockPath, options.originalLockRaw);
    }
}

function collectScannedUpdates(options: ScanInputOptions, inputs: string[]): AppResult<UpdateInfo[]> {
    const updates: UpdateInfo[] = [];
    for (const input of inputs) {
        const updateResult = scanInput(options, input);
        if (updateResult.isErr()) {
            return err(updateResult.error);
        }
        if (updateResult.value) {
            updates.push(updateResult.value);
        }
    }

    return ok(updates);
}

function scan(
    flakePath: string,
    ttlSeconds: number,
    force: boolean,
    timeoutMs: number,
    batchSize: number,
    useCursor: boolean,
    cursorFile: string,
): AppResult<ScanResult> {
    const lockPath = join(flakePath, "flake.lock");
    if (existsSync(lockPath) === false) {
        return err(`No flake.lock found in ${flakePath}`);
    }

    const lockRaw = readFileSync(lockPath, "utf8");
    const currentHash = lockHash(lockRaw);
    const cachePath = cacheFilePath();

    const cachedResult = force ? ok(null) : loadCachedResult(cachePath, currentHash, ttlSeconds);
    if (cachedResult.isErr()) {
        console.error(`flake_update_engine: failed to read cache (${cachedResult.error})`);
    } else if (cachedResult.value) {
        return ok(cachedResult.value);
    }

    const updatesResult = scanUpdates(flakePath, timeoutMs, batchSize, useCursor, cursorFile);
    if (updatesResult.isErr()) {
        return err(updatesResult.error);
    }

    const result: ScanResult = {
        source: "live",
        timestamp: new Date().toISOString(),
        checkedAtEpoch: Math.floor(Date.now() / 1000),
        lockHash: currentHash,
        scannedCount: updatesResult.value.scannedCount,
        totalInputs: updatesResult.value.totalInputs,
        partial: updatesResult.value.partial,
        count: updatesResult.value.updates.length,
        updates: updatesResult.value.updates,
    };

    if (!result.partial) {
        const writeResult = writeCache(cachePath, result);
        if (writeResult.isErr()) {
            console.error(`flake_update_engine: failed to write cache (${writeResult.error})`);
        }
    }

    return ok(result);
}

function main(): number {
    const [, , command, flakePathArg] = process.argv;
    if (!command || command === "-h" || command === "--help") {
        usage();
        return command ? 0 : 1;
    }

    const parsedArgs = ArgsSchema.safeParse({
        command: command === "lines" ? "scan" : command,
        flakePath: flakePathArg,
    });
    if (!parsedArgs.success) {
        const summary = parsedArgs.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        console.error(`flake_update_engine: invalid args (${summary})`);
        return 1;
    }

    const parsedEnv = EnvSchema.safeParse(process.env);
    if (!parsedEnv.success) {
        const summary = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        console.error(`flake_update_engine: invalid env (${summary})`);
        return 1;
    }

    const flakePath = resolve(parsedArgs.data.flakePath);
    const cursorFile = cursorFileForFlake(flakePath, parsedEnv.data.FLAKE_UPDATE_CURSOR_FILE, "flake_update_engine");
    const result = scan(
        flakePath,
        parsedEnv.data.FLAKE_UPDATE_CACHE_TTL_SECONDS,
        parsedEnv.data.FLAKE_UPDATE_FORCE,
        parsedEnv.data.FLAKE_UPDATE_TIMEOUT_MS,
        parsedEnv.data.FLAKE_UPDATE_BATCH_SIZE,
        parsedEnv.data.FLAKE_UPDATE_CURSOR,
        cursorFile,
    );
    if (result.isErr()) {
        console.error(`flake_update_engine: ${result.error}`);
        return 1;
    }

    if (command === "lines") {
        emitLineMode(result.value);
    } else {
        console.log(JSON.stringify(result.value));
    }
    return 0;
}

process.exit(main());
