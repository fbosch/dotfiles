#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";
import { match, P } from "ts-pattern";
import { z } from "zod";

type AppResult<T> = Result<T, string>;

type CachedIssueMeta = {
    timestamp: number;
    stateName: string;
    stateType: string;
    priorityValue: string;
    title: string;
};

type IssueListRow = {
    id: string;
    stateName: string;
    stateKey: string;
    priorityValue: string;
    title: string;
    detail: string;
};

type IssueView = {
    title?: string;
    branchName?: string;
    priority?: string | number;
    state?: {
        name?: string;
        type?: string;
    };
};

const IssueIdSchema = z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/, "invalid issue identifier");

const EnvSchema = z.object({
    LINEAR_ISSUE_WORKFLOW_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(86400).default(300),
    LINEAR_ISSUE_WORKFLOW_ENRICH_LIMIT: z.coerce.number().int().min(0).max(200).default(40),
    XDG_CACHE_HOME: z.string().min(1).optional(),
    HOME: z.string().min(1).optional(),
});

const IssueViewSchema = z
    .object({
        title: z.string().min(1).optional(),
        branchName: z.string().min(1).optional(),
        priority: z.union([z.string(), z.number()]).optional(),
        state: z
            .object({
                name: z.string().min(1).optional(),
                type: z.string().min(1).optional(),
            })
            .partial()
            .optional(),
    })
    .passthrough();

const CacheEntrySchema = z.object({
    timestamp: z.number().int().min(0),
    stateName: z.string(),
    stateType: z.string(),
    priorityValue: z.string(),
    title: z.string(),
});

const CacheSchema = z.record(z.string(), CacheEntrySchema);

function usage(): void {
    console.log("Usage: linear_issue_workflow_helper.ts <build-list|issue-branch> [args]");
    console.log("Commands:");
    console.log("  build-list            read 'linear issue list' output on stdin and emit TSV rows");
    console.log("  issue-branch <ID>     emit derived branch for an issue");
    console.log("Env overrides:");
    console.log("  LINEAR_ISSUE_WORKFLOW_CACHE_TTL_SECONDS default 300");
    console.log("  LINEAR_ISSUE_WORKFLOW_ENRICH_LIMIT      default 40");
}

function run(command: string, args: string[]): AppResult<string> {
    const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: "pipe",
    });

    if (result.status !== 0) {
        const output = (result.stderr || result.stdout || `${command} failed`).trim();
        return err(output);
    }

    return ok(result.stdout);
}

function readStdin(): AppResult<string> {
    try {
        return ok(readFileSync(0, "utf8"));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function cacheDir(): string {
    const root = process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, ".cache") : "/tmp");
    return join(root, "linear_issue_workflow");
}

function cacheFilePath(): string {
    return join(cacheDir(), "issue_meta.json");
}

