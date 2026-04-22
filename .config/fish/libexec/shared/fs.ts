import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import type { z } from "zod";

export type AppResult<T> = Result<T, string>;

export function cacheRoot(): string {
    return process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : "/tmp");
}

export function ensureDir(dirPath: string): AppResult<void> {
    try {
        mkdirSync(dirPath, { recursive: true });
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>): AppResult<T> {
    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const validated = schema.safeParse(parsed);
        if (!validated.success) {
            const summary = validated.error.issues
                .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                .join("; ");
            return err(`invalid JSON in ${filePath} (${summary})`);
        }

        return ok(validated.data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

export function existingMode(filePath: string): number | undefined {
    try {
        return statSync(filePath).mode;
    } catch {
        return undefined;
    }
}

export function writeJsonAtomic(filePath: string, value: unknown, mode?: number): AppResult<void> {
    const ensureResult = ensureDir(dirname(filePath));
    if (ensureResult.isErr()) {
        return err(ensureResult.error);
    }

    const tmpPath = join(
        dirname(filePath),
        `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );

    try {
        writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        if (mode !== undefined) {
            chmodSync(tmpPath, mode);
        }
        renameSync(tmpPath, filePath);
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}
