import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";
const CONNECT_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60000;

const COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
] as const;

type CommitType = (typeof COMMIT_TYPES)[number];

export type GitContext = {
  branch: string;
  previousCommit: string;
  stagedDiff: string;
};

export type GeneratedCommit = {
  type: CommitType;
  scope: string;
  subject: string;
  message: string;
  overLimit: boolean;
};

type GenerateOptions = {
  debug?: boolean;
};

type SessionClient = {
  session: {
    create: (input?: unknown) => Promise<unknown>;
    command: (input: unknown) => Promise<unknown>;
    delete?: (input: unknown) => Promise<unknown>;
  };
};

type ConnectedClient = {
  client: SessionClient;
  cleanup?: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function getCommandTimeoutMs(): number {
  const raw = process.env.AI_COMMIT_TIMEOUT_MS;
  if (typeof raw !== "string") {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 5000) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  return parsed;
}

function unwrapFieldsResponse(result: unknown): unknown {
  if (!isRecord(result)) {
    return result;
  }

  const hasData = Object.prototype.hasOwnProperty.call(result, "data");
  const hasError = Object.prototype.hasOwnProperty.call(result, "error");

  if (hasData || hasError) {
    const errorValue = (result as { error?: unknown }).error;
    if (errorValue !== undefined && errorValue !== null) {
      let message = "OpenCode command request failed";
      if (isRecord(errorValue) && typeof errorValue.name === "string") {
        message = errorValue.name;
        const data = (errorValue as { data?: unknown }).data;
        if (isRecord(data) && typeof data.message === "string" && data.message.length > 0) {
          message += `: ${data.message}`;
        }
      }
      throw new Error(message);
    }

    return (result as { data?: unknown }).data;
  }

  return result;
}

function hasSessionClient(value: unknown): value is SessionClient {
  if (!isRecord(value) || !isRecord(value.session)) {
    return false;
  }

  return (
    typeof value.session.create === "function" &&
    typeof value.session.command === "function"
  );
}

function extractSessionId(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const data = value.data;
  if (isRecord(data) && typeof data.id === "string" && data.id.length > 0) {
    return data.id;
  }

  if (typeof value.id === "string" && value.id.length > 0) {
    return value.id;
  }

  return null;
}

function parseModelRef(modelRef: string): { providerID: string; modelID: string } | null {
  const trimmed = modelRef.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) {
    return null;
  }

  const providerID = trimmed.slice(0, slash).trim();
  const modelID = trimmed.slice(slash + 1).trim();

  if (providerID.length === 0 || modelID.length === 0) {
    return null;
  }

  return { providerID, modelID };
}

function toCommitType(value: string): CommitType | null {
  for (const commitType of COMMIT_TYPES) {
    if (commitType === value) {
      return commitType;
    }
  }

  return null;
}

