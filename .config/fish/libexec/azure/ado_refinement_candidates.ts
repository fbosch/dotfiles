#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheRoot, ensureDir } from "../shared/fs.js";
import { runCommand } from "../shared/process.js";

type AdoContext = {
    org: string | null;
    project: string | null;
};

type Iteration = {
    id: string;
    name: string;
    path: string;
    startDate: string | null;
    finishDate: string | null;
};

type Candidate = {
    id: number;
    title: string;
    state: string;
    assignedTo: string;
    iterationPath: string;
    teamProject: string;
    tags: string[];
    description: string;
    acceptanceCriteria: string;
    storyPoints: number | null;
    childTaskCount: number;
    backlogPriority: number | null;
    priority: number | null;
    score: number;
    reasons: string[];
    gaps: string[];
    url: string | null;
};

type CachePayload = {
    org: string | null;
    project: string | null;
    team: string;
    iteration: Iteration;
    candidates: Candidate[];
};

type WorkItemRecord = Record<string, unknown>;

const REFINEMENT_TAG_PATTERNS = [/refine/i, /refinement/i, /needs[- ]refinement/i, /discovery/i, /analysis/i];

main();

function main(): void {
    const subcommand = process.argv[2] ?? "";

    switch (subcommand) {
        case "list":
            listCandidates(process.argv[3] ?? "", process.argv[4] ?? "", process.argv[5] === "1");
            return;
        case "preview":
            renderPreview(process.argv[3] ?? "", process.argv[4] ?? "");
            return;
        case "prompt":
            renderPrompt(process.argv[3] ?? "", process.argv.slice(4));
            return;
        default:
            console.log("ERROR: Usage: azure/ado_refinement_candidates.ts <list|preview|prompt> ...");
    }
}

function listCandidates(contextInput: string, teamInput: string, refresh: boolean): void {
    const cacheFile = cacheFilePath(contextInput, teamInput);

    let payload: CachePayload;
    if (refresh === false && existsSync(cacheFile)) {
        const cached = readCache(cacheFile);
        if (cached !== null) {
            payload = cached;
            printList(cacheFile, payload);
            return;
        }
    }

    const built = buildCachePayload(contextInput, teamInput);
    if (typeof built === "string") {
        console.log(`ERROR: ${built}`);
        return;
    }

    payload = built;
    const ensureResult = ensureDir(join(cacheRoot(), "fish", "ado-refinement-candidates"));
    if (ensureResult.isErr()) {
        console.log(`ERROR: ${ensureResult.error}`);
        return;
    }

    writeFileSync(cacheFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    printList(cacheFile, payload);
}

function renderPreview(cacheFile: string, idInput: string): void {
    const payload = readCache(cacheFile);
    if (payload === null) {
        console.log("Preview unavailable: cache missing");
        return;
    }

    const id = Number.parseInt(idInput, 10);
    const candidate = payload.candidates.find((entry) => entry.id === id);
    if (candidate === undefined) {
        console.log(`Preview unavailable: PBI #${idInput} not found`);
        return;
    }

    const lines = [
        `# PBI #${candidate.id}: ${candidate.title}`,
        "",
        "## Details",
        `- State: ${candidate.state}`,
        `- Assigned To: ${candidate.assignedTo}`,
        `- Team Project: ${candidate.teamProject || payload.project || "N/A"}`,
        `- Team: ${payload.team}`,
        `- Iteration: ${candidate.iterationPath}`,
        `- Tags: ${candidate.tags.length > 0 ? candidate.tags.join(", ") : "None"}`,
        `- Story Points: ${candidate.storyPoints ?? "N/A"}`,
        `- Child Tasks: ${String(candidate.childTaskCount)}`,
        candidate.url ? `- URL: ${candidate.url}` : "- URL: N/A",
        "",
        "## Score",
        `- Score: ${String(candidate.score)}`,
        `- Gaps: ${candidate.gaps.length > 0 ? candidate.gaps.join(", ") : "None"}`,
        ...candidate.reasons.map((reason) => `- ${reason}`),
        "",
        "## Description",
        candidate.description,
        "",
        "## Acceptance Criteria",
        candidate.acceptanceCriteria,
    ];

    console.log(lines.join("\n"));
}

function renderPrompt(cacheFile: string, idInputs: string[]): void {
    const payload = readCache(cacheFile);
    if (payload === null) {
        console.log("ERROR: Prompt cache is missing");
        return;
    }

    const selected = idInputs
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isNaN(value) === false)
        .map((id) => payload.candidates.find((entry) => entry.id === id))
        .filter((entry): entry is Candidate => entry !== undefined);

    if (selected.length === 0) {
        console.log("ERROR: No refinement candidates selected");
        return;
    }

    const lines = [
        "Create a todo list first.",
        "",
        "Use the selected Azure DevOps PBIs below as next-sprint refinement candidates.",
        "Do not mutate Azure DevOps. Work only from the provided context.",
        "",
        "For each selected PBI:",
        "1. Identify missing refinement inputs and ambiguities.",
        "2. Produce actionable refinement todos.",
        "3. List clarification questions that should be answered before sprint work starts.",
        "4. Suggest missing acceptance criteria or task breakdown improvements when obvious.",
        "",
        `Resolved team: ${payload.team}`,
        `Next sprint iteration: ${payload.iteration.path}`,
        "",
        "Selected PBIs:",
        "",
    ];

    for (const candidate of selected) {
        lines.push(`## PBI #${candidate.id}: ${candidate.title}`);
        lines.push(`- State: ${candidate.state}`);
        lines.push(`- Assigned To: ${candidate.assignedTo}`);
        lines.push(`- Iteration: ${candidate.iterationPath}`);
        lines.push(`- Tags: ${candidate.tags.length > 0 ? candidate.tags.join(", ") : "None"}`);
        lines.push(`- Story Points: ${candidate.storyPoints ?? "N/A"}`);
        lines.push(`- Child Tasks: ${String(candidate.childTaskCount)}`);
        lines.push(`- Heuristic Score: ${String(candidate.score)}`);
        lines.push(`- Heuristic Reasons: ${candidate.reasons.join("; ")}`);
        if (candidate.url !== null) {
            lines.push(`- Azure URL: ${candidate.url}`);
        }
        lines.push("");
        lines.push("Description:");
        lines.push(candidate.description);
        lines.push("");
        lines.push("Acceptance Criteria:");
        lines.push(candidate.acceptanceCriteria);
        lines.push("");
    }

    console.log(lines.join("\n"));
}

