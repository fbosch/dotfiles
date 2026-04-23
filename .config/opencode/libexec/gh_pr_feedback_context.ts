#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const callerCwd = process.env.OPENCODE_LIBEXEC_CWD;
if (callerCwd) {
  process.chdir(callerCwd);
}

type Source = "url" | "number" | "text-number" | "branch";

type Identity = {
  owner: string;
  repo: string;
  number: number;
  reviewId: number | null;
  commentId: number | null;
  source: Source;
  url: string;
  title?: string;
};

type NameStatus = {
  code: string;
  newPath: string | null;
};

type NormalizedThread = {
  threadId: string | null;
  commentId: number | null;
  path: string;
  line: number | null;
  startLine: number | null;
  lineRange: string;
  pathLine: string;
  isResolved: boolean;
  isOutdated: boolean;
  authorLogins: string[];
  actionableText: string;
  severity: "request-changes" | "should-fix" | "nit" | "info";
  corroboratedBy?: string[];
};

type ProposedThread = NormalizedThread & {
  reason: string;
  confidence: "high" | "medium";
  resolutionNote?: string;
};

const GRAPHQL_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      number
      title
      url
      reviewThreads(first: 100, after: $after) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              bodyText
              createdAt
              url
              author {
                login
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`;

const modeArg = process.argv[2] ?? "all";
const mode = modeArg.toLowerCase();
const rawInput = process.argv[3] ?? "";

main();

function main(): void {
  try {
    if (mode === "all") {
      const result = runAll(rawInput);
      printJson(result);
      return;
    }

    if (mode === "identify") {
      const identity = identifyPr(rawInput);
      printJson(identity);
      return;
    }

    if (mode === "fetch") {
      const identity = identifyPr(rawInput);
      const payload = fetchReviewContext(identity);
      printJson(payload);
      return;
    }

    if (mode === "normalize") {
      const stdin = readStdin();
      const normalized = normalizeFeedback(stdin);
      printJson(normalized);
      return;
    }

    if (mode === "match") {
      const stdin = readStdin();
      const matched = matchAddressed(stdin);
      printJson(matched);
      return;
    }

    fail("Invalid mode. Use one of: all, identify, fetch, normalize, match");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    fail(message);
  }
}

function runAll(input: string): Record<string, unknown> {
  const identity = identifyPr(input);
  const fetched = fetchReviewContext(identity);
  const normalized = normalizeFeedback(JSON.stringify(fetched));
  return matchAddressed(JSON.stringify(normalized));
}

function identifyPr(input: string): Identity {
  const parsed = parseInput(input);
  let identity = parsed;

  if (identity === null) {
    const pr = runJson(["gh", "pr", "view", "--json", "number,url"]);
    const prUrl = stringField(pr, "url");
    const fromBranch = parseGithubPullUrl(prUrl);
    if (fromBranch === null) {
      fail("Current branch is not associated with a GitHub PR");
    }
    identity = {
      ...fromBranch,
      source: "branch",
    };
  }

  const details = runJson([
    "gh",
    "pr",
    "view",
    String(identity.number),
    "--repo",
    `${identity.owner}/${identity.repo}`,
    "--json",
    "number,title,url",
  ]);

  const validatedNumber = numberField(details, "number");
  const validatedUrl = stringField(details, "url");
  const title = stringField(details, "title");

  return {
    ...identity,
    number: validatedNumber,
    url: validatedUrl,
    title,
  };
}

function parseInput(raw: string): Identity | null {
  let text = raw.trim();
  if (text.startsWith("resolve ")) {
    text = text.slice("resolve ".length).trim();
  }

  if (text === "") {
    return null;
  }

  const urlMatch = text.match(/https:\/\/github\.com\/[^\s]+/);
  if (urlMatch !== null) {
    const parsed = parseGithubPullUrl(urlMatch[0]);
    if (parsed !== null) {
      return parsed;
    }
  }

  if (/^\d+$/.test(text)) {
    const number = Number(text);
    const [owner, repo] = currentRepoOwnerAndName();
    return {
      owner,
      repo,
      number,
      reviewId: null,
      commentId: null,
      source: "number",
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    };
  }

  const inline = text.match(/\b(\d+)\b/);
  if (inline !== null) {
    const number = Number(inline[1]);
    const [owner, repo] = currentRepoOwnerAndName();
    return {
      owner,
      repo,
      number,
      reviewId: null,
      commentId: null,
      source: "text-number",
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    };
  }

  fail("Could not parse a PR URL or number from input");
}

function parseGithubPullUrl(value: string): Identity | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.hostname.toLowerCase() !== "github.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (match === null) {
    return null;
  }

  const owner = match[1];
  const repo = match[2];
  const number = Number(match[3]);

  let reviewId: number | null = null;
  let commentId: number | null = null;

  if (parsed.hash !== "") {
    const reviewMatch = parsed.hash.match(/pullrequestreview-(\d+)/);
    const commentMatch = parsed.hash.match(/discussion_r(\d+)/);
    if (reviewMatch !== null) {
      reviewId = Number(reviewMatch[1]);
    }
    if (commentMatch !== null) {
      commentId = Number(commentMatch[1]);
    }
  }

  return {
    owner,
    repo,
    number,
    reviewId,
    commentId,
    source: "url",
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
  };
}

function currentRepoOwnerAndName(): [string, string] {
  const repo = runJson(["gh", "repo", "view", "--json", "nameWithOwner"]);
  const ownerRepo = stringField(repo, "nameWithOwner");
  const parts = ownerRepo.split("/");
  if (parts.length !== 2) {
    fail("Could not infer owner/repo from current git remote");
  }
  return [parts[0], parts[1]];
}

function fetchReviewContext(identity: Identity): Record<string, unknown> {
  try {
    const threads = fetchGraphqlThreads(identity.owner, identity.repo, identity.number);
    const restComments = fetchRestPages(identity.owner, identity.repo, identity.number, "comments");
    const reviews = fetchRestPages(identity.owner, identity.repo, identity.number, "reviews");
    return {
      identity,
      transport: "graphql",
      reviews,
      reviewComments: restComments,
      reviewThreads: threads,
    };
  } catch (graphqlError) {
    const graphMessage = graphqlError instanceof Error ? graphqlError.message : "GraphQL fetch failed";
    try {
      const restComments = fetchRestPages(identity.owner, identity.repo, identity.number, "comments");
      const reviews = fetchRestPages(identity.owner, identity.repo, identity.number, "reviews");
      return {
        identity,
        transport: "rest-fallback",
        reviews,
        reviewComments: restComments,
        reviewThreads: [],
      };
    } catch (restError) {
      const restMessage = restError instanceof Error ? restError.message : "REST fallback failed";
      fail(`Failed to fetch review context: ${graphMessage}; REST fallback also failed: ${restMessage}`);
    }
  }
}

function fetchRestPages(owner: string, repo: string, number: number, resource: "comments" | "reviews"): unknown[] {
  const items: unknown[] = [];
  let page = 1;

  while (true) {
    const result = runJson([
      "gh",
      "api",
      `repos/${owner}/${repo}/pulls/${number}/${resource}`,
      "--method",
      "GET",
      "-f",
      "per_page=100",
      "-f",
      `page=${page}`,
    ]);

    if (Array.isArray(result) === false) {
      throw new Error(`expected array from pulls/${number}/${resource}`);
    }

    items.push(...result);
    if (result.length < 100) {
      break;
    }
    page += 1;
  }

  return items;
}

function fetchGraphqlThreads(owner: string, repo: string, number: number): unknown[] {
  const threads: unknown[] = [];
  let cursor: string | null = null;

  while (true) {
    const args = [
      "gh",
      "api",
      "graphql",
      "-f",
      `query=${GRAPHQL_QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ];

    if (cursor !== null && cursor !== "") {
      args.push("-F", `after=${cursor}`);
    }

    const payload = runJson(args);
    const pull = recordField(recordField(recordField(payload, "data"), "repository"), "pullRequest");
    const reviewThreads = recordField(pull, "reviewThreads");
    const nodes = arrayField(reviewThreads, "nodes");
    const pageInfo = recordField(reviewThreads, "pageInfo");
    const hasNextPage = booleanField(pageInfo, "hasNextPage");
    const endCursor = nullableStringField(pageInfo, "endCursor");

    threads.push(...nodes);

    if (hasNextPage === false) {
      break;
    }
    if (endCursor === null || endCursor === "") {
      break;
    }
    cursor = endCursor;
  }

  return threads;
}

