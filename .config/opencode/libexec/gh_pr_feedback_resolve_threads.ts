#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const callerCwd = process.env.OPENCODE_LIBEXEC_CWD;
if (callerCwd) {
  process.chdir(callerCwd);
}

type ThreadInput = {
  threadId: string;
  body: string;
};

type ThreadResult = {
  threadId: string;
  status: "commented+resolved" | "already resolved" | "comment failed" | "failed";
  commentId?: string;
  commentUrl?: string;
  error?: string;
};

type ExistingComment = {
  id: string;
  url: string;
};

const THREAD_STATE_QUERY = `
query($threadId: ID!) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      id
      isResolved
      comments(first: 100) {
        nodes {
          id
          url
          body
        }
      }
    }
  }
}
`;

const COMMENT_MUTATION = `
mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment {
      id
      url
    }
  }
}
`;

const RESOLVE_MUTATION = `
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}
`;

main();

function main(): void {
  try {
    const threads = parseInput(readStdin());
    const results = resolveThreads(threads);
    printJson({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    fail(message);
  }
}

function resolveThreads(threads: ThreadInput[]): ThreadResult[] {
  const results: ThreadResult[] = [];
  const seen = new Set<string>();

  for (const thread of threads) {
    if (seen.has(thread.threadId)) {
      results.push({
        threadId: thread.threadId,
        status: "failed",
        error: "duplicate threadId in input",
      });
      continue;
    }
    seen.add(thread.threadId);

    results.push(resolveThread(thread));
  }

  return results;
}

function resolveThread(thread: ThreadInput): ThreadResult {
  const state = getThreadState(thread.threadId, thread.body);
  if (state.ok === false) {
    return {
      threadId: thread.threadId,
      status: "failed",
      error: state.error,
    };
  }

  if (state.isResolved) {
    return {
      threadId: thread.threadId,
      status: "already resolved",
    };
  }

  if (state.existingComment !== null) {
    const resolved = resolveReviewThread(thread.threadId);
    if (resolved.ok === false) {
      return {
        threadId: thread.threadId,
        status: "failed",
        commentId: state.existingComment.id,
        commentUrl: state.existingComment.url,
        error: resolved.error,
      };
    }

    return {
      threadId: thread.threadId,
      status: "commented+resolved",
      commentId: state.existingComment.id,
      commentUrl: state.existingComment.url,
    };
  }

  const comment = addThreadReply(thread.threadId, thread.body);
  if (comment.ok === false) {
    return {
      threadId: thread.threadId,
      status: "comment failed",
      error: comment.error,
    };
  }

  const resolved = resolveReviewThread(thread.threadId);
  if (resolved.ok === false) {
    return {
      threadId: thread.threadId,
      status: "failed",
      commentId: comment.commentId,
      commentUrl: comment.commentUrl,
      error: resolved.error,
    };
  }

  return {
    threadId: thread.threadId,
    status: "commented+resolved",
    commentId: comment.commentId,
    commentUrl: comment.commentUrl,
  };
}

function getThreadState(
  threadId: string,
  body: string,
): { ok: true; isResolved: boolean; existingComment: ExistingComment | null } | { ok: false; error: string } {
  const payload = runGraphql(THREAD_STATE_QUERY, { threadId });
  if (payload.ok === false) {
    return payload;
  }

  try {
    const node = recordField(recordField(payload.value, "data"), "node");
    return {
      ok: true,
      isResolved: booleanField(node, "isResolved"),
      existingComment: findExistingComment(node, body),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid thread state response";
    return { ok: false, error: message };
  }
}

function findExistingComment(thread: Record<string, unknown>, body: string): ExistingComment | null {
  const comments = recordField(thread, "comments");
  const nodes = arrayField(comments, "nodes");

  for (const item of nodes) {
    if (isRecord(item) === false) {
      continue;
    }
    if (stringField(item, "body") !== body) {
      continue;
    }
    return {
      id: stringField(item, "id"),
      url: stringField(item, "url"),
    };
  }

  return null;
}

function addThreadReply(
  threadId: string,
  body: string,
): { ok: true; commentId: string; commentUrl: string } | { ok: false; error: string } {
  const payload = runGraphql(COMMENT_MUTATION, { threadId, body });
  if (payload.ok === false) {
    return payload;
  }

  try {
    const comment = recordField(recordField(recordField(payload.value, "data"), "addPullRequestReviewThreadReply"), "comment");
    return {
      ok: true,
      commentId: stringField(comment, "id"),
      commentUrl: stringField(comment, "url"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid comment response";
    return { ok: false, error: message };
  }
}

function resolveReviewThread(threadId: string): { ok: true } | { ok: false; error: string } {
  const payload = runGraphql(RESOLVE_MUTATION, { threadId });
  if (payload.ok === false) {
    return payload;
  }

  try {
    const thread = recordField(recordField(recordField(payload.value, "data"), "resolveReviewThread"), "thread");
    if (booleanField(thread, "isResolved") === false) {
      return { ok: false, error: "GitHub returned unresolved thread after resolve mutation" };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid resolve response";
    return { ok: false, error: message };
  }
}

function runGraphql(query: string, fields: Record<string, string>): { ok: true; value: unknown } | { ok: false; error: string } {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "body") {
      args.push("-f", `${key}=${value}`);
      continue;
    }
    args.push("-F", `${key}=${value}`);
  }

  const result = spawnSync("gh", args, { encoding: "utf8" });
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    return { ok: false, error: stderr !== "" ? stderr : stdout || `gh ${args.join(" ")} failed` };
  }

  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON parse failure";
    return { ok: false, error: `invalid JSON from gh api graphql: ${message}` };
  }
}

function parseInput(raw: string): ThreadInput[] {
  const text = raw.trim();
  if (text === "") {
    throw new Error("Expected JSON input with threads");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON parse failure";
    throw new Error(`Invalid JSON input: ${message}`);
  }

  const root = ensureRecord(payload, "Input must be an object");
  const rawThreads = arrayField(root, "threads");
  const threads = rawThreads.map((item, index) => normalizeThreadInput(item, index));
  if (threads.length === 0) {
    throw new Error("At least one thread is required");
  }
  return threads;
}

function normalizeThreadInput(value: unknown, index: number): ThreadInput {
  const item = ensureRecord(value, `threads[${index}] must be an object`);
  const threadId = stringField(item, "threadId").trim();
  const body = stringField(item, "body").trim();

  if (threadId === "") {
    throw new Error(`threads[${index}].threadId must not be empty`);
  }
  if (body === "") {
    throw new Error(`threads[${index}].body must not be empty`);
  }

  return { threadId, body };
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
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
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

function stringField(value: unknown, key: string): string {
  const root = ensureRecord(value, `missing object at ${key}`);
  if (typeof root[key] === "string") {
    return root[key];
  }
  throw new Error(`missing string field: ${key}`);
}

function booleanField(value: unknown, key: string): boolean {
  const root = ensureRecord(value, `missing object at ${key}`);
  if (typeof root[key] === "boolean") {
    return root[key];
  }
  throw new Error(`missing boolean field: ${key}`);
}
