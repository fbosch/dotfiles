import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { err, ok, type Result } from "neverthrow";

type AppResult<T> = Result<T, string>;

export function cursorFileForFlake(
    resolvedFlakePath: string,
    cursorFileOverride: string | undefined,
    cursorDirectory: string,
): string {
    if (cursorFileOverride) {
        return resolve(cursorFileOverride);
    }

    const cacheRoot = process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : "/tmp");
    const key = createHash("sha1").update(resolvedFlakePath).digest("hex");
    return join(cacheRoot, cursorDirectory, `${key}.cursor`);
}

export function loadCursor(cursorFile: string): number {
    if (existsSync(cursorFile) === false) {
        return 0;
    }

    try {
        return parseCursor(readFileSync(cursorFile, "utf8"));
    } catch {
        return 0;
    }
}

function parseCursor(raw: string): number {
    const cursor = Number.parseInt(raw.trim(), 10);
    if (Number.isNaN(cursor) || cursor < 0) {
        return 0;
    }

    return cursor;
}

export function saveCursor(cursorFile: string, nextCursor: number): AppResult<void> {
    try {
        mkdirSync(dirname(cursorFile), { recursive: true });
        writeFileSync(cursorFile, `${nextCursor}\n`, "utf8");
        return ok(undefined);
    } catch (error) {
        return err(error instanceof Error ? error.message : String(error));
    }
}

export function buildBatch(allInputs: string[], start: number, batchSize: number): string[] {
    if (allInputs.length <= batchSize) {
        return allInputs;
    }

    return Array.from({ length: batchSize }, (_, index) => allInputs[(start + index) % allInputs.length]);
}

export type InputBatch = {
    inputs: string[];
    start: number;
    cursorError?: string;
};

export function prepareInputBatch(
    allInputs: string[],
    batchSize: number,
    useCursor: boolean,
    cursorFile: string,
): InputBatch {
    const cursor = cursorForBatch(useCursor, cursorFile);
    const start = batchStart(allInputs, cursor);
    const inputs = buildBatch(allInputs, start, batchSize);

    if (useCursor === false) {
        return { inputs, start };
    }

    if (allInputs.length === 0) {
        return { inputs, start };
    }

    const saveResult = saveCursor(cursorFile, (start + inputs.length) % allInputs.length);
    if (saveResult.isErr()) {
        return { inputs, start, cursorError: saveResult.error };
    }

    return { inputs, start };
}

function cursorForBatch(useCursor: boolean, cursorFile: string): number {
    if (useCursor === false) {
        return 0;
    }

    return loadCursor(cursorFile);
}

function batchStart(allInputs: string[], cursor: number): number {
    if (allInputs.length === 0) {
        return 0;
    }

    return cursor % allInputs.length;
}

export function batchScanWarning(batch: InputBatch, totalInputs: number, batchSize: number): string | undefined {
    if (totalInputs <= batchSize) {
        return undefined;
    }

    return `batch scan ${batch.inputs.length}/${totalInputs} starting at index ${batch.start}`;
}
