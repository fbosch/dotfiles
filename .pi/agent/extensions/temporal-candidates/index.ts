import type { Dirent } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  defineTool,
  type ExtensionAPI,
  getAgentDir,
  parseFrontmatter,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PROGRAMMATIC_READ_ONLY } from "../../lib/tool-exposure";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_REQUEST_TIMEOUT_MS = 10_000;
const MAX_MCP_RESPONSE_BYTES = 1_000_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
const MAX_OFFSET = 10_000;

interface JsonObject {
  [key: string]: unknown;
}

interface InboxFrontmatter extends Record<string, unknown> {
  shared_todo_id?: unknown;
  original_capture?: unknown;
}

export interface SharedTodoTask {
  id: string;
  text: string;
  checked: boolean;
}

export interface SharedTodoState {
  revision: number;
  tasks: SharedTodoTask[];
}

export type InboxMatchReason = "shared_todo_id" | "original_capture";

export interface FormalizedTask {
  id: string;
  text: string;
  inboxNotes: string[];
  matchedBy: InboxMatchReason[];
}

export interface TemporalCandidatesDetails {
  revision: number;
  inboxPath: string;
  inboxNotesScanned: number;
  checkedTasksFiltered: number;
  formalizedTasksFiltered: FormalizedTask[];
  candidates: SharedTodoTask[];
  totalCandidates: number;
  offset: number;
  limit: number;
  nextOffset?: number;
}

export interface TemporalCandidatesOptions {
  cwd: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
  mcpUrl?: string;
  fetchFn?: FetchFunction;
}

export type FetchFunction = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface InboxReferenceIndex {
  noteCount: number;
  bySharedTodoId: Map<string, Set<string>>;
  byOriginalCapture: Map<string, Set<string>>;
}

const TemporalCandidatesParameters = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: MAX_LIMIT,
        description: `Maximum number of unchecked unmatched tasks to return (default: ${DEFAULT_LIMIT}).`,
      }),
    ),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: MAX_OFFSET,
        description: "Number of filtered candidates to skip (default: 0).",
      }),
    ),
  },
  { additionalProperties: false },
);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Shared todo response has invalid ${field}`);
  }
  return value;
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return value.length === 0 ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  return [];
}

function addReference(map: Map<string, Set<string>>, value: string, notePath: string): void {
  const notes = map.get(value) ?? new Set<string>();
  notes.add(notePath);
  map.set(value, notes);
}

async function discoverMarkdownFiles(directory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read Inbox directory ${directory}: ${errorText(error)}`);
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function readInboxReferences(cwd: string): Promise<InboxReferenceIndex> {
  const root = resolve(cwd);
  const inboxPath = join(root, "Inbox");
  let canonicalRoot: string;
  let canonicalInbox: string;
  try {
    [canonicalRoot, canonicalInbox] = await Promise.all([realpath(root), realpath(inboxPath)]);
  } catch (error) {
    throw new Error(`Could not read Inbox directory ${inboxPath}: ${errorText(error)}`);
  }
  const relativeInbox = relative(canonicalRoot, canonicalInbox);
  if (relativeInbox === ".." || relativeInbox.startsWith(`..${sep}`) || isAbsolute(relativeInbox)) {
    throw new Error(`Inbox must remain inside the current project: ${inboxPath}`);
  }
  const notePaths = await discoverMarkdownFiles(canonicalInbox);
  const bySharedTodoId = new Map<string, Set<string>>();
  const byOriginalCapture = new Map<string, Set<string>>();

  for (const notePath of notePaths) {
    const relativeNotePath = relative(canonicalRoot, notePath);
    let parsed: ReturnType<typeof parseFrontmatter<InboxFrontmatter>>;
    try {
      parsed = parseFrontmatter<InboxFrontmatter>(await readFile(notePath, "utf8"));
    } catch (error) {
      throw new Error(`Could not parse Inbox note ${relativeNotePath}: ${errorText(error)}`);
    }

    for (const value of stringValues(parsed.frontmatter.shared_todo_id)) {
      addReference(bySharedTodoId, value, relativeNotePath);
    }
    for (const value of stringValues(parsed.frontmatter.original_capture)) {
      addReference(byOriginalCapture, value, relativeNotePath);
    }
  }

  return { noteCount: notePaths.length, bySharedTodoId, byOriginalCapture };
}