function normalizeFeedback(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (text.startsWith("ERROR:")) {
    fail(text.slice("ERROR:".length).trimStart());
  }
  if (text === "") {
    fail("Empty review context");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON parse failure";
    fail(`Invalid review context JSON: ${message}`);
  }

  const root = ensureRecord(payload, "Review context must be an object");
  const identity = recordField(root, "identity");
  const reviewComments = optionalArrayField(root, "reviewComments");
  const reviewThreads = optionalArrayField(root, "reviewThreads");

  const targetReviewId = nullableNumberField(identity, "reviewId");
  const targetCommentId = nullableNumberField(identity, "commentId");

  const reviewIdByComment = new Map<number, number>();
  for (const item of reviewComments) {
    if (isRecord(item) === false) {
      continue;
    }
    const commentId = item.id;
    const reviewId = item.pull_request_review_id;
    if (typeof commentId === "number" && typeof reviewId === "number") {
      reviewIdByComment.set(commentId, reviewId);
    }
  }

  const normalizedThreads: NormalizedThread[] = [];

  for (const thread of reviewThreads) {
    const normalized = normalizeThread(thread, reviewIdByComment, targetReviewId, targetCommentId);
    if (normalized === null) {
      continue;
    }
    if (normalized.isResolved) {
      continue;
    }
    normalizedThreads.push(normalized);
  }

  const merged = mergeDuplicates(normalizedThreads);

  return {
    pr: {
      owner: nullableStringField(identity, "owner"),
      repo: nullableStringField(identity, "repo"),
      number: nullableNumberField(identity, "number"),
      url: nullableStringField(identity, "url"),
      title: nullableStringField(identity, "title"),
    },
    scope: {
      source: nullableStringField(identity, "source"),
      reviewId: nullableNumberField(identity, "reviewId"),
      commentId: nullableNumberField(identity, "commentId"),
    },
    transport: root.transport ?? null,
    threads: merged,
  };
}

