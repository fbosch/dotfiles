#!/usr/bin/env bun

import {
    azureEnv,
    detectOrgFromGitRemote,
    extractWorkItemId,
    getCurrentBranch,
    inferPbiIdFromBranch,
    parseOrgAndProject,
} from "./context.js";
import { runJson } from "../shared/process.js";

type AzureRelation = {
    rel?: unknown;
    url?: unknown;
    attributes?: unknown;
};

type AzureWorkItem = {
    relations?: unknown;
    fields?: unknown;
};

function printError(message: string): never {
    console.log(`ERROR: ${message}`);
    process.exit(0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function asRelations(value: unknown): AzureRelation[] {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "object" && entry !== null) as AzureRelation[] : [];
}

function runWorkItemShow(itemId: string, org: string | null): unknown {
    const args = ["boards", "work-item", "show", "--id", itemId, "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }

    const result = runJson<unknown>("az", args, { env: azureEnv() });
    if (result.isErr()) {
        throw new Error(result.error);
    }

    return result.value;
}

function extractTaskIds(relations: AzureRelation[]): string[] {
    const taskIds = new Set<number>();

    for (const relation of relations) {
        if (relation.rel !== "System.LinkTypes.Hierarchy-Forward") {
            continue;
        }

        const url = typeof relation.url === "string" ? relation.url : "";
        const match = url.match(/\/workItems\/(\d+)/);
        if (match?.[1]) {
            taskIds.add(Number.parseInt(match[1], 10));
        }
    }

    return [...taskIds].sort((left, right) => left - right).map(String);
}

function collectWikiLinks(relations: AzureRelation[], source: string): Array<Record<string, string>> {
    const links: Array<Record<string, string>> = [];

    for (const relation of relations) {
        const rel = typeof relation.rel === "string" ? relation.rel : "";
        const url = typeof relation.url === "string" ? relation.url : "";
        const attributes = asRecord(relation.attributes) ?? {};
        const name = typeof attributes.name === "string" ? attributes.name : "";
        const comment = typeof attributes.comment === "string" ? attributes.comment : "";
        const fingerprint = [rel, url, name, comment].join(" ").toLowerCase();

        if (fingerprint.includes("wiki") === false) {
            continue;
        }

        links.push({
            source,
            rel,
            name,
            comment,
            url,
        });
    }

    return links;
}

function dedupeWikiLinks(entries: Array<Record<string, string>>): Array<Record<string, string>> {
    const seen = new Set<string>();
    const deduped: Array<Record<string, string>> = [];

    for (const entry of entries) {
        const key = [entry.source ?? "", entry.url ?? "", entry.rel ?? "", entry.name ?? ""].join("\u0000");
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        deduped.push(entry);
    }

    return deduped;
}

function main(): void {
    let rawInput = process.argv[2] ?? "";
    if (rawInput.trim() === "") {
        const branch = getCurrentBranch();
        const inferredId = inferPbiIdFromBranch(branch);
        if (inferredId === null) {
            printError("Usage: /ado-pbi <pbi-id-or-work-item-url> (or use a branch containing AB#12345 or 12345)");
        }

        rawInput = inferredId;
    }

    const workItemId = extractWorkItemId(rawInput);
    if (workItemId === null) {
        printError("Could not parse work item ID from input");
    }

    const urlContext = parseOrgAndProject(rawInput);
    const org = urlContext.org ?? detectOrgFromGitRemote();
    const project = urlContext.project;

    let pbi: unknown;
    try {
        pbi = runWorkItemShow(workItemId, org);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        printError(`Failed to fetch PBI #${workItemId}. ${message}`);
    }

    const pbiRecord = asRecord(pbi) ?? {};
    const taskIds = extractTaskIds(asRelations(pbiRecord.relations));
    const tasks: unknown[] = [];
    const taskErrors: Array<Record<string, string>> = [];
    const wikiLinks = collectWikiLinks(asRelations(pbiRecord.relations), "pbi");

    for (const taskId of taskIds) {
        try {
            const task = runWorkItemShow(taskId, org);
            tasks.push(task);
            const taskRecord = asRecord(task) ?? {};
            wikiLinks.push(...collectWikiLinks(asRelations(taskRecord.relations), `task:${taskId}`));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            taskErrors.push({ taskId, error: message });
        }
    }

    const payload = {
        input: rawInput,
        workItemId,
        org,
        project,
        pbi,
        tasks,
        taskErrors,
        wikiLinks: dedupeWikiLinks(wikiLinks),
    };

    console.log(JSON.stringify(payload));
}

main();
