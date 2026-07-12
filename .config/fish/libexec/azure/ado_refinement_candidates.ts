#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheRoot, ensureDir } from "../shared/fs.js";
import { runCommand } from "../shared/process.js";

type AdoContext = {
    org: string | null;
    project: string | null;
    repositoryName: string | null;
};

type TeamInfo = {
    id: string | null;
    name: string;
    description: string | null;
};

type Iteration = {
    id: string;
    name: string;
    path: string;
    startDate: string | null;
    finishDate: string | null;
    timeFrame: string | null;
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

type CandidateDetails = Omit<Candidate, "score" | "reasons" | "gaps" | "url">;

type CandidateScoreRule = {
    matches: boolean;
    points: number;
    reason: string;
    gap?: string;
};

type CachePayload = {
    org: string | null;
    project: string | null;
    team: string;
    iteration: Iteration;
    candidates: Candidate[];
};

type BuildResult =
    | { type: "payload"; payload: CachePayload }
    | { type: "choose-team"; project: string; teams: TeamInfo[] }
    | { type: "error"; error: string };

type WorkItemRecord = Record<string, unknown>;
type CandidateContext = { org: string | null; project: string | null; team: string };
type CandidateContextInput = { context: AdoContext; remoteUrl: string | null };

const REFINEMENT_TAG_PATTERNS = [/refine/i, /refinement/i, /needs[- ]refinement/i, /discovery/i, /analysis/i];
const CANDIDATE_STATES = new Set(["New", "Approved", "To Be Refined"]);
const EMPTY_ADO_CONTEXT: AdoContext = { org: null, project: null, repositoryName: null };
const REMOTE_URL_PATTERNS = [
    {
        pattern: /(?:https:\/\/|https:\/\/[^@]+@)dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/,
        org: (match: RegExpMatchArray) => `https://dev.azure.com/${match[1]}`,
    },
    {
        pattern: /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/,
        org: (match: RegExpMatchArray) => `https://dev.azure.com/${match[1]}`,
    },
    {
        pattern: /https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/,
        org: (match: RegExpMatchArray) => `https://${match[1]}.visualstudio.com`,
    },
    {
        pattern: /[^@]+@vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/[^/]+/,
        org: (match: RegExpMatchArray) => `https://${match[1]}.visualstudio.com`,
    },
];

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
    if (built.type === "error") {
        console.log(`ERROR: ${built.error}`);
        return;
    }

    if (built.type === "choose-team") {
        console.log(`TEAM_PROMPT\tSelect Azure DevOps team for project ${built.project}`);
        for (const team of built.teams) {
            console.log(`TEAM_OPTION\t${team.name}\t${team.description ?? ""}`);
        }
        return;
    }

    payload = built.payload;
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

function buildCachePayload(contextInput: string, teamInput: string): BuildResult {
    const contextResult = resolveCandidateContext(contextInput, teamInput);
    if ("type" in contextResult) {
        return contextResult;
    }

    return buildPayloadForContext(contextResult);
}

function buildPayloadForContext(context: CandidateContext): BuildResult {
    const iterationResult = nextTeamIteration(context);
    if (typeof iterationResult === "string") {
        return { type: "error", error: iterationResult };
    }

    const { iteration, project } = iterationResult;
    const candidateIds = queryCandidateIds(context.org, project, context.team, iteration.id);
    if (typeof candidateIds === "string") {
        return { type: "error", error: candidateIds };
    }

    const candidates = candidateIds
        .map((id) => fetchCandidate(id, context.org, project))
        .filter((entry): entry is Candidate => entry !== null)
        .sort(compareCandidates);

    return {
        type: "payload",
        payload: { org: context.org, project, team: context.team, iteration, candidates },
    };
}

function nextTeamIteration(context: CandidateContext): { iteration: Iteration; project: string | null } | string {
    const iterationList = listTeamIterations(context.team, context.org, context.project);
    if (typeof iterationList === "string") {
        return iterationList;
    }

    const nextIteration = selectNextIteration(iterationList);
    if (nextIteration === null) {
        return `No future iteration found for team '${context.team}'.`;
    }

    return { iteration: nextIteration, project: iterationProject(context.project, nextIteration.path) };
}

function iterationProject(project: string | null, iterationPath: string): string | null {
    if (project === null || project === "") {
        return projectFromIterationPath(iterationPath);
    }

    return project;
}

function resolveCandidateContext(contextInput: string, teamInput: string): CandidateContext | Exclude<BuildResult, { type: "payload" }> {
    const { context, remoteUrl } = candidateContextInput(contextInput);

    const explicitTeam = teamInput.trim();
    if (explicitTeam !== "") {
        return { org: context.org, project: context.project, team: explicitTeam };
    }

    if (context.project === null) {
        return missingProjectError(remoteUrl);
    }

    return resolveFallbackTeam(context.org, context.project, context.repositoryName);
}

function candidateContextInput(contextInput: string): CandidateContextInput {
    const remoteUrl = detectGitRemoteUrl();
    return {
        context: mergeAdoContexts(parseOrgAndProject(contextInput), remoteAdoContext(remoteUrl)),
        remoteUrl,
    };
}

function remoteAdoContext(remoteUrl: string | null): AdoContext {
    if (remoteUrl === null) {
        return EMPTY_ADO_CONTEXT;
    }

    return parseRemoteUrl(remoteUrl);
}

function mergeAdoContexts(primary: AdoContext, fallback: AdoContext): AdoContext {
    return {
        org: primary.org ?? fallback.org,
        project: primary.project ?? fallback.project,
        repositoryName: primary.repositoryName ?? fallback.repositoryName,
    };
}

function missingProjectError(remoteUrl: string | null): { type: "error"; error: string } {
    if (remoteUrl !== null) {
        return {
            type: "error",
            error: `Could not determine Azure DevOps project from git remote '${remoteUrl}'. Re-run with --context <ado-url> or --team <team>.`,
        };
    }

    return {
        type: "error",
        error: "Could not determine Azure DevOps project from context. Re-run with --context <ado-url> or --team <team>.",
    };
}

function resolveFallbackTeam(
    org: string | null,
    project: string,
    repositoryName: string | null,
): CandidateContext | Exclude<BuildResult, { type: "payload" }> {
    const resolvedTeam = resolveTeamFallback(org, project, repositoryName);
    if (resolvedTeam.type === "resolved") {
        return { org, project, team: resolvedTeam.team };
    }
    if (resolvedTeam.type === "choose-team") {
        return { type: "choose-team", project, teams: resolvedTeam.teams };
    }

    return resolvedTeam;
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

function helperCwd(): string | undefined {
    return process.env.FISH_LIBEXEC_CWD || undefined;
}

function parseOrgAndProject(value: string): AdoContext {
    const text = value.trim();
    if (text.startsWith("http") === false) {
        return EMPTY_ADO_CONTEXT;
    }

    let parsed: URL;
    try {
        parsed = new URL(text);
    } catch {
        return EMPTY_ADO_CONTEXT;
    }

    const host = parsed.hostname.toLowerCase();
    const segments = parsed.pathname
        .split("/")
        .filter((segment) => segment.length > 0)
        .map(decodeSegment);

    if (host.endsWith("dev.azure.com")) {
        const [organization, project, marker, repositoryName] = segments;
        if (organization === undefined || project === undefined) {
            return EMPTY_ADO_CONTEXT;
        }

        return {
            org: `https://dev.azure.com/${organization}`,
            project,
            repositoryName: marker === "_git" ? (repositoryName ?? null) : null,
        };
    }

    if (host.endsWith("visualstudio.com")) {
        return {
            org: `${parsed.protocol}//${parsed.host}`,
            project: segments[0] ?? null,
            repositoryName: segments[1] === "_git" ? (segments[2] ?? null) : null,
        };
    }

    return EMPTY_ADO_CONTEXT;
}

function decodeSegment(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function parseRemoteUrl(remote: string): AdoContext {
    for (const { pattern, org } of REMOTE_URL_PATTERNS) {
        const match = remote.match(pattern);
        if (match?.[1] && match[2]) {
            return {
                org: org(match),
                project: decodeSegment(match[2]),
                repositoryName: decodeSegment(match[3] ?? ""),
            };
        }
    }

    return EMPTY_ADO_CONTEXT;
}

function detectGitRemoteUrl(): string | null {
    const remoteResult = runCommand("git", ["config", "--get", "remote.origin.url"], { cwd: helperCwd() });
    if (remoteResult.isErr()) {
        return null;
    }

    const remote = remoteResult.value.trim();
    return remote === "" ? null : remote;
}

function listProjectTeams(org: string | null, project: string | null): TeamInfo[] | string {
    if (project === null || project === "") {
        return "Could not determine Azure DevOps project from context. Re-run with --context <ado-url> or --team <team>.";
    }

    const args = ["devops", "team", "list", "--project", project, "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }

    const result = runJson<unknown>(args);
    if (typeof result === "string") {
        return result;
    }

    if (Array.isArray(result) === false) {
        return "Unexpected Azure DevOps team response";
    }

    return result
        .map((value) => {
            const record = asRecord(value);
            const name = stringValue(record?.name);
            if (name === null) {
                return null;
            }

            return {
                id: stringValue(record?.id),
                name,
                description: stringValue(record?.description),
            } satisfies TeamInfo;
        })
        .filter((entry): entry is TeamInfo => entry !== null);
}

function resolveTeamFallback(
    org: string | null,
    project: string | null,
    repositoryName: string | null,
): { type: "resolved"; team: string } | { type: "choose-team"; teams: TeamInfo[] } | { type: "error"; error: string } {
    if (project === null || project === "") {
        return { type: "error", error: "Could not determine Azure DevOps project from context. Re-run with --context <ado-url> or --team <team>." };
    }

    const teams = listProjectTeams(org, project);
    if (typeof teams === "string") {
        return { type: "error", error: teams };
    }

    if (teams.length === 0) {
        return { type: "error", error: `No Azure DevOps teams found for project '${project}'. Re-run with --team <team>.` };
    }

    if (teams.length === 1) {
        return { type: "resolved", team: teams[0].name };
    }

    const rankedTeams = rankTeams(teams, project, repositoryName);
    if (rankedTeams.length > 0 && rankedTeams[0].score > 0) {
        const topScore = rankedTeams[0].score;
        const topTeams = rankedTeams.filter((entry) => entry.score === topScore);
        if (topTeams.length === 1) {
            return { type: "resolved", team: topTeams[0].team.name };
        }

        return { type: "choose-team", teams: topTeams.map((entry) => entry.team) };
    }

    return { type: "choose-team", teams };
}

function rankTeams(teams: TeamInfo[], project: string, repositoryName: string | null): Array<{ team: TeamInfo; score: number }> {
    const normalizedProject = normalizeToken(project);
    const normalizedRepo = repositoryName ? normalizeToken(repositoryName) : "";
    const projectTokens = tokenize(project);
    const repoTokens = repositoryName ? tokenize(repositoryName) : [];

    return teams
        .map((team) => {
            const normalizedTeam = normalizeToken(team.name);
            let score = 0;

            if (normalizedTeam === normalizedProject) {
                score += 100;
            }
            if (normalizedRepo !== "" && normalizedTeam === normalizedRepo) {
                score += 95;
            }
            score += tokenOverlapScore(normalizedTeam, projectTokens, 15);
            score += tokenOverlapScore(normalizedTeam, repoTokens, 25);

            if (/^team\b/i.test(team.name)) {
                score += 10;
            }
            if (/^projekt\b/i.test(team.name) || /^project\b/i.test(team.name)) {
                score -= 20;
            }
            if ((team.description ?? "").toLowerCase().includes("only project admin")) {
                score -= 100;
            }

            return { team, score };
        })
        .sort((left, right) => right.score - left.score || left.team.name.localeCompare(right.team.name));
}

function tokenize(value: string): string[] {
    return value
        .split(/[._\-\s]+/)
        .map(normalizeToken)
        .filter((token) => token.length > 0);
}

function tokenOverlapScore(normalizedTeam: string, tokens: string[], pointsPerToken: number): number {
    let score = 0;
    for (const token of tokens) {
        if (token.length < 3) {
            continue;
        }
        if (normalizedTeam.includes(token)) {
            score += pointsPerToken;
        }
    }
    return score;
}

function normalizeToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function azureEnv(): NodeJS.ProcessEnv {
    return {
        ...process.env,
        AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "yes_without_prompt",
    };
}

function runJson<T>(args: string[]): T | string {
    const result = runCommand("az", args, { cwd: helperCwd(), env: azureEnv() });
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
        timeFrame: stringValue(attributes.timeFrame) ?? stringValue(record.timeFrame),
    };
}

function selectNextIteration(iterations: Iteration[]): Iteration | null {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureWithValidDate = iterations.find(
        (iteration) =>
            iteration.timeFrame === "future" &&
            iteration.startDate !== null &&
            Number.isNaN(new Date(iteration.startDate).getTime()) === false,
    );
    if (futureWithValidDate !== undefined) {
        return futureWithValidDate;
    }

    const futureIteration = iterations.find((iteration) => iteration.timeFrame === "future");
    if (futureIteration !== undefined) {
        return futureIteration;
    }

    return (
        iterations.find(
            (iteration) =>
                iteration.startDate !== null &&
                Number.isNaN(new Date(iteration.startDate).getTime()) === false &&
                new Date(iteration.startDate).getTime() > today.getTime(),
        ) ?? null
    );
}

function projectFromIterationPath(path: string): string | null {
    const [project] = path.split("\\");
    return project && project.length > 0 ? project : null;
}

function queryCandidateIds(org: string | null, project: string | null, team: string, iterationId: string): number[] | string {
    const args = ["boards", "iteration", "team", "list-work-items", "--id", iterationId, "--team", team, "--output", "json"];
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
    const relations = Array.isArray(record?.workItemRelations) ? record.workItemRelations : [];
    const ids = new Set<number>();

    for (const relation of relations) {
        const relationRecord = asRecord(relation);
        const sourceId = numberValue(asRecord(relationRecord?.source)?.id);
        const targetId = numberValue(asRecord(relationRecord?.target)?.id);
        if (sourceId !== null) {
            ids.add(sourceId);
        }
        if (targetId !== null) {
            ids.add(targetId);
        }
    }

    return [...ids].sort((left, right) => left - right);
}

function fetchCandidate(id: number, org: string | null, project: string | null): Candidate | null {
    const args = ["boards", "work-item", "show", "--id", String(id), "--output", "json"];
    if (org !== null) {
        args.push("--org", org);
    }

    const result = runJson<unknown>(args);
    if (typeof result === "string") {
        return null;
    }

    const candidate = candidateDetails(id, result, project);
    return candidate === null ? null : scoreCandidate(candidate, org);
}

function candidateDetails(id: number, value: unknown, project: string | null): CandidateDetails | null {
    const record = asRecord(value);
    const fields = workItemFields(record);
    const state = defaultString(fields["System.State"], "N/A");
    if (isCandidateWorkItem(fields, state) === false) {
        return null;
    }

    return buildCandidateDetails(id, fields, workItemRelations(record), project, state);
}

function workItemFields(record: WorkItemRecord | null): WorkItemRecord {
    return asRecord(record?.fields) ?? {};
}

function workItemRelations(record: WorkItemRecord | null): unknown[] {
    return Array.isArray(record?.relations) ? record.relations : [];
}

function buildCandidateDetails(
    id: number,
    fields: WorkItemRecord,
    relations: unknown[],
    project: string | null,
    state: string,
): CandidateDetails {
    return {
        id,
        title: defaultString(fields["System.Title"], `PBI #${String(id)}`),
        state,
        assignedTo: displayName(fields["System.AssignedTo"]),
        iterationPath: defaultString(fields["System.IterationPath"], "N/A"),
        teamProject: defaultString(fields["System.TeamProject"], defaultString(project, "N/A")),
        tags: splitTags(stringValue(fields["System.Tags"])),
        description: normalizeHtmlField(fields["System.Description"]),
        acceptanceCriteria: normalizeHtmlField(fields["Microsoft.VSTS.Common.AcceptanceCriteria"]),
        storyPoints: numericField(fields["Microsoft.VSTS.Scheduling.StoryPoints"]),
        childTaskCount: relations.filter((entry) => relationType(entry) === "System.LinkTypes.Hierarchy-Forward").length,
        backlogPriority: numericField(fields["Microsoft.VSTS.Common.BacklogPriority"]),
        priority: numericField(fields["Microsoft.VSTS.Common.Priority"]),
    };
}

function defaultString(value: unknown, fallback: string): string {
    return stringValue(value) ?? fallback;
}

function isCandidateWorkItem(fields: WorkItemRecord, state: string): boolean {
    if (stringValue(fields["System.WorkItemType"]) !== "Product Backlog Item") {
        return false;
    }

    return CANDIDATE_STATES.has(state);
}

function scoreCandidate(candidate: CandidateDetails, org: string | null): Candidate {
    const matchingTags = candidate.tags.filter((tag) => REFINEMENT_TAG_PATTERNS.some((pattern) => pattern.test(tag)));
    const rules: CandidateScoreRule[] = [
        { matches: candidate.acceptanceCriteria === "N/A", points: 5, reason: "Missing acceptance criteria", gap: "acceptance criteria" },
        { matches: candidate.storyPoints === null, points: 4, reason: "Missing story points", gap: "story points" },
        { matches: candidate.description === "N/A", points: 3, reason: "Missing description", gap: "description" },
        { matches: candidate.description !== "N/A" && candidate.description.length < 80, points: 3, reason: "Description is still short", gap: "description" },
        { matches: candidate.childTaskCount === 0, points: 2, reason: "No child tasks linked yet", gap: "child tasks" },
        { matches: matchingTags.length > 0, points: 2, reason: `Refinement-related tags present: ${matchingTags.join(", ")}` },
        { matches: candidate.priority === 1, points: 2, reason: "Marked with highest priority" },
        { matches: candidate.priority === 2, points: 1, reason: "Marked with elevated priority" },
    ];
    const score = rules.filter((rule) => rule.matches).reduce((total, rule) => total + rule.points, 0);
    const reasons = rules.filter((rule) => rule.matches).map((rule) => rule.reason);
    const gaps = rules.flatMap((rule) => (rule.matches && rule.gap !== undefined ? [rule.gap] : []));

    return { ...candidate, score, reasons, gaps: uniqueStrings(gaps), url: workItemUrl(org, candidate.teamProject, candidate.id) };
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