function normalizeThread(
  value: unknown,
  reviewIdByComment: Map<number, number>,
  targetReviewId: number | null,
  targetCommentId: number | null,
): NormalizedThread | null {
  if (isRecord(value) === false) {
    return null;
  }

  const commentsContainer = ensureRecord(value.comments ?? {}, "thread comments missing");
  const comments = optionalArrayField(commentsContainer, "nodes");
  if (comments.length === 0) {
    return null;
  }

  const dbCommentIds: number[] = [];
  for (const item of comments) {
    if (isRecord(item) === false) {
      continue;
    }
    if (typeof item.databaseId === "number") {
      dbCommentIds.push(item.databaseId);
    }
  }

  if (targetCommentId !== null && dbCommentIds.includes(targetCommentId) === false) {
    return null;
  }

  if (targetReviewId !== null) {
    const hasReview = dbCommentIds.some((commentId) => reviewIdByComment.get(commentId) === targetReviewId);
    if (hasReview === false) {
      return null;
    }
  }

  const root = ensureRecord(comments[0], "thread root comment missing");

  const joined = comments
    .map((item) => {
      if (isRecord(item) === false) {
        return "";
      }
      const author = isRecord(item.author) ? item.author.login : null;
      const login = typeof author === "string" && author !== "" ? author : "unknown";
      const body = typeof item.body === "string" ? item.body : "";
      return `@${login}: ${body}`;
    })
    .join("\n\n")
    .trim();

  let actionableText = stripAgentNoise(joined);
  if (actionableText === "") {
    const rootBody = typeof root.body === "string" ? root.body : "";
    actionableText = stripAgentNoise(rootBody);
  }

  const path = typeof value.path === "string" && value.path !== "" ? value.path : "unknown";
  const line = typeof value.line === "number" ? value.line : null;
  const startLine = typeof value.startLine === "number" ? value.startLine : null;
  const lineRange = toRange(startLine, line);

  const authorLogins = comments
    .map((item) => {
      if (isRecord(item) === false || isRecord(item.author) === false) {
        return null;
      }
      const login = item.author.login;
      return typeof login === "string" && login !== "" ? login : null;
    })
    .filter((value): value is string => value !== null);

  return {
    threadId: typeof value.id === "string" ? value.id : null,
    commentId: typeof root.databaseId === "number" ? root.databaseId : null,
    path,
    line,
    startLine,
    lineRange,
    pathLine: `${path}:${lineRange}`,
    isResolved: Boolean(value.isResolved),
    isOutdated: Boolean(value.isOutdated),
    authorLogins,
    actionableText,
    severity: classifySeverity(actionableText),
  };
}

