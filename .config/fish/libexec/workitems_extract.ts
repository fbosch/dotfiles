#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chunk, uniq } from "es-toolkit";
import { err, ok, type Result } from "neverthrow";
import { match } from "ts-pattern";
import { z } from "zod";

type Mode = "authored_branches" | "merged_main";
type AppResult<T> = Result<T, string>;

type CommitRecord = {
    hash: string;
    date: string;
    subject: string;
};

const ArgsSchema = z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    mode: z.enum(["authored_branches", "merged_main"]).default("authored_branches"),
    refresh: z
        .preprocess(
            (value) => {
                if (value === undefined) {
                    return "0";
                }
                return String(value);
            },
            z.enum(["0", "1"]),
        )
        .transform((value) => value === "1"),
});

function usage(): void {
    console.log("Usage: workitems_extract.ts <start_date> <end_date> [mode] [refresh]");
    console.log("Modes: authored_branches | merged_main");
    console.log("Outputs: date|workitem|branch per line");
}

function run(command: string, args: string[]): AppResult<string> {
    const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || `${command} failed`).trim();
        return err(output);
    }

    return ok(result.stdout);
}

function parseIsoDate(value: string): AppResult<Date> {
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!isoMatch) {
        return err(`invalid date: ${value}`);
    }

    const [, yearRaw, monthRaw, dayRaw] = isoMatch;
    const year = Number.parseInt(yearRaw, 10);
    const month = Number.parseInt(monthRaw, 10);
    const day = Number.parseInt(dayRaw, 10);
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return err(`invalid date: ${value}`);
    }

    if (parsed.getFullYear() !== year || parsed.getMonth() + 1 !== month || parsed.getDate() !== day) {
        return err(`invalid date: ${value}`);
    }

    return ok(parsed);
}

function validateDateRange(startDate: string, endDate: string): AppResult<void> {
    const parsedStart = parseIsoDate(startDate);
    if (parsedStart.isErr()) {
        return err(parsedStart.error);
    }

    const parsedEnd = parseIsoDate(endDate);
    if (parsedEnd.isErr()) {
        return err(parsedEnd.error);
    }

    if (parsedStart.value.getTime() > parsedEnd.value.getTime()) {
        return err(`invalid date range: ${startDate} is after ${endDate}`);
    }

    return ok(undefined);
}

function isPastDateRange(endDate: string): AppResult<boolean> {
    const parsedEnd = parseIsoDate(endDate);
    if (parsedEnd.isErr()) {
        return err(parsedEnd.error);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return ok(parsedEnd.value.getTime() < today.getTime());
}

function cacheDir(): string {
    const root = process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : "/tmp");
    return join(root, "fish", "workitems");
}

function ensureCacheDir(): AppResult<string> {
    const dir = cacheDir();
    try {
        mkdirSync(dir, { recursive: true });
        return ok(dir);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function cacheHash(value: string): string {
    return createHash("md5").update(value).digest("hex");
}

function parseCommitLines(raw: string): CommitRecord[] {
    return raw
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
            const [hash = "", date = "", ...subjectParts] = line.split("|");
            return {
                hash,
                date,
                subject: subjectParts.join("|"),
            };
        })
        .filter((record) => record.hash && record.date);
}

