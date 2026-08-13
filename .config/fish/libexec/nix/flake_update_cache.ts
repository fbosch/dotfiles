#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cacheRoot, readJsonFile } from "../shared/fs.js";

const updateSchema = z.object({
    name: z.string(),
    currentRev: z.string(),
    currentShort: z.string(),
    newRev: z.string(),
    newShort: z.string(),
});

const cacheSchema = z
    .object({
        count: z.number().int().nonnegative(),
        updates: z.array(updateSchema),
        timestamp: z.string(),
        checkedAtEpoch: z.number().int().nonnegative(),
        flakePath: z.string(),
        lockHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .refine((cache) => cache.count === cache.updates.length, {
        message: "count must match updates length",
    });

const refreshedCacheSchema = z
    .object({
        count: z.number().int().nonnegative(),
        updates: z.array(updateSchema),
        timestamp: z.string(),
    })
    .refine((cache) => cache.count === cache.updates.length, {
        message: "count must match updates length",
    });

function unavailable(): never {
    process.exit(3);
}

type Args = {
    allowUnidentifiedFreshCache: boolean;
    flakePath: string;
    maxAgeSeconds: number;
};

function parseArgs(): Args {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "read" || args[0] !== "--flake" || args[2] !== "--max-age-seconds") {
        throw new Error("usage: flake_update_cache.ts read --flake <path> --max-age-seconds <seconds>");
    }

    const maxAgeSeconds = Number(args[3]);
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
        throw new Error("--max-age-seconds must be a non-negative integer");
    }

    const allowUnidentifiedFreshCache = args[4] === "--allow-unidentified-fresh-cache";
    if (args.length !== (allowUnidentifiedFreshCache ? 5 : 4)) {
        throw new Error("usage: flake_update_cache.ts read --flake <path> --max-age-seconds <seconds>");
    }

    return { allowUnidentifiedFreshCache, flakePath: args[1], maxAgeSeconds };
}

function currentRevisions(flakeLockPath: string): Map<string, string> | null {
    try {
        const lock = z
            .object({
                nodes: z
                    .object({
                        root: z.object({ inputs: z.record(z.string(), z.string()) }),
                    })
                    .passthrough(),
            })
            .passthrough()
            .parse(JSON.parse(readFileSync(flakeLockPath, "utf8")));
        const nodes = lock.nodes as Record<string, unknown>;
        const revisions = new Map<string, string>();

        for (const [name, nodeName] of Object.entries(lock.nodes.root.inputs)) {
            const node = z.object({ locked: z.object({ rev: z.string() }).optional() }).safeParse(nodes[nodeName]);
            if (node.success && node.data.locked) {
                revisions.set(name, node.data.locked.rev);
            }
        }

        return revisions;
    } catch {
        return null;
    }
}

function isFresh(timestamp: string, maxAgeSeconds: number): boolean {
    const checkedAt = Date.parse(timestamp);
    if (!Number.isFinite(checkedAt)) return false;

    const ageSeconds = Math.floor((Date.now() - checkedAt) / 1000);
    return ageSeconds >= 0 && ageSeconds <= maxAgeSeconds;
}

function printCache(cache: z.infer<typeof refreshedCacheSchema>): void {
    process.stdout.write(`cache\t${cache.timestamp}\n`);
    for (const update of cache.updates) {
        process.stdout.write(`update\t${update.name}: ${update.currentShort} -> ${update.newShort}\n`);
    }
}

function main(): void {
    const { allowUnidentifiedFreshCache, flakePath, maxAgeSeconds } = parseArgs();
    let resolvedFlakePath: string;
    let lockHash: string;
    let flakeLockPath: string;

    try {
        resolvedFlakePath = realpathSync(flakePath);
        flakeLockPath = join(resolvedFlakePath, "flake.lock");
        lockHash = createHash("sha256").update(readFileSync(flakeLockPath)).digest("hex");
    } catch {
        unavailable();
    }

    const cacheResult = readJsonFile(join(cacheRoot(), "flake-updates.json"), cacheSchema);
    if (cacheResult.isOk()) {
        const cache = cacheResult.value;
        const ageSeconds = Math.floor(Date.now() / 1000) - cache.checkedAtEpoch;
        if (
            cache.flakePath === resolvedFlakePath &&
            cache.lockHash === lockHash &&
            ageSeconds >= 0 &&
            ageSeconds <= maxAgeSeconds
        ) {
            printCache(cache);
            return;
        }
    }

    if (!allowUnidentifiedFreshCache) {
        unavailable();
    }

    const refreshedCache = readJsonFile(join(cacheRoot(), "flake-updates.json"), refreshedCacheSchema);
    if (refreshedCache.isErr() || !isFresh(refreshedCache.value.timestamp, maxAgeSeconds)) {
        unavailable();
    }

    const revisions = currentRevisions(flakeLockPath);
    if (!revisions || refreshedCache.value.updates.some((update) => revisions.get(update.name) !== update.currentRev)) {
        unavailable();
    }

    printCache(refreshedCache.value);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
