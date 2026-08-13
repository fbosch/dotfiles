#!/usr/bin/env bun

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
    })
    .refine((cache) => cache.count === cache.updates.length, {
        message: "count must match updates length",
    });

function unavailable(): never {
    process.exit(3);
}

function parseArgs(): { flakePath: string; maxAgeSeconds: number } {
    const [command, ...args] = process.argv.slice(2);
    if (command !== "read" || args.length !== 4 || args[0] !== "--flake" || args[2] !== "--max-age-seconds") {
        throw new Error("usage: flake_update_cache.ts read --flake <path> --max-age-seconds <seconds>");
    }

    const maxAgeSeconds = Number(args[3]);
    if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
        throw new Error("--max-age-seconds must be a non-negative integer");
    }

    return { flakePath: args[1], maxAgeSeconds };
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
            .parse(JSON.parse(readFileSync(flakeLockPath, "utf8")));
        const revisions = new Map<string, string>();

        for (const [name, nodeName] of Object.entries(lock.nodes.root.inputs)) {
            const node = z.object({ locked: z.object({ rev: z.string() }).optional() }).safeParse(lock.nodes[nodeName]);
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

function main(): void {
    const { flakePath, maxAgeSeconds } = parseArgs();
    let flakeLockPath: string;

    try {
        flakeLockPath = join(realpathSync(flakePath), "flake.lock");
    } catch {
        unavailable();
    }

    const cacheResult = readJsonFile(join(cacheRoot(), "flake-updates.json"), cacheSchema);
    if (cacheResult.isErr() || !isFresh(cacheResult.value.timestamp, maxAgeSeconds)) {
        unavailable();
    }

    const revisions = currentRevisions(flakeLockPath);
    if (!revisions || cacheResult.value.updates.some((update) => revisions.get(update.name) !== update.currentRev)) {
        unavailable();
    }

    process.stdout.write(`${JSON.stringify(cacheResult.value)}\n`);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}
