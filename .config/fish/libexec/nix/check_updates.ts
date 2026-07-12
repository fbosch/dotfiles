#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { batchScanWarning, cursorFileForFlake, prepareInputBatch } from "./update_batch.js";

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
const DEFAULT_BATCH_SIZE = 3;
const DEFAULT_UPDATE_TIMEOUT_MS = 8_000;

const NodeSchema = z
    .object({
        locked: z
            .object({
                rev: z.string().min(1).optional(),
            })
            .optional(),
        inputs: z.record(z.string(), z.string()).optional(),
    })
    .passthrough();

const FlakeLockSchema = z
    .object({
        nodes: z.record(z.string(), NodeSchema),
    })
    .passthrough();

const EnvSchema = z.object({
    FLAKE_CHECK_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(DEFAULT_BATCH_SIZE),
    FLAKE_CHECK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(DEFAULT_UPDATE_TIMEOUT_MS),
    FLAKE_CHECK_CURSOR: z
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
    FLAKE_CHECK_CURSOR_FILE: z.string().min(1).optional(),
});

const EMPTY_RESULT: UpdateResult = { count: 0, updates: [] };

function usage(): void {
    console.log("Usage: flake_check_updates.ts [FLAKE_PATH]");
    console.log("Env overrides:");
    console.log(`  FLAKE_CHECK_BATCH_SIZE       default ${DEFAULT_BATCH_SIZE}`);
    console.log(`  FLAKE_CHECK_TIMEOUT_MS       default ${DEFAULT_UPDATE_TIMEOUT_MS}`);
    console.log("  FLAKE_CHECK_CURSOR           default 1 (set 0 to disable rotating batches)");
    console.log("  FLAKE_CHECK_CURSOR_FILE      optional explicit cursor file path");
}

