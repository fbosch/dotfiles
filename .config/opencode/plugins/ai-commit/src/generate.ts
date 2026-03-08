import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { P, match } from "ts-pattern";
import { DIFF_TRUNCATED_MARKER } from "./git";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";
const START_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const FILE_SUMMARY_MAX_FILES = 8;

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

const GENERATE_ERROR_KINDS = ["connection", "timeout", "session", "parse", "sdk"] as const;

type CommitType = (typeof COMMIT_TYPES)[number];
type GenerateErrorKind = (typeof GENERATE_ERROR_KINDS)[number];
type NonTimeoutGenerateErrorKind = Exclude<GenerateErrorKind, "timeout" | "parse">;

export type GitContext = {
  branch: string;
  previousCommit: string;
  stagedFiles: string[];
  stagedDiff: string;
};

export type GeneratedCommit = {
  type: CommitType;
  scope: string;
  subject: string;
  message: string;
  overLimit: boolean;
};

export type GenerateError =
  | { kind: "connection"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "session"; message: string }
  | { kind: "parse"; message: string; debug?: string }
  | { kind: "sdk"; message: string };

type GenerateOptions = {
  debug?: boolean;
};

type SessionClient = {
  session: {
    create: (input?: unknown) => Promise<unknown>;
    command: (input: unknown) => Promise<unknown>;
    prompt?: (input: unknown) => Promise<unknown>;
    delete?: (input: unknown) => Promise<unknown>;
  };
};

type ConnectedClient = {
  client: SessionClient;
  cleanup?: () => Promise<void>;
};