function ensureCacheDir(): AppResult<void> {
    try {
        mkdirSync(cacheDir(), { recursive: true });
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function loadCache(): AppResult<Record<string, CachedIssueMeta>> {
    const filePath = cacheFilePath();
    if (!existsSync(filePath)) {
        return ok({});
    }

    try {
        const raw = readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const validated = CacheSchema.safeParse(parsed);
        if (!validated.success) {
            return ok({});
        }

        return ok(validated.data);
    } catch {
        return ok({});
    }
}

function writeCache(cache: Record<string, CachedIssueMeta>): AppResult<void> {
    const ensureResult = ensureCacheDir();
    if (ensureResult.isErr()) {
        return err(ensureResult.error);
    }

    try {
        writeFileSync(cacheFilePath(), `${JSON.stringify(cache)}\n`, "utf8");
        return ok(undefined);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function stripAnsi(value: string): string {
    return value.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

function sanitizeField(value: string): string {
    return value.replaceAll("\t", " ").replaceAll("\n", " ").trim();
}

function parseStateNameFromDetail(detail: string): string {
    const agoMatch = detail.match(/ - ([^-]+?)\s+[^ ]+\s+[^ ]+\s+ago$/);
    if (agoMatch?.[1]) {
        return agoMatch[1].trim();
    }

    const shortMatch = detail.match(/ - ([^-]+?)\s+(yesterday|today|just now)$/);
    if (shortMatch?.[1]) {
        return shortMatch[1].trim();
    }

    return "";
}

function parsePriorityFromLine(plainLine: string): string {
    const raw = plainLine.match(/^\s*(\S+)\s+[A-Z][A-Z0-9]+-\d+/)?.[1] || "";
    return match(raw)
        .with("⚠⚠⚠", () => "1")
        .with("▄▆█", () => "2")
        .with("▄▆", () => "3")
        .with("▄", () => "4")
        .otherwise(() => "");
}

function normalizeStateKey(stateType: string, stateName: string): string {
    return match<[string, string], string>([stateType.trim().toLowerCase(), stateName.trim().toLowerCase()])
        .with([P.union("triage"), P._], () => "triage")
        .with([P.union("backlog"), P._], () => "backlog")
        .with([P.union("unstarted"), P._], () => "unstarted")
        .with([P.union("started"), P.union("in progress")], () => "started")
        .with([P._, P.union("started", "in progress")], () => "started")
        .with([P.union("in review"), P._], () => "in review")
        .with([P._, P.union("in review")], () => "in review")
        .with([P.union("completed"), P._], () => "completed")
        .with([P._, P.union("completed", "done")], () => "completed")
        .with([P.union("canceled", "cancelled"), P._], () => "canceled")
        .with([P._, P.union("canceled", "cancelled")], () => "canceled")
        .otherwise(([typeKey, nameKey]) => typeKey || nameKey || "no state");
}

function normalizeListPriorityValue(priorityValue: string, plainLine: string): string {
    return match(priorityValue.trim())
        .with(P.union("1", "2", "3", "4"), (value) => value)
        .otherwise(() => parsePriorityFromLine(plainLine));
}

function fetchIssueView(issueId: string): AppResult<IssueView> {
    const rawResult = run("linear", ["issue", "view", issueId, "--json", "--no-comments"]);
    if (rawResult.isErr()) {
        return err(rawResult.error);
    }

    try {
        const parsed = JSON.parse(rawResult.value) as unknown;
        const validated = IssueViewSchema.safeParse(parsed);
        if (!validated.success) {
            const summary = validated.error.issues
                .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
                .join("; ");
            return err(`invalid issue metadata (${summary})`);
        }

        return ok(validated.data);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(message);
    }
}

function normalizePriorityValue(value: string | number | undefined): string {
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "string") {
        return value.trim();
    }

    return "";
}

function deriveBranch(issueId: string, title: string, branchName?: string): string {
    if (branchName && branchName.trim().length > 0) {
        return branchName.trim();
    }

    let slug = title.toLowerCase();
    slug = slug.replace(/[^a-z0-9]+/g, "-");
    slug = slug.replace(/-+/g, "-");
    slug = slug.replace(/^-+|-+$/g, "");

    if (slug.length === 0) {
        slug = "work-item";
    }

    return `feature/${issueId.toLowerCase()}-${slug.slice(0, 48)}`;
}

function buildListRows(
    rawList: string,
    cache: Record<string, CachedIssueMeta>,
    cacheTtlSeconds: number,
    enrichLimit: number,
): { rows: IssueListRow[]; cacheDirty: boolean } {
    const rows: IssueListRow[] = [];
    const seenIds = new Set<string>();
    const now = Math.floor(Date.now() / 1000);
    let enrichFetchCount = 0;
    let cacheDirty = false;

    for (const rawLine of rawList.split("\n")) {
        const plainLine = stripAnsi(rawLine);
        const id = plainLine.match(/([A-Z][A-Z0-9]+-\d+)/)?.[1] || "";
        if (!id || seenIds.has(id)) {
            continue;
        }

        seenIds.add(id);

        let detail = plainLine.replace(/^[^A-Z0-9]*[A-Z][A-Z0-9]+-\d+\s+/, "").trim();
        let title = detail;
        let stateName = "";
        let stateType = "";
        let priorityValue = "";

        const cached = cache[id];
        if (cached && now - cached.timestamp <= cacheTtlSeconds) {
            stateName = cached.stateName;
            stateType = cached.stateType;
            priorityValue = cached.priorityValue;
            if (cached.title) {
                title = cached.title;
            }
        }

        if (!stateName && enrichFetchCount < enrichLimit) {
            enrichFetchCount += 1;
            const issueView = fetchIssueView(id);
            if (issueView.isOk()) {
                title = issueView.value.title?.trim() || title;
                stateName = issueView.value.state?.name?.trim() || "";
                stateType = issueView.value.state?.type?.trim() || "";
                priorityValue = normalizePriorityValue(issueView.value.priority);

                cache[id] = {
                    timestamp: now,
                    stateName,
                    stateType,
                    priorityValue,
                    title: sanitizeField(title),
                };
                cacheDirty = true;
            }
        }

        if (!stateName) {
            stateName = parseStateNameFromDetail(detail) || "No State";
        }

        priorityValue = normalizeListPriorityValue(priorityValue, plainLine);

        const stateKey = normalizeStateKey(stateType, stateName);
        title = sanitizeField(title);
        detail = sanitizeField(detail);
        stateName = sanitizeField(stateName);

        rows.push({
            id,
            stateName,
            stateKey,
            priorityValue,
            title,
            detail,
        });
    }

    return { rows, cacheDirty };
}

function emitRows(rows: IssueListRow[]): void {
    const lines = rows.map((row) =>
        [row.id, row.stateName, row.stateKey, row.priorityValue, row.title, row.detail].join("\t"),
    );
    if (lines.length > 0) {
        console.log(lines.join("\n"));
    }
}

function main(): number {
    const [, , command, issueIdArg] = process.argv;
    if (!command || command === "-h" || command === "--help") {
        usage();
        return command ? 0 : 1;
    }

    const envParsed = EnvSchema.safeParse(process.env);
    if (!envParsed.success) {
        const summary = envParsed.error.issues
            .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
            .join("; ");
        console.error(`linear_issue_workflow_helper: invalid env (${summary})`);
        return 1;
    }

    return match(command)
        .with("build-list", () => {
            const stdinResult = readStdin();
            if (stdinResult.isErr()) {
                console.error(`linear_issue_workflow_helper: failed to read stdin (${stdinResult.error})`);
                return 1;
            }

            const cacheResult = loadCache();
            if (cacheResult.isErr()) {
                console.error(`linear_issue_workflow_helper: failed to load cache (${cacheResult.error})`);
                return 1;
            }

            const { rows, cacheDirty } = buildListRows(
                stdinResult.value,
                cacheResult.value,
                envParsed.data.LINEAR_ISSUE_WORKFLOW_CACHE_TTL_SECONDS,
                envParsed.data.LINEAR_ISSUE_WORKFLOW_ENRICH_LIMIT,
            );
            if (rows.length === 0) {
                console.error("linear_issue_workflow_helper: failed to parse issue identifiers from stdin");
                return 1;
            }

            if (cacheDirty) {
                const writeResult = writeCache(cacheResult.value);
                if (writeResult.isErr()) {
                    console.error(`linear_issue_workflow_helper: failed to write cache (${writeResult.error})`);
                }
            }

            emitRows(rows);
            return 0;
        })
        .with("issue-branch", () => {
            const parsedIssueId = IssueIdSchema.safeParse(issueIdArg ? issueIdArg.toUpperCase() : "");
            if (!parsedIssueId.success) {
                console.error("linear_issue_workflow_helper: invalid issue identifier");
                return 1;
            }

            const issueView = fetchIssueView(parsedIssueId.data);
            if (issueView.isErr()) {
                console.error(`linear_issue_workflow_helper: ${issueView.error}`);
                return 1;
            }

            const title = issueView.value.title?.trim() || "work-item";
            console.log(deriveBranch(parsedIssueId.data, title, issueView.value.branchName));
            return 0;
        })
        .otherwise(() => {
            usage();
            return 1;
        });
}

process.exit(main());