function mergeDuplicates(items: NormalizedThread[]): NormalizedThread[] {
  const groups = new Map<string, NormalizedThread[]>();

  for (const item of items) {
    const keyText = item.actionableText.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 180);
    const key = `${item.path}|${keyText}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, [item]);
      continue;
    }
    existing.push(item);
  }

  const merged: NormalizedThread[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    const first = group[0];
    const seen = new Set<string>();
    const authors: string[] = [];

    for (const thread of group) {
      for (const author of thread.authorLogins) {
        if (seen.has(author)) {
          continue;
        }
        seen.add(author);
        authors.push(author);
      }
    }

    merged.push({
      ...first,
      authorLogins: authors,
      corroboratedBy: authors,
    });
  }

  return merged;
}

function matchAddressed(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (text.startsWith("ERROR:")) {
    fail(text.slice("ERROR:".length).trimStart());
  }
  if (text === "") {
    fail("Empty normalized review input");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON parse failure";
    fail(`Invalid normalized review JSON: ${message}`);
  }

  const root = ensureRecord(payload, "Normalized payload must be an object");
  const rawThreads = optionalArrayField(root, "threads");
  const threads = rawThreads
    .map((item) => normalizeInputThread(item))
    .filter((item): item is NormalizedThread => item !== null);

  const nameStatus = parseNameStatus(runText(["git", "diff", "--name-status"]));
  const addedLines = parseAddedLines(runText(["git", "diff", "--unified=0", "--no-color"]));

  const proposedResolve: ProposedThread[] = [];
  const proposedIrrelevant: ProposedThread[] = [];
  const keepOpen: ProposedThread[] = [];

  for (const item of threads) {
    const pathStatus = nameStatus.get(item.path);

    if (item.isOutdated) {
      if (pathStatus !== undefined && pathStatus.code === "D") {
        const reason = "thread is outdated and file was deleted";
        proposedIrrelevant.push({
          ...item,
          reason,
          confidence: "high",
          resolutionNote: buildResolutionNote(item, reason),
        });
        continue;
      }

      if (pathStatus !== undefined && pathStatus.code.startsWith("R")) {
        const reason = `thread is outdated and file was renamed to ${pathStatus.newPath ?? "unknown"}`;
        proposedIrrelevant.push({
          ...item,
          reason,
          confidence: "medium",
          resolutionNote: buildResolutionNote(item, reason),
        });
        continue;
      }
    }

    const tokens = extractBacktickedTokens(item.actionableText);
    const additions = addedLines.get(item.path) ?? [];

    let tokenMatch = false;
    let nearMatch = false;

    if (tokens.length > 0 && additions.length > 0) {
      for (const [addedLineNumber, addedText] of additions) {
        if (item.line !== null && Math.abs(addedLineNumber - item.line) <= 80) {
          nearMatch = true;
        }

        for (const token of tokens) {
          if (addedText.includes(token)) {
            tokenMatch = true;
          }
        }

        if (tokenMatch && nearMatch) {
          break;
        }
      }
    }

    if (tokenMatch && nearMatch) {
      const reason = "matching symbol/token appears in nearby added lines";
      proposedResolve.push({
        ...item,
        reason,
        confidence: "medium",
        resolutionNote: buildResolutionNote(item, reason),
      });
      continue;
    }

    keepOpen.push({
      ...item,
      reason: "No strong evidence yet that requested behavior was addressed",
      confidence: "high",
    });
  }

  return {
    ...root,
    proposedResolve,
    proposedIrrelevant,
    keepOpen,
  };
}

function normalizeInputThread(value: unknown): NormalizedThread | null {
  if (isRecord(value) === false) {
    return null;
  }

  const line = typeof value.line === "number" ? value.line : null;
  const startLine = typeof value.startLine === "number" ? value.startLine : null;
  const lineRange = typeof value.lineRange === "string" ? value.lineRange : toRange(startLine, line);
  const path = typeof value.path === "string" && value.path !== "" ? value.path : "unknown";

  const authorLogins = Array.isArray(value.authorLogins)
    ? value.authorLogins.filter((item): item is string => typeof item === "string" && item !== "")
    : [];

  return {
    threadId: typeof value.threadId === "string" ? value.threadId : null,
    commentId: typeof value.commentId === "number" ? value.commentId : null,
    path,
    line,
    startLine,
    lineRange,
    pathLine: typeof value.pathLine === "string" ? value.pathLine : `${path}:${lineRange}`,
    isResolved: Boolean(value.isResolved),
    isOutdated: Boolean(value.isOutdated),
    authorLogins,
    actionableText: typeof value.actionableText === "string" ? value.actionableText : "",
    severity: normalizeSeverity(value.severity),
    corroboratedBy: Array.isArray(value.corroboratedBy)
      ? value.corroboratedBy.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

function normalizeSeverity(value: unknown): "request-changes" | "should-fix" | "nit" | "info" {
  if (value === "request-changes" || value === "should-fix" || value === "nit" || value === "info") {
    return value;
  }
  return "info";
}

function parseNameStatus(diff: string): Map<string, NameStatus> {
  const status = new Map<string, NameStatus>();
  for (const line of diff.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 2) {
      continue;
    }

    const code = parts[0];
    if (code.startsWith("R") && parts.length >= 3) {
      status.set(parts[1], { code: "R", newPath: parts[2] });
      continue;
    }

    status.set(parts[1], { code, newPath: null });
  }
  return status;
}

function parseAddedLines(diff: string): Map<string, Array<[number, string]>> {
  const files = new Map<string, Array<[number, string]>>();
  let currentFile: string | null = null;
  let currentLine = 0;

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.replace(/\n$/, "");

    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      if (files.has(currentFile) === false) {
        files.set(currentFile, []);
      }
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match === null) {
        currentLine = 0;
        continue;
      }
      currentLine = Number(match[1]);
      continue;
    }

    if (currentFile === null) {
      continue;
    }

    if (line.startsWith("+") && line.startsWith("+++") === false) {
      const entries = files.get(currentFile);
      if (entries !== undefined) {
        entries.push([currentLine, line.slice(1)]);
      }
      currentLine += 1;
      continue;
    }

    if (line.startsWith("-") && line.startsWith("---") === false) {
      continue;
    }

    currentLine += 1;
  }

  return files;
}

function extractBacktickedTokens(text: string): string[] {
  const matches = [...text.matchAll(/`([^`]+)`/g)];
  const set = new Set<string>();

  for (const match of matches) {
    const token = (match[1] ?? "").trim();
    if (token.length < 3) {
      continue;
    }
    if (token.includes(" ")) {
      continue;
    }
    set.add(token);
  }

  return [...set].sort();
}

