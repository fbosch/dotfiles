import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";
const CONNECT_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_PROMPT_TIMEOUT_MS = 60000;
const JSON_OUTPUT_CONTRACT =
  'Return ONLY valid JSON: {"type":"<type>","scope":"<scope>","subject":"<subject>"}. No prose, no markdown, no code fences.';

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
    prompt: (input: unknown) => Promise<unknown>;
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

function getPromptTimeoutMs(): number {
  const raw = process.env.AI_COMMIT_TIMEOUT_MS;
  if (typeof raw !== "string") {
    return DEFAULT_PROMPT_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 5000) {
    return DEFAULT_PROMPT_TIMEOUT_MS;
  }

  return parsed;
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

function hasSessionClient(value: unknown): value is SessionClient {
  if (!isRecord(value) || !isRecord(value.session)) {
    return false;
  }

  return (
    typeof value.session.create === "function" &&
    typeof value.session.prompt === "function"
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

  const type = output.type;
  const scope = output.scope;
  const subject = output.subject;

  if (typeof type !== "string" || typeof scope !== "string" || typeof subject !== "string") {
    return null;
  }

  return normalizeCommit(type, scope, subject);
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/u, "").replace(/\s*```$/u, "").trim();
}

function tryParseJsonCommit(text: string): GeneratedCommit | null {
  const cleaned = stripCodeFence(text);

  const tryParse = (candidate: string): GeneratedCommit | null => {
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
    const direct = tryParse(cleaned);
    if (direct !== null) {
      return direct;
    }
  } catch {
    const open = cleaned.indexOf("{");
    const close = cleaned.lastIndexOf("}");
    if (open >= 0 && close > open) {
      const candidate = cleaned.slice(open, close + 1);
      try {
        return tryParse(candidate);
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

function extractCommitFromJsonText(value: unknown): GeneratedCommit | null {
  for (const text of extractTextParts(value)) {
    const fromJson = tryParseJsonCommit(text);
    if (fromJson !== null) {
      return fromJson;
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

  if (isRecord(info) && isRecord(info.error)) {
    const message = info.error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim();
    }
  }

  const firstText = extractTextParts(value)[0];
  if (typeof firstText === "string" && firstText.trim().length > 0) {
    const normalized = firstText.replace(/\s+/gu, " ").trim();
    return normalized.slice(0, 160);
  }

  return "";
}

function debugSummary(value: unknown): string {
  if (!isRecord(value)) {
    return "result is not an object";
  }

  const rootKeys = Object.keys(value).slice(0, 12);
  const data = isRecord(value.data) ? value.data : null;
  const dataKeys = data ? Object.keys(data).slice(0, 12) : [];
  const info = isRecord(data?.info) ? data.info : isRecord(value.info) ? value.info : null;
  const infoKeys = info ? Object.keys(info).slice(0, 12) : [];
  const parts = extractTextParts(value);

  return [
    `rootKeys=${rootKeys.join(",") || "(none)"}`,
    `dataKeys=${dataKeys.join(",") || "(none)"}`,
    `infoKeys=${infoKeys.join(",") || "(none)"}`,
    `textParts=${parts.length}`,
  ].join("; ");
}

function buildPrompt(context: GitContext): string {
  return [
    "You generate conventional commit metadata from staged git changes.",
    "",
    "Output must match this intent:",
    "- type: one of feat|fix|docs|style|refactor|perf|test|build|ci|chore",
    "- scope: AB#<n> if a ticket appears in branch name, else module/feature name",
    "- subject: imperative mood, lowercase, no trailing period, describe substance not style",
    "- keep the final message under 50 chars whenever possible",
    "- abbreviate aggressively: authentication->auth, implement->add, function->fn",
    "",
    "If only lock/generated files are staged, output:",
    "type=chore, scope=deps, subject=update lock file",
    "",
    `Branch: ${context.branch}`,
    `Previous commit: ${context.previousCommit}`,
    "",
    "STAGED DIFF:",
    context.stagedDiff,
  ].join("\n");
}

async function createSession(client: SessionClient): Promise<string> {
  const result = await withTimeout(client.session.create(), SESSION_TIMEOUT_MS, "session.create");
  const sessionId = extractSessionId(result);
  if (sessionId === null) {
    throw new Error("Failed to create OpenCode session");
  }
  return sessionId;
}

async function canUseClient(client: SessionClient): Promise<boolean> {
  try {
    const sessionId = await withTimeout(createSession(client), CONNECT_TIMEOUT_MS, "server probe");

    if (typeof client.session.delete === "function") {
      await withTimeout(
        client.session.delete({ path: { id: sessionId } }),
        CONNECT_TIMEOUT_MS,
        "session.delete",
      );
    }

    return true;
  } catch {
    return false;
  }
}

async function connectClient(): Promise<ConnectedClient> {
  const existing = createOpencodeClient({
    baseUrl: DEFAULT_SERVER_URL,
    responseStyle: "data",
  });

  if (hasSessionClient(existing) && (await canUseClient(existing))) {
    return { client: existing };
  }

  const started = await withTimeout(
    createOpencode({ timeout: START_TIMEOUT_MS }),
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

    return {
      client: started.client,
      cleanup,
    };
  }

  throw new Error("Failed to connect to OpenCode SDK");
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

async function runPromptWithBody(
  client: SessionClient,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const sessionId = await createSession(client);

  try {
    return await withTimeout(
      client.session.prompt({
        path: { id: sessionId },
        body,
      }),
      timeoutMs,
      "session.prompt",
    );
  } finally {
    await deleteSession(client, sessionId);
  }
}

function buildStructuredBody(prompt: string, model: { providerID: string; modelID: string } | null) {
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: `${JSON_OUTPUT_CONTRACT}\n\n${prompt}` }],
    agent: "commit",
    system: `${JSON_OUTPUT_CONTRACT} Ignore any prior context not present in the current message.`,
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [...COMMIT_TYPES],
          },
          scope: {
            type: "string",
            description: "AB#<n> if ticket in branch, else module/feature",
          },
          subject: {
            type: "string",
            description:
              "Imperative lowercase subject; no period; concise and specific; short enough for total message length <= 50",
          },
        },
        required: ["type", "scope", "subject"],
      },
      retryCount: 2,
    },
    outputFormat: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: [...COMMIT_TYPES],
          },
          scope: {
            type: "string",
            description: "AB#<n> if ticket in branch, else module/feature",
          },
          subject: {
            type: "string",
            description:
              "Imperative lowercase subject; no period; concise and specific; short enough for total message length <= 50",
          },
        },
        required: ["type", "scope", "subject"],
      },
      retryCount: 2,
    },
  };

  if (model !== null) {
    body.model = model;
  }

  return body;
}

export async function generateCommit(
  context: GitContext,
  modelRef: string,
  options: GenerateOptions = {},
): Promise<GeneratedCommit> {
  const connected = await connectClient();
  const promptTimeoutMs = getPromptTimeoutMs();

  try {
    const prompt = buildPrompt(context);
    const model = parseModelRef(modelRef);

    const structuredResult = await runPromptWithBody(
      connected.client,
      buildStructuredBody(prompt, model),
      promptTimeoutMs,
    );

    const commit = extractStructuredCommit(structuredResult) ?? extractCommitFromJsonText(structuredResult);
    if (commit !== null) {
      return commit;
    }

    const detail = extractErrorDetail(structuredResult);
    const debug = options.debug === true ? ` [${debugSummary(structuredResult)}]` : "";
    if (detail.length > 0) {
      throw new Error(`OpenCode did not return a parseable commit (${detail})${debug}`);
    }
    throw new Error(`OpenCode did not return a parseable commit${debug}`);
  } finally {
    if (typeof connected.cleanup === "function") {
      await connected.cleanup().catch(() => undefined);
    }
  }
}