function parseSharedTodoTask(value: unknown, index: number): SharedTodoTask {
  if (!isRecord(value)) throw new Error(`Shared todo task ${index} is not an object`);
  return {
    id: nonEmptyString(value.id, `task ${index} id`),
    text: nonEmptyString(value.text, `task ${index} text`),
    checked: (() => {
      if (typeof value.checked !== "boolean") {
        throw new Error(`Shared todo task ${index} has invalid checked state`);
      }
      return value.checked;
    })(),
  };
}

export function parseSharedTodoState(value: unknown): SharedTodoState {
  if (!isRecord(value)) throw new Error("Shared todo response is not an object");
  const revision = value.revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Shared todo response has an invalid revision");
  }
  if (!Array.isArray(value.tasks)) throw new Error("Shared todo response has invalid tasks");

  const tasks = value.tasks.map(parseSharedTodoTask);
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
    throw new Error("Shared todo response contains duplicate task IDs");
  }
  return { revision, tasks };
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value)) throw new Error("Shared todo MCP response has no readable content");
  const text = value
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n\n");
  if (text.length === 0) throw new Error("Shared todo MCP response has no readable content");
  return text;
}

export function parseSharedTodoMcpResponse(value: unknown): SharedTodoState {
  if (!isRecord(value) || value.jsonrpc !== "2.0") {
    throw new Error("Shared todo MCP response is not a JSON-RPC response");
  }
  if (value.error !== undefined) {
    const error = isRecord(value.error) ? value.error.message : undefined;
    throw new Error(
      typeof error === "string" ? error : "Shared todo MCP request returned an error",
    );
  }
  if (!isRecord(value.result)) throw new Error("Shared todo MCP response has no result");
  if (value.result.isError === true) {
    throw new Error(textFromContent(value.result.content));
  }

  if (value.result.structuredContent !== undefined) {
    return parseSharedTodoState(value.result.structuredContent);
  }

  const text = textFromContent(value.result.content);
  try {
    return parseSharedTodoState(JSON.parse(text) as unknown);
  } catch (error) {
    throw new Error(`Could not parse shared todo MCP result: ${errorText(error)}`);
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Shared todo MCP response is too large");
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_MCP_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Shared todo MCP response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(MCP_REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export async function listSharedTodoTasks(
  url: string,
  options: { signal?: AbortSignal; fetchFn?: FetchFunction } = {},
): Promise<SharedTodoState> {
  const fetchFn = options.fetchFn ?? fetch;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_tasks", arguments: {} },
      }),
      redirect: "manual",
      signal: requestSignal(options.signal),
    });
  } catch (error) {
    throw new Error(`Could not reach shared todo MCP server: ${errorText(error)}`);
  }

  const body = await readBoundedResponse(response);
  if (!response.ok) {
    throw new Error(
      `Shared todo MCP server returned HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(`Could not parse shared todo MCP response: ${errorText(error)}`);
  }
  return parseSharedTodoMcpResponse(parsed);
}

export async function readSharedTodoMcpUrl(agentDirectory = getAgentDir()): Promise<string> {
  const configPath = join(agentDirectory, "mcp.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Could not read shared todo MCP configuration ${configPath}: ${errorText(error)}`,
    );
  }

  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) {
    throw new Error(`Shared todo MCP configuration is invalid: ${configPath}`);
  }
  const server = parsed.mcpServers["shared-todo"];
  if (!isRecord(server) || typeof server.url !== "string" || server.url.length === 0) {
    throw new Error(`Shared todo MCP URL is missing from ${configPath}`);
  }

  let url: URL;
  try {
    url = new URL(server.url);
  } catch (error) {
    throw new Error(`Shared todo MCP URL is invalid: ${errorText(error)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Shared todo MCP URL must use HTTP or HTTPS, got ${url.protocol}`);
  }
  return url.toString();
}

function limitValue(value: number | undefined): number {
  const limit = value ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function offsetValue(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new Error(`offset must be an integer between 0 and ${MAX_OFFSET}`);
  }
  return offset;
}

function formalizedTask(
  task: SharedTodoTask,
  references: InboxReferenceIndex,
): FormalizedTask | undefined {
  const inboxNotes = new Set<string>();
  const matchedBy = new Set<InboxMatchReason>();

  for (const note of references.bySharedTodoId.get(task.id) ?? []) {
    inboxNotes.add(note);
    matchedBy.add("shared_todo_id");
  }
  for (const note of references.byOriginalCapture.get(task.text) ?? []) {
    inboxNotes.add(note);
    matchedBy.add("original_capture");
  }

  if (inboxNotes.size === 0) return undefined;
  return {
    id: task.id,
    text: task.text,
    inboxNotes: [...inboxNotes].sort(),
    matchedBy: [...matchedBy].sort(),
  };
}