function buildResolutionNote(item: NormalizedThread, reason: string): string {
  return `Addressed in local changes for \`${item.pathLine}\`. Reason: ${reason}. If this does not fully satisfy the request, reopen and I will follow up.`;
}

function stripAgentNoise(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let skip = false;

  for (const line of lines) {
    const lower = line.trim().toLowerCase();
    if (lower.startsWith("### analysis") || lower.startsWith("### tool output")) {
      skip = true;
      continue;
    }
    if (skip && lower.startsWith("### ")) {
      skip = false;
    }
    if (skip) {
      continue;
    }
    kept.push(line);
  }

  return kept.join("\n").trim();
}

function classifySeverity(text: string): "request-changes" | "should-fix" | "nit" | "info" {
  const lower = text.toLowerCase();
  if (lower.includes("must") || lower.includes("request changes") || lower.includes("blocking")) {
    return "request-changes";
  }
  if (lower.includes("should") || lower.includes("please") || lower.includes("fix")) {
    return "should-fix";
  }
  if (lower.includes("nit")) {
    return "nit";
  }
  return "info";
}

function toRange(startLine: number | null, line: number | null): string {
  if (line !== null && startLine !== null && startLine !== line) {
    return `${startLine}-${line}`;
  }
  if (line !== null) {
    return String(line);
  }
  if (startLine !== null) {
    return String(startLine);
  }
  return "unknown";
}

