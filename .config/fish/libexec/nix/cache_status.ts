#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { cacheRoot } from "../shared/fs.js";

type AppResult<T> = Result<T, string>;

const UpdateSchema = z.object({
    name: z.string(),
    currentShort: z.string(),
    newShort: z.string(),
});

const CacheSchema = z.object({
    count: z.number().int().nonnegative().default(0),
    timestamp: z.string().optional(),
    updates: z.array(UpdateSchema).default([]),
});

function usage(): void {
    console.log("Usage: flake_updates_cache_status.ts");
}

function cacheFilePath(): string {
    return join(cacheRoot(), "flake-updates.json");
}

function readCacheStatus(): AppResult<string[]> {
    const filePath = cacheFilePath();
    if (!existsSync(filePath)) {
        return err("missing cache");
    }

    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const validated = CacheSchema.safeParse(parsed);
        if (!validated.success) {
            const summary = validated.error.issues
                .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                .join("; ");
            return err(`invalid cache (${summary})`);
        }

        const { count, timestamp, updates } = validated.data;
        const lines = [`count\t${count}`, `timestamp\t${timestamp || "unknown"}`];
        for (const update of updates) {
            lines.push(["update", update.name, update.currentShort, update.newShort].join("\t"));
        }

        return ok(lines);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function main(): number {
    const [, , arg] = process.argv;
    if (arg === "-h" || arg === "--help") {
        usage();
        return 0;
    }

    const result = readCacheStatus();
    if (result.isErr()) {
        console.error(`flake_updates_cache_status: ${result.error}`);
        return 1;
    }

    console.log(result.value.join("\n"));
    return 0;
}

process.exit(main());