export async function collectTemporalCandidates(
  options: TemporalCandidatesOptions,
): Promise<TemporalCandidatesDetails> {
  const root = resolve(options.cwd);
  const limit = limitValue(options.limit);
  const offset = offsetValue(options.offset);
  const references = await readInboxReferences(root);
  const url = options.mcpUrl ?? (await readSharedTodoMcpUrl());
  const state = await listSharedTodoTasks(url, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
  });
  const formalizedByTask = state.tasks.map((task) => formalizedTask(task, references));
  const formalizedTasksFiltered = formalizedByTask.filter(
    (task): task is FormalizedTask => task !== undefined,
  );
  const unmatchedTasks = state.tasks.filter(
    (task, index) => task.checked === false && formalizedByTask[index] === undefined,
  );
  const candidates = unmatchedTasks.slice(offset, offset + limit);
  const nextOffset =
    offset + candidates.length < unmatchedTasks.length ? offset + candidates.length : undefined;

  return {
    revision: state.revision,
    inboxPath: relative(root, join(root, "Inbox")),
    inboxNotesScanned: references.noteCount,
    checkedTasksFiltered: state.tasks.filter((task) => task.checked).length,
    formalizedTasksFiltered,
    totalCandidates: unmatchedTasks.length,
    offset,
    limit,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    candidates,
  };
}

function displayTaskText(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

export function formatTemporalCandidates(details: TemporalCandidatesDetails): string {
  const formalizedCount = details.formalizedTasksFiltered.length;
  const lines = [
    `Shared todo revision: ${details.revision}`,
    `Inbox notes scanned: ${details.inboxNotesScanned}`,
    `Filtered ${details.checkedTasksFiltered} checked task(s) and ${formalizedCount} task(s) already represented in Inbox frontmatter.`,
    "",
    `Candidates (${details.candidates.length} returned, ${details.totalCandidates} total; offset ${details.offset}):`,
  ];
  if (details.candidates.length === 0) {
    lines.push("- None");
  } else {
    lines.push(...details.candidates.map((task) => `- ${task.id}: ${displayTaskText(task.text)}`));
  }
  if (details.nextOffset !== undefined) {
    lines.push(
      "",
      `More candidates remain. Call temporal_candidates with offset=${details.nextOffset}.`,
    );
  }
  return lines.join("\n");
}

export function createTemporalCandidatesTool(
  defaults: Pick<TemporalCandidatesOptions, "mcpUrl" | "fetchFn"> = {},
): ToolDefinition {
  return defineTool<typeof TemporalCandidatesParameters, TemporalCandidatesDetails>({
    ...PROGRAMMATIC_READ_ONLY,
    name: "temporal_candidates",
    label: "Temporal candidates",
    description:
      "List unchecked shared-todo tasks not already represented by shared_todo_id or original_capture in the current project's Inbox. Review the returned tasks for substance before selecting one.",
    promptSnippet: "Find shared-todo candidates not already formalized in Inbox",
    promptGuidelines: [
      "Use temporal_candidates before suggesting a shared-todo idea in the temporal-contract workflow.",
      "The tool filters checked tasks and exact Inbox frontmatter matches; still skip obvious execution tasks manually.",
      "If nextOffset is returned, request the next page before concluding there are no eligible ideas.",
    ],
    parameters: TemporalCandidatesParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const details = await collectTemporalCandidates({
        cwd: ctx.cwd,
        ...(params.limit === undefined ? {} : { limit: params.limit }),
        ...(params.offset === undefined ? {} : { offset: params.offset }),
        ...(signal === undefined ? {} : { signal }),
        ...(defaults.mcpUrl === undefined ? {} : { mcpUrl: defaults.mcpUrl }),
        ...(defaults.fetchFn === undefined ? {} : { fetchFn: defaults.fetchFn }),
      });
      return {
        content: [{ type: "text", text: formatTemporalCandidates(details) }],
        details,
      };
    },
  });
}

export default function temporalCandidatesExtension(pi: ExtensionAPI): void {
  pi.registerTool(createTemporalCandidatesTool());
}