function emitResult(result: UpdateResult): void {
    console.log(JSON.stringify(result));
}
function loadLock(lockPath: string): AppResult<FlakeLock> {
    try {
        const raw = readFileSync(lockPath, "utf8");
        const parsed = JSON.parse(raw);
        const validated = FlakeLockSchema.safeParse(parsed);
        if (!validated.success) {
            const summary = validated.error.issues
                .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                .join("; ");
            return err(`invalid flake.lock shape (${summary})`);
        }

        return ok(validated.data as FlakeLock);
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

type CheckInputsOptions = {
    flakePath: string;
    lockPath: string;
    originalLockRaw: string;
    initialLock: FlakeLock;
    rootInputs: Record<string, string>;
    inputs: string[];
    timeoutMs: number;
    warnings: string[];
};

type InputCheck = {
    update?: UpdateInfo;
    warning?: string;
};

function checkInput(options: CheckInputsOptions, input: string): AppResult<InputCheck> {
    const restoreResult = restoreOriginalLock(options.lockPath, options.originalLockRaw);
    if (restoreResult.isErr()) {
        return err(`failed to restore lock file: ${restoreResult.error}`);
    }

    const currentRev = inputRevision(options.initialLock, options.rootInputs, input);
    if (!currentRev) {
        return ok({});
    }

    const updatedLockResult = updateInputLock(options, input);
    if (updatedLockResult.isErr()) {
        return ok({ warning: `${input}: ${updatedLockResult.error}` });
    }

    return ok(createInputCheck(input, currentRev, inputRevision(updatedLockResult.value, options.rootInputs, input)));
}

function inputRevision(lock: FlakeLock, rootInputs: Record<string, string>, input: string): string | undefined {
    const nodeName = rootInputs[input];
    if (!nodeName) {
        return undefined;
    }

    return lock.nodes?.[nodeName]?.locked?.rev;
}

function updateInputLock(options: CheckInputsOptions, input: string): AppResult<FlakeLock> {
    const updateResult = runNixUpdate(options.flakePath, input, options.timeoutMs);
    if (updateResult.isErr()) {
        return err(updateResult.error);
    }

    const updatedLockResult = loadLock(options.lockPath);
    if (updatedLockResult.isErr()) {
        return err(`failed to read updated lock (${updatedLockResult.error})`);
    }

    return updatedLockResult;
}

function createInputCheck(input: string, currentRev: string, newRev: string | undefined): InputCheck {
    if (!newRev) {
        return {};
    }

    if (newRev === currentRev) {
        return {};
    }

    return {
        update: {
            name: input,
            currentRev,
            currentShort: shortRev(currentRev),
            newRev,
            newShort: shortRev(newRev),
        },
    };
}

function collectInputUpdates(options: CheckInputsOptions): AppResult<UpdateInfo[]> {
    const updates: UpdateInfo[] = [];

    for (const input of options.inputs) {
        const result = checkInput(options, input);
        if (result.isErr()) {
            return err(result.error);
        }
        collectInputCheck(result.value, updates, options.warnings);
    }

    return ok(updates);
}

function collectInputCheck(inputCheck: InputCheck, updates: UpdateInfo[], warnings: string[]): void {
    if (inputCheck.warning) {
        warnings.push(inputCheck.warning);
    }

    if (inputCheck.update) {
        updates.push(inputCheck.update);
    }
}

function checkInputs(options: CheckInputsOptions): AppResult<UpdateInfo[]> {
    try {
        return collectInputUpdates(options);
    } catch (error) {
        restoreOriginalLock(options.lockPath, options.originalLockRaw);
        return err(error instanceof Error ? error.message : String(error));
    }
}

type CheckContext = {
    flakePath: string;
    lockPath: string;
    initialLock: FlakeLock;
    rootInputs: Record<string, string>;
    env: z.infer<typeof EnvSchema>;
};

function loadCheckContext(args: string[]): AppResult<CheckContext> {
    const envResult = loadCheckEnv();
    if (envResult.isErr()) {
        return err(envResult.error);
    }

    const resolvedFlakePath = resolve(checkFlakePath(args[0]));
    const lockPath = join(resolvedFlakePath, "flake.lock");
    if (existsSync(lockPath) === false) {
        return err("");
    }

    const lockResult = loadCheckLock(lockPath);
    if (lockResult.isErr()) {
        return err(lockResult.error);
    }

    return ok({ flakePath: resolvedFlakePath, lockPath, ...lockResult.value, env: envResult.value });
}

function checkFlakePath(pathArg: string | undefined): string {
    return expandHomePath(pathArg ?? defaultFlakePath());
}

function defaultFlakePath(): string {
    return `${process.env.HOME ?? "~"}/nixos`;
}

function loadCheckEnv(): AppResult<z.infer<typeof EnvSchema>> {
    const envParsed = EnvSchema.safeParse(process.env);
    if (envParsed.success) {
        return ok(envParsed.data);
    }

    const summary = envParsed.error.issues
        .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
        .join("; ");
    return err(`flake_check_updates: invalid env settings (${summary})`);
}

function expandHomePath(rawPath: string): string {
    const home = process.env.HOME;
    if (home === undefined || rawPath.startsWith("~/") === false) {
        return rawPath;
    }

    return join(home, rawPath.slice(2));
}

function loadCheckLock(lockPath: string): AppResult<Pick<CheckContext, "initialLock" | "rootInputs">> {
    const initialLockResult = loadLock(lockPath);
    if (initialLockResult.isErr()) {
        return err(`flake_check_updates: failed to read lock file: ${initialLockResult.error}`);
    }

    const rootInputs = initialLockResult.value.nodes?.root?.inputs;
    if (!rootInputs) {
        return err("");
    }

    return ok({ initialLock: initialLockResult.value, rootInputs });
}

function failWithEmptyResult(error: string): number {
    if (error) {
        console.error(error);
    }
    emitResult(EMPTY_RESULT);
    return 1;
}

function main(): number {
    const args = process.argv.slice(2);
    if (isHelpRequest(args[0])) {
        usage();
        return 0;
    }

    const contextResult = loadCheckContext(args);
    if (contextResult.isErr()) {
        return failWithEmptyResult(contextResult.error);
    }

    const context = contextResult.value;
    const checkResult = runCheck(context);
    if (checkResult.isErr()) {
        return failWithEmptyResult(checkResult.error);
    }

    emitWarnings(checkResult.value.warnings);
    emitResult({ count: checkResult.value.updates.length, updates: checkResult.value.updates });
    return 0;
}

function isHelpRequest(arg: string | undefined): boolean {
    return arg === "-h" || arg === "--help";
}

type CheckRun = {
    updates: UpdateInfo[];
    warnings: string[];
};

function runCheck(context: CheckContext): AppResult<CheckRun> {
    const allInputs = Object.keys(context.rootInputs).sort();
    const cursorFile = cursorFileForFlake(
        context.flakePath,
        context.env.FLAKE_CHECK_CURSOR_FILE,
        "flake_check_updates",
    );
    const batch = prepareInputBatch(
        allInputs,
        context.env.FLAKE_CHECK_BATCH_SIZE,
        context.env.FLAKE_CHECK_CURSOR,
        cursorFile,
    );
    const warnings = collectBatchWarnings(batch, allInputs.length, context.env.FLAKE_CHECK_BATCH_SIZE);
    const originalLockRaw = readFileSync(context.lockPath, "utf8");
    const updatesResult = checkInputs({
        flakePath: context.flakePath,
        lockPath: context.lockPath,
        originalLockRaw,
        initialLock: context.initialLock,
        rootInputs: context.rootInputs,
        inputs: batch.inputs,
        timeoutMs: context.env.FLAKE_CHECK_TIMEOUT_MS,
        warnings,
    });
    if (updatesResult.isErr()) {
        return err(`flake_check_updates: ${updatesResult.error}`);
    }

    const finalRestoreResult = restoreOriginalLock(context.lockPath, originalLockRaw);
    if (finalRestoreResult.isErr()) {
        return err(`flake_check_updates: failed final lock restore: ${finalRestoreResult.error}`);
    }

    return ok({ updates: updatesResult.value, warnings });
}

function collectBatchWarnings(
    batch: ReturnType<typeof prepareInputBatch>,
    totalInputs: number,
    batchSize: number,
): string[] {
    return [
        batchScanWarning(batch, totalInputs, batchSize),
        batch.cursorError && `failed to save cursor: ${batch.cursorError}`,
    ].filter((warning): warning is string => Boolean(warning));
}

function emitWarnings(warnings: string[]): void {
    for (const warning of warnings) {
        console.error(`flake_check_updates: ${warning}`);
    }
}

process.exit(main());