function runText(args: string[]): string {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    return "";
  }
  return result.stdout;
}

function runJson(args: string[]): unknown {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    const output = stderr !== "" ? stderr : stdout;
    throw new Error(output !== "" ? output : `command failed: ${args.join(" ")}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON parse failure";
    throw new Error(`invalid JSON from ${args.join(" ")}: ${message}`);
  }
}

function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(message: string): never {
  process.stdout.write(`ERROR: ${message}\n`);
  process.exit(0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function ensureRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  throw new Error(errorMessage);
}

function recordField(value: unknown, key: string): Record<string, unknown> {
  const root = ensureRecord(value, `missing object at ${key}`);
  return ensureRecord(root[key], `missing object field: ${key}`);
}

function arrayField(value: unknown, key: string): unknown[] {
  const root = ensureRecord(value, `missing object at ${key}`);
  const field = root[key];
  if (Array.isArray(field)) {
    return field;
  }
  throw new Error(`missing array field: ${key}`);
}

function optionalArrayField(value: unknown, key: string): unknown[] {
  if (isRecord(value) === false) {
    return [];
  }
  const field = value[key];
  if (Array.isArray(field)) {
    return field;
  }
  return [];
}

function stringField(value: unknown, key: string): string {
  const root = ensureRecord(value, `missing object at ${key}`);
  if (typeof root[key] === "string") {
    return root[key];
  }
  throw new Error(`missing string field: ${key}`);
}

function numberField(value: unknown, key: string): number {
  const root = ensureRecord(value, `missing object at ${key}`);
  if (typeof root[key] === "number") {
    return root[key];
  }
  throw new Error(`missing number field: ${key}`);
}

function booleanField(value: unknown, key: string): boolean {
  const root = ensureRecord(value, `missing object at ${key}`);
  if (typeof root[key] === "boolean") {
    return root[key];
  }
  throw new Error(`missing boolean field: ${key}`);
}

function nullableStringField(value: unknown, key: string): string | null {
  if (isRecord(value) === false) {
    return null;
  }
  const field = value[key];
  if (typeof field === "string") {
    return field;
  }
  return null;
}

function nullableNumberField(value: unknown, key: string): number | null {
  if (isRecord(value) === false) {
    return null;
  }
  const field = value[key];
  if (typeof field === "number") {
    return field;
  }
  return null;
}