function cleanSubject(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith(".")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function normalizeCommit(type: string, scope: string, subject: string): GeneratedCommit | null {
  const normalizedType = toCommitType(type.trim().toLowerCase());
  if (normalizedType === null) {
    return null;
  }

  const normalizedScope = scope.trim();
  const normalizedSubject = cleanSubject(subject.trim().toLowerCase());
  if (normalizedScope.length === 0 || normalizedSubject.length === 0) {
    return null;
  }

  const message = `${normalizedType}(${normalizedScope}): ${normalizedSubject}`;
  return {
    type: normalizedType,
    scope: normalizedScope,
    subject: normalizedSubject,
    message,
    overLimit: message.length > 50,
  };
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, "").replace(/\s*```$/u, "").trim();
}

function tryParseJsonCommit(text: string): GeneratedCommit | null {
  const cleaned = stripCodeFence(text);

  const parseCandidate = (candidate: string): GeneratedCommit | null => {
    const parsed: unknown = JSON.parse(candidate);
    if (!isRecord(parsed)) {
      return null;
    }

    if (
      typeof parsed.type === "string" &&
      typeof parsed.scope === "string" &&
      typeof parsed.subject === "string"
    ) {
      return normalizeCommit(parsed.type, parsed.scope, parsed.subject);
    }

    return null;
  };

  try {
    const direct = parseCandidate(cleaned);
    if (direct !== null) {
      return direct;
    }
  } catch {
    const open = cleaned.indexOf("{");
    const close = cleaned.lastIndexOf("}");
    if (open >= 0 && close > open) {
      try {
        return parseCandidate(cleaned.slice(open, close + 1));
      } catch {
        return null;
      }
    }
    return null;
  }

  return null;
}

function extractTextParts(value: unknown): string[] {
  if (!isRecord(value)) {
    return [];
  }

  const data = isRecord(value.data) ? value.data : null;
  const parts = Array.isArray(data?.parts) ? data.parts : Array.isArray(value.parts) ? value.parts : [];
  const texts: string[] = [];

  for (const part of parts) {
    if (!isRecord(part)) {
      continue;
    }

    if (typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }

    const nestedPart = part.part;
    if (isRecord(nestedPart) && typeof nestedPart.text === "string") {
      texts.push(nestedPart.text);
    }
  }

  return texts;
}

function extractStructuredCommit(value: unknown): GeneratedCommit | null {
  if (!isRecord(value)) {
    return null;
  }

  const data = isRecord(value.data) ? value.data : null;
  const info = isRecord(data?.info) ? data.info : isRecord(value.info) ? value.info : null;
  if (!isRecord(info)) {
    return null;
  }

  const output = isRecord(info.structured_output)
    ? info.structured_output
    : isRecord(info.structuredOutput)
      ? info.structuredOutput
      : null;
  if (!isRecord(output)) {
    return null;
  }

  if (
    typeof output.type !== "string" ||
    typeof output.scope !== "string" ||
    typeof output.subject !== "string"
  ) {
    return null;
  }

  return normalizeCommit(output.type, output.scope, output.subject);
}

function extractCommitFromJsonText(value: unknown): GeneratedCommit | null {
  for (const text of extractTextParts(value)) {
    const parsed = tryParseJsonCommit(text);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractErrorDetail(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }

  const data = isRecord(value.data) ? value.data : null;
  const info = isRecord(data?.info) ? data.info : isRecord(value.info) ? value.info : null;
  if (isRecord(info) && isRecord(info.error) && typeof info.error.message === "string") {
    return info.error.message.trim();
  }

  const firstText = extractTextParts(value)[0];
  return typeof firstText === "string" ? firstText.replace(/\s+/gu, " ").trim().slice(0, 180) : "";
}

function debugSummary(value: unknown): string {
  if (!isRecord(value)) {
    const t = typeof value;
    if (value === null) {
      return "result is null";
    }
    if (value === undefined) {
      return "result is undefined";
    }
    if (t === "string") {
      const s = value as string;
      return `result is string (len=${s.length}): ${JSON.stringify(s.slice(0, 200))}`;
    }
    return `result is ${t}: ${JSON.stringify(value).slice(0, 200)}`;
  }

  const rootKeys = Object.keys(value).slice(0, 12);
  const data = isRecord(value.data) ? value.data : null;
  const dataKeys = data ? Object.keys(data).slice(0, 12) : [];
  const info = isRecord(data?.info) ? data.info : isRecord(value.info) ? value.info : null;
  const infoKeys = info ? Object.keys(info).slice(0, 12) : [];

  return [
    `rootKeys=${rootKeys.join(",") || "(none)"}`,
    `dataKeys=${dataKeys.join(",") || "(none)"}`,
    `infoKeys=${infoKeys.join(",") || "(none)"}`,
    `textParts=${extractTextParts(value).length}`,
  ].join("; ");
}

async function createSession(client: SessionClient): Promise<string> {
  const result = await withTimeout(client.session.create(), SESSION_TIMEOUT_MS, "session.create");
  const sessionId = extractSessionId(result);
  if (sessionId === null) {
    throw new Error("Failed to create OpenCode session");
  }
  return sessionId;
}

async function deleteSession(client: SessionClient, sessionId: string): Promise<void> {
  if (typeof client.session.delete !== "function") {
    return;
  }

  await withTimeout(
    client.session.delete({ path: { id: sessionId } }),
    SESSION_TIMEOUT_MS,
    "session.delete",
  ).catch(() => undefined);
}

async function canUseClient(client: SessionClient): Promise<boolean> {
  try {
    const sessionId = await withTimeout(createSession(client), CONNECT_TIMEOUT_MS, "server probe");
    await deleteSession(client, sessionId);
    return true;
  } catch {
    return false;
  }
}

async function connectClient(): Promise<ConnectedClient> {
  const useExisting = process.env.AI_COMMIT_USE_EXISTING_SERVER === "1";

  if (useExisting) {
    const existing = createOpencodeClient({
      baseUrl: DEFAULT_SERVER_URL,
    });

    if (hasSessionClient(existing) && (await canUseClient(existing))) {
      return { client: existing };
    }
  }

  const started = await withTimeout(
    createOpencode({ timeout: START_TIMEOUT_MS, port: 0 }),
    START_TIMEOUT_MS + 1000,
    "createOpencode",
  );

  if (hasSessionClient(started)) {
    return { client: started };
  }

  if (isRecord(started) && hasSessionClient(started.client)) {
    const maybeCleanup = started.server;
    const cleanup = async (): Promise<void> => {
      if (!isRecord(maybeCleanup)) {
        return;
      }

      const stop = maybeCleanup.stop;
      if (typeof stop === "function") {
        await stop.call(maybeCleanup);
      }
    };

    return { client: started.client, cleanup };
  }

  throw new Error("Failed to connect to OpenCode SDK");
}

function buildCommandArgs(context: GitContext): string {
  return [
    "Return ONLY valid JSON with keys type, scope, subject.",
    "No prose, no markdown, no code fences.",
    `Branch: ${context.branch}`,
    `Previous commit: ${context.previousCommit}`,
    "",
    "STAGED DIFF:",
    context.stagedDiff,
  ].join("\n");
}

async function runCommitCommand(
  client: SessionClient,
  sessionId: string,
  args: string,
  model: string | null,
  timeoutMs: number,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    command: "commit-msg",
    arguments: args,
    agent: "commit",
  };
  if (model !== null) body.model = model;

  const result = await withTimeout(
    client.session.command({ path: { id: sessionId }, body, responseStyle: "fields" }),
    timeoutMs,
    "session.command",
  );

  const unwrapped = unwrapFieldsResponse(result);

  if (typeof unwrapped === "string") {
    const parsed = tryParseJsonCommit(unwrapped);
    if (parsed !== null) {
      return { data: { info: { structured_output: parsed } }, parts: [{ text: unwrapped }] };
    }
  }

  return unwrapped;
}

export async function generateCommit(
  context: GitContext,
  modelRef: string,
  options: GenerateOptions = {},
): Promise<GeneratedCommit> {
  const connected = await connectClient();
  const commandTimeoutMs = getCommandTimeoutMs();
  const model = modelRef.trim().length > 0 ? modelRef.trim() : null;
  const commandArgs = buildCommandArgs(context);

  const sessionId = await createSession(connected.client);

  try {
    const result = await runCommitCommand(
      connected.client,
      sessionId,
      commandArgs,
      model,
      commandTimeoutMs,
    );

    if (typeof result === "string") {
      const parsed = tryParseJsonCommit(result);
      if (parsed !== null) {
        return parsed;
      }
    }

    const commit = extractStructuredCommit(result) ?? extractCommitFromJsonText(result);
    if (commit !== null) {
      return commit;
    }

    const detail = extractErrorDetail(result);
    const debug = options.debug === true
      ? (() => {
          let preview = "";
          try {
            preview = JSON.stringify(result).slice(0, 300);
          } catch {
            preview = String(result).slice(0, 300);
          }
          return ` [${debugSummary(result)}; typeof=${typeof result}; preview=${preview}]`;
        })()
      : "";
    if (detail.length > 0) {
      throw new Error(`OpenCode did not return a parseable commit (${detail})${debug}`);
    }
    throw new Error(`OpenCode did not return a parseable commit${debug}`);
  } finally {
    await deleteSession(connected.client, sessionId);

    if (typeof connected.cleanup === "function") {
      await connected.cleanup().catch(() => undefined);
    }
  }
}