type PromptModelRef = {
  providerID: string;
  modelID: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getEnvVar(name: string): string | undefined {
  const globalObject = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return globalObject.process?.env?.[name];
}

function isGenerateErrorKind(value: unknown): value is GenerateErrorKind {
  return typeof value === "string" && (GENERATE_ERROR_KINDS as readonly string[]).includes(value);
}

function toErrorMessage(error: unknown, fallback: string): string {
  return match(error)
    .with(P.nullish, () => fallback)
    .with(P.instanceOf(Error), (value) => value.message)
    .with(P.string, (value) => value)
    .otherwise((value) => {
      try {
        const serialized = JSON.stringify(value);
        return typeof serialized === "string" ? serialized : fallback;
      } catch {
        return fallback;
      }
    });
}

function normalizeUnknownError(
  error: unknown,
  fallbackKind: NonTimeoutGenerateErrorKind,
  fallbackMessage: string,
): GenerateError {
  const message = toErrorMessage(error, fallbackMessage);
  if (message.includes("timed out")) {
    return { kind: "timeout", message };
  }
  return { kind: fallbackKind, message };
}

function toGenerateError(error: unknown): GenerateError {
  return match(error)
    .with({ kind: P.when(isGenerateErrorKind), message: P.string }, (value) => {
      const record = value as Record<string, unknown>;
      const debug = typeof record.debug === "string" ? record.debug : undefined;
      if (value.kind === "parse" && typeof debug === "string") {
        return { kind: "parse", message: value.message, debug };
      }
      return { kind: value.kind, message: value.message } as GenerateError;
    })
    .otherwise((value) => normalizeUnknownError(value, "sdk", "Unknown error"));
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

function startDebugTimer(options: GenerateOptions): number | null {
  return options.debug === true ? performance.now() : null;
}

function writeDebugTiming(label: string, startTime: number | null): void {
  if (startTime === null) {
    return;
  }

  const elapsedMs = performance.now() - startTime;
  console.error(`[ai-commit] ${label}: ${elapsedMs.toFixed(1)}ms`);
}

function getCommandTimeoutMs(): number {
  const raw = getEnvVar("AI_COMMIT_TIMEOUT_MS");
  if (typeof raw !== "string") {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 5000) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  return parsed;
}

function unwrapFieldsResponse(result: unknown): Result<unknown, GenerateError> {
  return match(result)
    .with({ error: P.when((value) => value !== undefined && value !== null) }, ({ error }) => {
      const message = match(error)
        .with({ errors: P.array(P._) }, (value) => {
          const first = value.errors[0];
          const detail = toErrorMessage(first, "");
          return detail.length > 0 ? `OpenCode command request failed: ${detail}` : "OpenCode command request failed";
        })
        .with({ data: P.when((value) => value !== undefined) }, (value) => {
          const detail = toErrorMessage(value.data, "");
          return detail.length > 0 ? `OpenCode command request failed: ${detail}` : "OpenCode command request failed";
        })
        .with({ data: { message: P.string } }, (value) => value.data.message)
        .with({ message: P.string }, (value) => value.message)
        .with({ name: P.string, data: { message: P.string } }, (value) => {
          if (value.data.message.length > 0) {
            return `${value.name}: ${value.data.message}`;
          }
          return value.name;
        })
        .with({ name: P.string }, (value) => value.name)
        .otherwise((value) => {
          const detail = toErrorMessage(value, "");
          return detail.length > 0 ? `OpenCode command request failed: ${detail}` : "OpenCode command request failed";
        });

      return err({ kind: "sdk", message });
    })
    .with({ data: P._ }, ({ data }) => ok(data))
    .otherwise(() => ok(result));
}

function hasSessionClient(value: unknown): value is SessionClient {
  return match(value)
    .with(
      {
        session: {
          create: P.when((input) => typeof input === "function"),
          command: P.when((input) => typeof input === "function"),
        },
      },
      () => true,
    )
    .otherwise(() => false);
}

function extractSessionId(value: unknown): string | null {
  const sessionId = match(value)
    .with({ data: { id: P.string } }, ({ data }) => data.id)
    .with({ id: P.string }, ({ id }) => id)
    .otherwise(() => "")
    .trim();

  return sessionId.length > 0 ? sessionId : null;
}

function toCommitType(value: string): CommitType | null {
  return (COMMIT_TYPES as readonly string[]).includes(value) ? (value as CommitType) : null;
}

function normalizeModelRef(modelRef: string): string | null {
  const trimmed = modelRef.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePromptModelRef(modelRef: string): PromptModelRef | null {
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

function cleanSubject(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith(".")) {
    return trimmed.slice(0, -1);
  }
  return trimmed;
}

function diagnoseCommitFields(type: string, scope: string, subject: string): string | null {
  if (toCommitType(type.trim().toLowerCase()) === null) {
    return `invalid type "${type.trim()}" (valid: ${COMMIT_TYPES.join(", ")})`;
  }
  if (scope.trim().length === 0) {
    return "empty scope";
  }
  if (cleanSubject(subject.trim().toLowerCase()).length === 0) {
    return "empty subject";
  }
  return null;
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

    return match(parsed)
      .with({ type: P.string, scope: P.string, subject: P.string }, (value) =>
        normalizeCommit(value.type, value.scope, value.subject)
      )
      .otherwise(() => null);
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
  const parts = match(value)
    .with({ data: { parts: P.array(P._) } }, ({ data }) => data.parts as unknown[])
    .with({ parts: P.array(P._) }, ({ parts }) => parts as unknown[])
    .otherwise((): unknown[] => []);

  const texts: string[] = [];
  for (const part of parts) {
    match(part)
      .with({ text: P.string }, ({ text }) => {
        texts.push(text);
      })
      .with({ part: { text: P.string } }, ({ part: nestedPart }) => {
        texts.push(nestedPart.text);
      })
      .otherwise(() => undefined);
  }

  return texts;
}

function extractStructuredOutput(value: unknown): unknown | null {
  return match(value)
    .with({ data: { info: { structured_output: P._ } } }, ({ data }) => data.info.structured_output)
    .with({ data: { info: { structuredOutput: P._ } } }, ({ data }) => data.info.structuredOutput)
    .with({ info: { structured_output: P._ } }, ({ info }) => info.structured_output)
    .with({ info: { structuredOutput: P._ } }, ({ info }) => info.structuredOutput)
    .otherwise(() => null);
}

function extractStructuredCommit(value: unknown): GeneratedCommit | null {
  const output = extractStructuredOutput(value);
  if (output === null) {
    return null;
  }

  return match(output)
    .with({ type: P.string, scope: P.string, subject: P.string }, (candidate) =>
      normalizeCommit(candidate.type, candidate.scope, candidate.subject)
    )
    .otherwise(() => null);
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
  const message = match(value)
    .with({ data: { info: { error: { message: P.string } } } }, ({ data }) => data.info.error.message.trim())
    .with({ info: { error: { message: P.string } } }, ({ info }) => info.error.message.trim())
    .otherwise(() => "");

  if (message.length > 0) {
    return message;
  }

  const firstText = extractTextParts(value)[0];
  return typeof firstText === "string" ? firstText.replace(/\s+/gu, " ").trim().slice(0, 180) : "";
}

function debugSummary(value: unknown): string {
  if (!isRecord(value)) {
    if (value === null) {
      return "result is null";
    }
    if (value === undefined) {
      return "result is undefined";
    }

    return match(value)
      .with(P.string, (text) => `result is string (len=${text.length}): ${JSON.stringify(text.slice(0, 200))}`)
      .otherwise((input) => {
        const serialized = JSON.stringify(input);
        const preview = typeof serialized === "string" ? serialized.slice(0, 200) : String(serialized);
        return `result is ${typeof input}: ${preview}`;
      });
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

function createParseError(result: unknown, options: GenerateOptions, detail?: string): GenerateError {
  const debug = options.debug === true
    ? (() => {
        let preview = "";
        try {
          const serialized = JSON.stringify(result);
          preview = typeof serialized === "string" ? serialized.slice(0, 300) : String(serialized);
        } catch {
          preview = String(result).slice(0, 300);
        }
        return `${debugSummary(result)}; typeof=${typeof result}; preview=${preview}`;
      })()
    : undefined;

  if (typeof detail === "string" && detail.length > 0) {
    return {
      kind: "parse",
      message: `OpenCode did not return a parseable commit (${detail})`,
      debug,
    };
  }

  return {
    kind: "parse",
    message: "OpenCode did not return a parseable commit",
    debug,
  };
}

function diagnoseRawFields(value: unknown): string | null {
  const candidate = match(value)
    .with({ type: P.string, scope: P.string, subject: P.string }, (v) => v)
    .otherwise(() => null);

  if (candidate === null) {
    return null;
  }

  return diagnoseCommitFields(candidate.type, candidate.scope, candidate.subject);
}

function diagnoseFromText(text: string): string | null {
  const cleaned = stripCodeFence(text);
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return diagnoseRawFields(parsed);
  } catch {
    const open = cleaned.indexOf("{");
    const close = cleaned.lastIndexOf("}");
    if (open >= 0 && close > open) {
      try {
        const parsed: unknown = JSON.parse(cleaned.slice(open, close + 1));
        return diagnoseRawFields(parsed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function diagnoseResult(result: unknown): string | null {
  const fromString = match(result)
    .with(P.string, (text) => diagnoseFromText(text))
    .otherwise(() => null);
  if (fromString !== null) {
    return fromString;
  }

  const fromStructured = match(extractStructuredOutput(result))
    .with(P.nullish, () => null)
    .otherwise((output) => diagnoseRawFields(output));
  if (fromStructured !== null) {
    return fromStructured;
  }

  for (const text of extractTextParts(result)) {
    const diagnosis = diagnoseFromText(text);
    if (diagnosis !== null) {
      return diagnosis;
    }
  }

  return null;
}

function parseGeneratedCommit(
  result: unknown,
  options: GenerateOptions,
): Result<GeneratedCommit, GenerateError> {
  const parsedFromString = match(result)
    .with(P.string, (text) => tryParseJsonCommit(text))
    .otherwise(() => null);
  if (parsedFromString !== null) {
    return ok(parsedFromString);
  }

  const parsed = match(result)
    .with(P.string, () => null)
    .otherwise((value) => extractStructuredCommit(value) ?? extractCommitFromJsonText(value));
  if (parsed !== null) {
    return ok(parsed);
  }

  const diagnosis = diagnoseResult(result);
  if (diagnosis !== null) {
    return err(createParseError(result, options, diagnosis));
  }

  const detail = match(result)
    .with(P.string, (value) => value.replace(/\s+/gu, " ").trim().slice(0, 180))
    .otherwise((value) => extractErrorDetail(value));

  return err(createParseError(result, options, detail));
}

async function createSession(client: SessionClient): Promise<string> {
  const result = await withTimeout(client.session.create(), SESSION_TIMEOUT_MS, "session.create").catch(
    (error) => {
      throw normalizeUnknownError(error, "session", "Failed to create OpenCode session");
    },
  );

  const sessionId = extractSessionId(result);
  if (sessionId === null) {
    throw { kind: "session", message: "Failed to create OpenCode session" } as GenerateError;
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

async function connectClient(): Promise<ConnectedClient> {
  const useExisting = getEnvVar("AI_COMMIT_USE_EXISTING_SERVER") !== "0";

  if (useExisting) {
    const existing = createOpencodeClient({
      baseUrl: DEFAULT_SERVER_URL,
      responseStyle: "data",
    });

    if (hasSessionClient(existing)) {
      return { client: existing };
    }
  }

  const started = await withTimeout(
    createOpencode({ timeout: START_TIMEOUT_MS, port: 0 }),
    START_TIMEOUT_MS + 1000,
    "createOpencode",
  ).catch((error) => {
    throw normalizeUnknownError(error, "connection", "Failed to start OpenCode SDK");
  });

  return match(started)
    .with(
      {
        session: {
          create: P.when((input) => typeof input === "function"),
          command: P.when((input) => typeof input === "function"),
        },
      },
      (client) => ({ client: client as SessionClient }),
    )
    .with(
      {
        client: {
          session: {
            create: P.when((input) => typeof input === "function"),
            command: P.when((input) => typeof input === "function"),
          },
        },
      },
      (value) => {
        const cleanup = async (): Promise<void> => {
          const root = value as Record<string, unknown>;
          const server = root.server;
          if (!isRecord(server)) {
            return;
          }

          const stop = server.stop;
          if (typeof stop === "function") {
            await stop.call(server);
          }
        };

        return { client: value.client as SessionClient, cleanup };
      },
    )
    .otherwise(() => {
      throw { kind: "connection", message: "Failed to connect to OpenCode SDK" } as GenerateError;
    });
}

function buildCommandArgs(context: GitContext): string {
  const details = [
    context.branch.length > 0 ? `Branch: ${context.branch}` : null,
    context.previousCommit.length > 0 ? `Previous commit: ${context.previousCommit}` : null,
  ].filter((value): value is string => value !== null);

  const isTruncated = context.stagedDiff.endsWith(DIFF_TRUNCATED_MARKER);
  const fileSummary = isTruncated ? summarizeStagedFiles(context.stagedFiles) : null;

  return [
    "You are a conventional commit message generator.",
    "Return ONLY a single valid JSON object with keys: type, scope, subject.",
    "No prose, no explanation, no markdown, no code fences, no tool calls.",
    "",
    `Valid types: ${COMMIT_TYPES.join(", ")}`,
    "scope: short module/area name (e.g. auth, cli, config)",
    "subject: imperative, lowercase, no period, max 50 chars",
    "",
    ...details,
    details.length > 0 ? "" : null,
    fileSummary,
    fileSummary === null ? null : "",
    "STAGED DIFF:",
    context.stagedDiff,
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
}

function summarizeStagedFiles(stagedFiles: string[]): string | null {
  if (stagedFiles.length === 0) {
    return null;
  }

  const visibleFiles = stagedFiles.slice(0, FILE_SUMMARY_MAX_FILES);
  const hiddenCount = stagedFiles.length - visibleFiles.length;
  const suffix = hiddenCount > 0 ? `, +${hiddenCount} more` : "";

  return `Files changed: ${visibleFiles.join(", ")}${suffix}`;
}

async function runCommitCommand(
  client: SessionClient,
  sessionId: string,
  args: string,
  model: string | null,
  timeoutMs: number,
): Promise<unknown> {
  if (typeof client.session.prompt !== "function") {
    throw {
      kind: "sdk",
      message: "OpenCode client does not support session.prompt",
    } satisfies GenerateError;
  }

  const promptBody: Record<string, unknown> = {
    parts: [{ type: "text", text: args }],
  };

  if (model !== null) {
    const parsedModel = parsePromptModelRef(model);
    if (parsedModel !== null && parsedModel.providerID !== "opencode") {
      promptBody.model = parsedModel;
    }
  }

  const result = await withTimeout(
    client.session.prompt({ path: { id: sessionId }, body: promptBody, responseStyle: "data" }),
    timeoutMs,
    "session.prompt",
  ).catch((error) => {
    throw normalizeUnknownError(error, "sdk", "Failed to execute session prompt");
  });

  const unwrapped = unwrapFieldsResponse(result);
  if (unwrapped.isErr()) {
    throw unwrapped.error;
  }

  return match(unwrapped.value)
    .with(P.string, (text) => {
      const parsed = tryParseJsonCommit(text);
      if (parsed !== null) {
        return {
          data: {
            info: {
              structured_output: parsed,
            },
          },
          parts: [{ text }],
        };
      }

      return text;
    })
    .otherwise((value) => value);
}

async function generateCommitValue(
  context: GitContext,
  modelRef: string,
  options: GenerateOptions,
): Promise<GeneratedCommit> {
  const totalStart = startDebugTimer(options);
  let connected: ConnectedClient | null = null;
  let sessionId: string | null = null;

  try {
    const connectStart = startDebugTimer(options);
    connected = await connectClient();
    writeDebugTiming("connectClient", connectStart);

    const commandTimeoutMs = getCommandTimeoutMs();
    const model = normalizeModelRef(modelRef);
    const commandArgs = buildCommandArgs(context);

    const createSessionStart = startDebugTimer(options);
    sessionId = await createSession(connected.client);
    writeDebugTiming("session.create", createSessionStart);

    const promptStart = startDebugTimer(options);
    const result = await runCommitCommand(
      connected.client,
      sessionId,
      commandArgs,
      model,
      commandTimeoutMs,
    );
    writeDebugTiming("session.prompt", promptStart);

    const parseStart = startDebugTimer(options);
    const parsed = parseGeneratedCommit(result, options);
    writeDebugTiming("parseGeneratedCommit", parseStart);
    if (parsed.isErr()) {
      throw parsed.error;
    }

    return parsed.value;
  } finally {
    if (connected !== null && sessionId !== null) {
      const deleteSessionStart = startDebugTimer(options);
      await deleteSession(connected.client, sessionId);
      writeDebugTiming("session.delete", deleteSessionStart);
    }

    if (connected !== null && typeof connected.cleanup === "function") {
      await connected.cleanup().catch(() => undefined);
    }

    writeDebugTiming("total", totalStart);
  }
}

export function generateCommit(
  context: GitContext,
  modelRef: string,
  options: GenerateOptions = {},
): ResultAsync<GeneratedCommit, GenerateError> {
  return ResultAsync.fromPromise(generateCommitValue(context, modelRef, options), toGenerateError);
}