function extractWorkitems(value: string): string[] {
    const matches = [...value.matchAll(/(?:AB#|#)(\d+)/g)].map((match) => match[1]);
    return uniq(matches.filter((item) => item.length !== 8));
}

function extractBranchWorkitem(branchName: string): string {
    const abMatch = branchName.match(/AB#(\d+)/);
    if (abMatch?.[1] && abMatch[1].length !== 8) {
        return abMatch[1];
    }

    const numberMatch = branchName.match(/\d+/);
    if (numberMatch?.[0] && numberMatch[0].length !== 8) {
        return numberMatch[0];
    }

    return "";
}

function parseBranchLines(raw: string): string[] {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

function getGitRoot(): string {
    const gitRootResult = run("git", ["rev-parse", "--show-toplevel"]);
    return gitRootResult.isOk() ? gitRootResult.value.trim() || "unknown" : "unknown";
}

function getGitUserEmail(): string {
    const emailResult = run("git", ["config", "user.email"]);
    return emailResult.isOk() ? emailResult.value.trim() : "";
}

function resolveMainRef(): { mainRef: string; refsState: string } {
    const commands = [
        ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
        ["show-ref", "--verify", "--quiet", "refs/remotes/origin/main"],
        ["show-ref", "--verify", "--quiet", "refs/remotes/origin/master"],
        ["show-ref", "--verify", "--quiet", "refs/heads/main"],
        ["show-ref", "--verify", "--quiet", "refs/heads/master"],
    ] as const;

    const symbolicResult = run("git", [...commands[0]]);
    if (symbolicResult.isOk() && symbolicResult.value.trim()) {
        const mainRef = symbolicResult.value.trim();
        const revResult = run("git", ["rev-parse", mainRef]);
        return { mainRef, refsState: revResult.isOk() ? revResult.value.trim() : "no-main-ref" };
    }

    const fallbackRefs = ["origin/main", "origin/master", "main", "master"] as const;
    for (const ref of fallbackRefs) {
        const verifyResult = run("git", [
            "show-ref",
            "--verify",
            "--quiet",
            `refs/${ref.startsWith("origin/") ? "remotes" : "heads"}/${ref}`,
        ]);
        if (verifyResult.isOk()) {
            const revResult = run("git", ["rev-parse", ref]);
            return { mainRef: ref, refsState: revResult.isOk() ? revResult.value.trim() : "no-main-ref" };
        }
    }

    return { mainRef: "", refsState: "no-main-ref" };
}

function refsStateForMode(mode: Mode): { mainRef: string; refsState: string } {
    if (mode === "merged_main") {
        return resolveMainRef();
    }

    const refsResult = run("git", ["for-each-ref", "refs/heads/", "--format=%(refname):%(objectname)"]);
    return { mainRef: "", refsState: refsResult.isOk() ? refsResult.value : "" };
}

function cacheFilePath(
    mode: Mode,
    startDate: string,
    endDate: string,
    gitUserEmail: string,
    refsState: string,
): AppResult<string> {
    const cacheDirResult = ensureCacheDir();
    if (cacheDirResult.isErr()) {
        return err(cacheDirResult.error);
    }

    const cacheVersion = "v3";
    const repoHash = cacheHash(getGitRoot());
    const refsHash = cacheHash(refsState);
    const cacheKey = `${cacheVersion}-${repoHash}-${refsHash}-${gitUserEmail}-${mode}-${startDate}-${endDate}`;
    return ok(join(cacheDirResult.value, cacheKey));
}

function readCache(filePath: string): AppResult<string[]> {
    try {
        if (!existsSync(filePath)) {
            return ok([]);
        }

        const raw = readFileSync(filePath, "utf8");
        return ok(raw.split("\n").filter((line) => line.length > 0));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function writeCache(filePath: string, lines: string[]): AppResult<void> {
    try {
        writeFileSync(filePath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function gitLogForRange(
    mode: Mode,
    startDate: string,
    endDate: string,
    gitUserEmail: string,
    mainRef: string,
): AppResult<CommitRecord[]> {
    const args = match(mode)
        .with("merged_main", () => {
            if (!mainRef) {
                return null;
            }

            return [
                "log",
                mainRef,
                "--first-parent",
                `--since=${startDate} 00:00:00`,
                `--until=${endDate} 23:59:59`,
                "--pretty=format:%H|%as|%s",
            ];
        })
        .with("authored_branches", () => [
            "log",
            "--all",
            `--author=${gitUserEmail}`,
            `--since=${startDate} 00:00:00`,
            `--until=${endDate} 23:59:59`,
            "--pretty=format:%H|%as|%s",
        ])
        .exhaustive();

    if (!args) {
        return ok([]);
    }

    const result = run("git", args);
    return result.map(parseCommitLines);
}

function branchesForCommit(commitHash: string): AppResult<string[]> {
    return run("git", ["for-each-ref", `--contains=${commitHash}`, "refs/heads/", "--format=%(refname:short)"]).map(
        parseBranchLines,
    );
}

function collectMergedMainItems(commits: CommitRecord[], mainRef: string): string[] {
    const items = new Set<string>();
    for (const commit of commits) {
        for (const workitem of extractWorkitems(commit.subject)) {
            items.add(`${commit.date}|${workitem}|${mainRef}`);
        }
    }

    return [...items];
}

function collectAuthoredBranchItems(commits: CommitRecord[]): AppResult<string[]> {
    const items = new Set<string>();

    for (const commit of commits) {
        const branchesResult = branchesForCommit(commit.hash);
        if (branchesResult.isErr()) {
            return err(branchesResult.error);
        }

        const branchNames = branchesResult.value;

        for (const branchName of branchNames) {
            const workitem = extractBranchWorkitem(branchName);
            if (workitem) {
                items.add(`${commit.date}|${workitem}|${branchName}`);
            }
        }

        const commitItems = extractWorkitems(commit.subject);
        if (commitItems.length === 0 || branchNames.length === 0) {
            continue;
        }

        const primaryBranch = branchNames[0];
        for (const workitem of commitItems) {
            items.add(`${commit.date}|${workitem}|${primaryBranch}`);
        }
    }

    return ok([...items]);
}

function extractWorkitemsForRange(
    startDate: string,
    endDate: string,
    mode: Mode,
    refresh: boolean,
): AppResult<string[]> {
    const dateRangeResult = validateDateRange(startDate, endDate);
    if (dateRangeResult.isErr()) {
        return err(dateRangeResult.error);
    }

    const cacheableResult = isPastDateRange(endDate);
    if (cacheableResult.isErr()) {
        return err(cacheableResult.error);
    }

    const gitUserEmail = getGitUserEmail();
    const { mainRef, refsState } = refsStateForMode(mode);
    const cacheFileResult = cacheFilePath(mode, startDate, endDate, gitUserEmail, refsState);
    if (cacheFileResult.isErr()) {
        return err(cacheFileResult.error);
    }

    const cacheable = cacheableResult.value;
    const cacheFile = cacheFileResult.value;

    if (!refresh && cacheable) {
        const cachedResult = readCache(cacheFile);
        if (cachedResult.isErr()) {
            return err(cachedResult.error);
        }
        if (cachedResult.value.length > 0) {
            return ok(cachedResult.value);
        }
    }

    const commitsResult = gitLogForRange(mode, startDate, endDate, gitUserEmail, mainRef);
    if (commitsResult.isErr()) {
        return err(commitsResult.error);
    }

    const commitChunks = chunk(commitsResult.value, 100);
    let lines: string[] = [];
    for (const commitChunk of commitChunks) {
        const chunkResult = match(mode)
            .with("merged_main", () => ok(collectMergedMainItems(commitChunk, mainRef)))
            .with("authored_branches", () => collectAuthoredBranchItems(commitChunk))
            .exhaustive();

        if (chunkResult.isErr()) {
            return err(chunkResult.error);
        }

        lines = lines.concat(chunkResult.value);
    }

    const uniqueLines = uniq(lines);
    if (cacheable) {
        const writeResult = writeCache(cacheFile, uniqueLines);
        if (writeResult.isErr()) {
            return err(writeResult.error);
        }
    }

    return ok(uniqueLines);
}

function main(): number {
    const [, , ...rawArgs] = process.argv;
    if (rawArgs[0] === "-h" || rawArgs[0] === "--help") {
        usage();
        return 0;
    }

    const parsed = ArgsSchema.safeParse({
        startDate: rawArgs[0],
        endDate: rawArgs[1],
        mode: rawArgs[2],
        refresh: rawArgs[3],
    });

    if (!parsed.success) {
        const summary = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
        console.error(`workitems_extract: invalid args (${summary})`);
        usage();
        return 1;
    }

    const result = extractWorkitemsForRange(
        parsed.data.startDate,
        parsed.data.endDate,
        parsed.data.mode,
        parsed.data.refresh,
    );

    if (result.isErr()) {
        console.error(`workitems_extract: ${result.error}`);
        return 1;
    }

    for (const line of result.value) {
        console.log(line);
    }

    return 0;
}

process.exit(main());