function buildCachePayload(contextInput: string, teamInput: string): CachePayload | string {
    const urlContext = parseOrgAndProject(contextInput);
    const org = urlContext.org ?? detectOrgFromGitRemote();
    let project = urlContext.project;

    const explicitTeam = teamInput.trim();
    if (explicitTeam === "" && project === null) {
        return "Could not determine Azure DevOps project from context. Re-run with --context <ado-url> or --team <team>.";
    }

    const attemptedProjectTeam = explicitTeam === "";
    const team = explicitTeam || project || "";
    const iterationList = listTeamIterations(team, org, project);
    if (typeof iterationList === "string") {
        if (attemptedProjectTeam) {
            return `Failed to resolve Azure DevOps team using project name '${team}'. Re-run with --team <team>.`;
        }

        return iterationList;
    }

    const nextIteration = selectNextIteration(iterationList);
    if (nextIteration === null) {
        return `No future iteration found for team '${team}'.`;
    }

    if (project === null || project === "") {
        project = projectFromIterationPath(nextIteration.path);
    }

    const candidateIds = queryCandidateIds(org, project, nextIteration.path);
    if (typeof candidateIds === "string") {
        return candidateIds;
    }

    const candidates = candidateIds
        .map((id) => fetchCandidate(id, org, project))
        .filter((entry): entry is Candidate => entry !== null)
        .sort(compareCandidates);

    return {
        org,
        project,
        team,
        iteration: nextIteration,
        candidates,
    };
}

function printList(cacheFile: string, payload: CachePayload): void {
    console.log(`CACHE_FILE\t${cacheFile}`);
    console.log(
        `SUMMARY\t${payload.candidates.length} candidate(s) | team ${payload.team} | next sprint ${payload.iteration.path}`,
    );

    for (const candidate of payload.candidates) {
        const display = [
            `[${String(candidate.score).padStart(2, "0")}]`,
            `#${candidate.id}`,
            truncate(candidate.title, 96),
            `| ${candidate.state}`,
            `| ${candidate.gaps.length > 0 ? candidate.gaps.join(", ") : "no major gaps"}`,
        ].join(" ");
        console.log(`${candidate.id}\t${display}`);
    }
}

