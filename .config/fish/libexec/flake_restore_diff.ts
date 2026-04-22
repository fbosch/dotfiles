#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { err, ok, type Result } from "neverthrow";
import { match } from "ts-pattern";
import { z } from "zod";

type AppResult<T> = Result<T, string>;

type DepDirection = "upgrade" | "downgrade" | "added" | "removed" | "changed";

type DepChange = {
    name: string;
    from: string;
    to: string;
    direction: DepDirection;
};

type DiffResult = {
    count: number;
    changes: DepChange[];
};

const LockedSchema = z
    .object({
        rev: z.string().optional(),
        lastModified: z.union([z.number(), z.string()]).optional(),
    })
    .partial();

const NodeSchema = z
    .object({
        locked: LockedSchema.optional(),
    })
    .passthrough();

const FlakeLockSchema = z
    .object({
        nodes: z.record(z.string(), NodeSchema),
    })
    .passthrough();

function usage(): void {
    console.log("Usage: flake_restore_diff.ts <current-flake.lock> <selected-flake.lock>");
}

function readLock(filePath: string): AppResult<z.infer<typeof FlakeLockSchema>> {
    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const validated = FlakeLockSchema.safeParse(parsed);
        if (validated.success === false) {
            const summary = validated.error.issues
                .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                .join("; ");
            return err(`invalid flake lock (${summary})`);
        }

        return ok(validated.data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function numericLastModified(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed) === false) {
            return parsed;
        }
    }

    return 0;
}

function classifyDirection(
    currentLocked: z.infer<typeof LockedSchema>,
    selectedLocked: z.infer<typeof LockedSchema>,
): DepDirection | null {
    const currentRev = currentLocked.rev || "";
    const selectedRev = selectedLocked.rev || "";

    if (
        currentRev === selectedRev &&
        numericLastModified(currentLocked.lastModified) === numericLastModified(selectedLocked.lastModified)
    ) {
        return null;
    }

    return match<[boolean, boolean], DepDirection>([currentRev === "", selectedRev === ""])
        .with([true, false], () => "added")
        .with([false, true], () => "removed")
        .otherwise(() => {
            const currentLm = numericLastModified(currentLocked.lastModified);
            const selectedLm = numericLastModified(selectedLocked.lastModified);
            if (selectedLm > currentLm) {
                return "upgrade" as const;
            }
            if (selectedLm < currentLm) {
                return "downgrade" as const;
            }
            return "changed" as const;
        });
}

function diffLocks(currentPath: string, selectedPath: string): AppResult<DiffResult> {
    const currentResult = readLock(currentPath);
    if (currentResult.isErr()) {
        return err(currentResult.error);
    }

    const selectedResult = readLock(selectedPath);
    if (selectedResult.isErr()) {
        return err(selectedResult.error);
    }

    const currentNodes = currentResult.value.nodes;
    const selectedNodes = selectedResult.value.nodes;
    const allKeys = Array.from(new Set([...Object.keys(currentNodes), ...Object.keys(selectedNodes)])).sort();
    const changes: DepChange[] = [];

    for (const key of allKeys) {
        const currentLocked = currentNodes[key]?.locked || {};
        const selectedLocked = selectedNodes[key]?.locked || {};
        const direction = classifyDirection(currentLocked, selectedLocked);
        if (direction === null) {
            continue;
        }

        changes.push({
            name: key,
            from: currentLocked.rev || "-",
            to: selectedLocked.rev || "-",
            direction,
        });
    }

    return ok({
        count: changes.length,
        changes,
    });
}

function main(): number {
    const [, , currentPath, selectedPath] = process.argv;
    if (!currentPath || !selectedPath || currentPath === "--help" || currentPath === "-h") {
        usage();
        return currentPath ? 0 : 1;
    }

    const result = diffLocks(currentPath, selectedPath);
    if (result.isErr()) {
        console.error(`flake_restore_diff: ${result.error}`);
        return 1;
    }

    console.log(JSON.stringify(result.value));
    return 0;
}

process.exit(main());