function readCache(cacheFile: string): CachePayload | null {
    try {
        const raw = readFileSync(cacheFile, "utf8");
        const parsed = JSON.parse(raw) as CachePayload;
        if (Array.isArray(parsed.candidates) === false || typeof parsed.team !== "string") {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function cacheFilePath(contextInput: string, teamInput: string): string {
    const hash = createHash("md5")
        .update(JSON.stringify({ cwd: process.cwd(), contextInput, teamInput }))
        .digest("hex");
    return join(cacheRoot(), "fish", "ado-refinement-candidates", `${hash}.json`);
}

function parseOrgAndProject(value: string): AdoContext {
    const text = value.trim();
    if (text.startsWith("http") === false) {
        return { org: null, project: null };
    }

    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        return { org: null, project: null };
    }

    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeSegment);

    if (host.endsWith("dev.azure.com")) {
        if (segments.length < 2) {
            return { org: null, project: null };
        }

        return {
            org: `https://dev.azure.com/${segments[0]}`,
            project: segments[1],
        };
    }

    if (host.endsWith("visualstudio.com")) {
        return {
            org: `${parsed.protocol}//${parsed.host}`,
            project: segments[0] ?? null,
        };
    }

    return { org: null, project: null };
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function detectOrgFromGitRemote(): string | null {
    const remoteResult = runCommand("git", ["config", "--get", "remote.origin.url"]);
    if (remoteResult.isErr()) {
        return null;
    }

    const remote = remoteResult.value.trim();
    if (remote === "") {
        return null;
    }

    const devAzureMatch = remote.match(/dev\.azure\.com\/([^/]+)\//);
    if (devAzureMatch?.[1]) {
        return `https://dev.azure.com/${devAzureMatch[1]}`;
    }

    const visualStudioMatch = remote.match(/https:\/\/([^.]+)\.visualstudio\.com/);
    if (visualStudioMatch?.[1]) {
        return `https://${visualStudioMatch[1]}.visualstudio.com`;
    }

    return null;
}

function azureEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt",
    };
}

function runJson<T>(args: string[]): T | string {
    const result = runCommand("az", args, { env: azureEnv() });
    if (result.isErr()) {
        return result.error;
    }

    try {
        return JSON.parse(result.value) as T;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Invalid JSON response: ${message}`;
    }
}

function listTeamIterations(team: string, org: string | null, project: string | null): Iteration[] | string {
    const args = ["boards", "iteration", "team", "list", "--team", team, "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }
    if (project !== null && project !== "") {
        args.push("--project", project);
    }

    const result = runJson<unknown>(args);
    if (typeof result === "string") {
        return result;
    }

    if (Array.isArray(result) === false) {
        return "Unexpected Azure DevOps iteration response";
    }

    return result
        .map(normalizeIteration)
        .filter((entry): entry is Iteration => entry !== null)
        .sort((left, right) => compareDates(left.startDate, right.startDate));
}

function normalizeIteration(value: unknown): Iteration | null {
    const record = asRecord(value);
    if (record === null) {
        return null;
    }

    const attributes = asRecord(record.attributes) ?? {};
    const id = stringValue(record.id) ?? stringValue(attributes.id) ?? "";
    const name = stringValue(record.name) ?? "N/A";
    const path = stringValue(record.path) ?? name;
    return {
        id,
        name,
        path,
        startDate: stringValue(attributes.startDate) ?? stringValue(record.startDate),
        finishDate: stringValue(attributes.finishDate) ?? stringValue(record.finishDate),
    };
}

function selectNextIteration(iterations: Iteration[]): Iteration | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const iteration of iterations) {
        if (iteration.startDate === null) {
            continue;
        }

        const startDate = new Date(iteration.startDate);
        if (Number.isNaN(startDate.getTime())) {
            continue;
        }

        if (startDate.getTime() > today.getTime()) {
            return iteration;
        }
    }

    return null;
}

function projectFromIterationPath(path: string): string | null {
    const [project] = path.split("\\");
    return project && project.length > 0 ? project : null;
}

function queryCandidateIds(org: string | null, project: string | null, iterationPath: string): number[] | string {
    const clauses = [
        `[System.WorkItemType] = 'Product Backlog Item'`,
        `[System.State] IN ('New', 'Approved')`,
        `[System.IterationPath] = '${escapeWiqlString(iterationPath)}'`,
    ];

    if (project !== null && project !== "") {
        clauses.unshift(`[System.TeamProject] = '${escapeWiqlString(project)}'`);
    }

    const wiql = [`SELECT [System.Id] FROM WorkItems`, `WHERE ${clauses.join(" AND ")}`].join(" ");
    const args = ["boards", "query", "--wiql", wiql, "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }
    if (project !== null && project !== "") {
        args.push("--project", project);
    }

    const result = runJson<unknown>(args);
    if (typeof result === "string") {
        return result;
    }

    const record = asRecord(result);
    const workItems = Array.isArray(record?.workItems) ? record.workItems : [];
    return workItems
        .map((entry) => numberValue(asRecord(entry)?.id))
        .filter((value): value is number => value !== null);
}

function fetchCandidate(id: number, org: string | null, project: string | null): Candidate | null {
    const args = ["boards", "work-item", "show", "--id", String(id), "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }
    if (project !== null && project !== "") {
        args.push("--project", project);
    }

    const result = runJson<unknown>(args);
    if (typeof result === "string") {
        return null;
    }

    const record = asRecord(result);
    const fields = asRecord(record?.fields) ?? {};
    const relations = Array.isArray(record?.relations) ? record.relations : [];

    const title = stringValue(fields["System.Title"]) ?? `PBI #${String(id)}`;
    const state = stringValue(fields["System.State"]) ?? "N/A";
    const assignedTo = displayName(fields["System.AssignedTo"]);
    const iterationPath = stringValue(fields["System.IterationPath"]) ?? "N/A";
    const teamProject = stringValue(fields["System.TeamProject"]) ?? (project ?? "N/A");
    const description = normalizeHtmlField(fields["System.Description"]);
    const acceptanceCriteria = normalizeHtmlField(fields["Microsoft.VSTS.Common.AcceptanceCriteria"]);
    const storyPoints = numericField(fields["Microsoft.VSTS.Scheduling.StoryPoints"]);
    const backlogPriority = numericField(fields["Microsoft.VSTS.Common.BacklogPriority"]);
    const priority = numericField(fields["Microsoft.VSTS.Common.Priority"]);
    const tags = splitTags(stringValue(fields["System.Tags"]));
    const childTaskCount = relations.filter((entry) => relationType(entry) === "System.LinkTypes.Hierarchy-Forward").length;
    const reasons: string[] = [];
    const gaps: string[] = [];
    let score = 0;

    if (acceptanceCriteria === "N/A") {
        score += 5;
        reasons.push("Missing acceptance criteria");
        gaps.push("acceptance criteria");
    }

    if (storyPoints === null) {
        score += 4;
        reasons.push("Missing story points");
        gaps.push("story points");
    }

    if (description === "N/A" || description.length < 80) {
        score += 3;
        reasons.push(description === "N/A" ? "Missing description" : "Description is still short");
        gaps.push("description");
    }

    if (childTaskCount === 0) {
        score += 2;
        reasons.push("No child tasks linked yet");
        gaps.push("child tasks");
    }

    const matchingTags = tags.filter((tag) => REFINEMENT_TAG_PATTERNS.some((pattern) => pattern.test(tag)));
    if (matchingTags.length > 0) {
        score += 2;
        reasons.push(`Refinement-related tags present: ${matchingTags.join(", ")}`);
    }

    if (priority === 1) {
        score += 2;
        reasons.push("Marked with highest priority");
    } else if (priority === 2) {
        score += 1;
        reasons.push("Marked with elevated priority");
    }

    return {
        id,
        title,
        state,
        assignedTo,
        iterationPath,
        teamProject,
        tags,
        description,
        acceptanceCriteria,
        storyPoints,
        childTaskCount,
        backlogPriority,
        priority,
        score,
        reasons,
        gaps: uniqueStrings(gaps),
        url: workItemUrl(org, teamProject, id),
    };
}

function compareCandidates(left: Candidate, right: Candidate): number {
    if (right.score !== left.score) {
        return right.score - left.score;
    }

    if (left.backlogPriority !== null && right.backlogPriority !== null && left.backlogPriority !== right.backlogPriority) {
        return left.backlogPriority - right.backlogPriority;
    }

    if (left.backlogPriority === null && right.backlogPriority !== null) {
        return 1;
    }
    if (left.backlogPriority !== null && right.backlogPriority === null) {
        return -1;
    }

    return left.id - right.id;
}

function compareDates(left: string | null, right: string | null): number {
    if (left === right) {
        return 0;
    }
    if (left === null) {
        return 1;
    }
    if (right === null) {
        return -1;
    }

    const leftDate = new Date(left);
    const rightDate = new Date(right);
    return leftDate.getTime() - rightDate.getTime();
}

function normalizeHtmlField(value: unknown): string {
    const text = stringValue(value);
    if (text === null || text.trim() === "") {
        return "N/A";
    }

    const htmlToTextResult = runCommand("html2text", ["-utf8", "-nobs", "-width", "100"], { input: text });
    if (htmlToTextResult.isOk()) {
        const trimmed = htmlToTextResult.value.trim();
        return trimmed === "" ? "N/A" : trimmed;
    }

    const stripped = decodeEntities(text)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return stripped === "" ? "N/A" : stripped;
}

function decodeEntities(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

function splitTags(value: string | null): string[] {
    if (value === null || value.trim() === "") {
        return [];
    }

    return value
        .split(";")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);
}

function relationType(value: unknown): string {
    return stringValue(asRecord(value)?.rel) ?? "";
}

function displayName(value: unknown): string {
    const record = asRecord(value);
    if (record === null) {
        return "Unassigned";
    }

    return stringValue(record.displayName) ?? "Unassigned";
}

function workItemUrl(org: string | null, project: string, id: number): string | null {
    if (org === null || project === "" || project === "N/A") {
        return null;
    }

    return `${org}/${encodeURIComponent(project)}/_workitems/edit/${String(id)}`;
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeWiqlString(value: string): string {
    return value.replaceAll("'", "''");
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values)];
}

function asRecord(value: unknown): WorkItemRecord | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }

    return value as WorkItemRecord;
}

function stringValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

function numericField(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function numberValue(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
}
