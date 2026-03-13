import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { P, match } from "ts-pattern";
import { DIFF_TRUNCATED_MARKER } from "./git";

const DEFAULT_SERVER_URL = "http://127.0.0.1:4096";
const COMMIT_AGENT_NAME = "commit";
const START_TIMEOUT_MS = 12000;
const SESSION_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const FILE_SUMMARY_MAX_FILES = 8;
const MAX_COMMIT_MESSAGE_LENGTH = 50;
const WORK_ITEM_PATTERNS = [/\bAB#(\d+)\b/iu, /\b#(\d+)\b/u, /(?:^|[\/_-])(\d{4,})(?=$|[\/_-])/u, /\b(\d{4,})\b/u];
const SUBJECT_FILLER_WORDS = new Set([
  "a",
  "an",
  "the",
  "for",
  "of",
  "to",
  "current",
  "existing",
  "staged",
]);
const SUBJECT_COMPRESSION_RULES: ReadonlyArray<readonly [string, string]> = [
  ["commit message", "message"],
  ["commit messages", "messages"],
  ["debug timings", "timings"],
  [" by file and hunk", " by file/hunk"],
  [" by file and hunks", " by file/hunks"],
];

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
    promptAsync?: (input: unknown) => Promise<unknown>;
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

function sdkError(message: string): GenerateError {
  return { kind: "sdk", message };
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isRecord(value) && Object.keys(value).length === 0;
}

function toGenerateError(error: unknown): GenerateError {
  if (isRecord(error) && isGenerateErrorKind(error.kind) && typeof error.message === "string") {
    const debug = typeof error.debug === "string" ? error.debug : undefined;
    if (error.kind === "parse" && typeof debug === "string") {
      return { kind: "parse", message: error.message, debug };
    }

    return { kind: error.kind, message: error.message };
  }

  return normalizeUnknownError(error, "sdk", "Unknown error");
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

      return err(sdkError(message));
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
          prompt: P.when((input) => typeof input === "function"),
        },
      },
      () => true,
    )
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

function shortenSubject(subject: string, maxChars: number): string {
  if (subject.length <= maxChars) {
    return subject;
  }

  let shortened = subject;
  for (const [from, to] of SUBJECT_COMPRESSION_RULES) {
    if (shortened.length <= maxChars) {
      break;
    }

    shortened = shortened.replaceAll(from, to);
  }

  if (shortened.length > maxChars) {
    const words = shortened.split(/\s+/u);
    const compactWords = words.filter((word) => SUBJECT_FILLER_WORDS.has(word) === false);
    const compact = compactWords.join(" ").trim();
    if (compact.length > 0) {
      shortened = compact;
    }
  }

  if (shortened.length > maxChars) {
    shortened = shortened.replaceAll(" and ", " & ");
  }

  if (shortened.length <= maxChars) {
    return cleanSubject(shortened);
  }

  const slice = shortened.slice(0, maxChars + 1);
  const boundary = slice.lastIndexOf(" ");
  const truncated = boundary > 0 ? slice.slice(0, boundary) : shortened.slice(0, maxChars);
  return cleanSubject(truncated.replace(/[\s/&:-]+$/u, ""));
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
  if (normalizedScope.length === 0) {
    return null;
  }

  const rawSubject = cleanSubject(subject.trim().toLowerCase());
  const maxSubjectChars = MAX_COMMIT_MESSAGE_LENGTH - `${normalizedType}(${normalizedScope}): `.length;
  if (maxSubjectChars <= 0) {
    return null;
  }

  const normalizedSubject = shortenSubject(rawSubject, maxSubjectChars);
  if (normalizedSubject.length === 0) {
    return null;
  }

  const message = `${normalizedType}(${normalizedScope}): ${normalizedSubject}`;
  return {
    type: normalizedType,
    scope: normalizedScope,
    subject: normalizedSubject,
    message,
    overLimit: message.length > MAX_COMMIT_MESSAGE_LENGTH,
  };
}

function extractWorkItemId(text: string): string | null {
  const input = text.trim();
  if (input.length === 0) {
    return null;
  }

  for (const pattern of WORK_ITEM_PATTERNS) {
    const matchResult = pattern.exec(input);
    const workItem = matchResult?.[1];
    if (typeof workItem === "string" && workItem.length > 0) {
      return workItem;
    }
  }

  return null;
}

function detectWorkItemScope(context: GitContext): string | null {
  const branchWorkItem = extractWorkItemId(context.branch);
  if (branchWorkItem !== null) {
    return `AB#${branchWorkItem}`;
  }

  const commitWorkItem = extractWorkItemId(context.previousCommit);
  if (commitWorkItem !== null) {
    return `AB#${commitWorkItem}`;
  }

  return null;
}

function enforceWorkItemScope(commit: GeneratedCommit, context: GitContext): GeneratedCommit {
  const detectedScope = detectWorkItemScope(context);
  if (detectedScope === null || commit.scope === detectedScope) {
    return commit;
  }

  const maxSubjectChars = MAX_COMMIT_MESSAGE_LENGTH - `${commit.type}(${detectedScope}): `.length;
  if (maxSubjectChars <= 0) {
    return commit;
  }

  const scopedSubject = shortenSubject(cleanSubject(commit.subject), maxSubjectChars);
  const message = `${commit.type}(${detectedScope}): ${scopedSubject}`;

  return {
    ...commit,
    scope: detectedScope,
    subject: scopedSubject,
    message,
    overLimit: message.length > MAX_COMMIT_MESSAGE_LENGTH,
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
    .with({ data: { message: { parts: P.array(P._) } } }, ({ data }) => data.message.parts as unknown[])
    .with({ message: { parts: P.array(P._) } }, ({ message }) => message.parts as unknown[])
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
      .with({ state: { output: P.string } }, ({ state }) => {
        texts.push(state.output);
      })
      .with({ state: { output: { text: P.string } } }, ({ state }) => {
        texts.push(state.output.text);
      })
      .otherwise(() => undefined);
  }

  return texts;
}

function extractStructuredOutput(value: unknown): unknown | null {
  return match(value)
    .with({ data: { info: { structured_output: P._ } } }, ({ data }) => data.info.structured_output)
    .with({ data: { info: { structuredOutput: P._ } } }, ({ data }) => data.info.structuredOutput)
    .with({ data: { info: { structured: P._ } } }, ({ data }) => data.info.structured)
    .with({ data: { structured: P._ } }, ({ data }) => data.structured)
    .with({ info: { structured_output: P._ } }, ({ info }) => info.structured_output)
    .with({ info: { structuredOutput: P._ } }, ({ info }) => info.structuredOutput)
    .with({ info: { structured: P._ } }, ({ info }) => info.structured)
    .with({ structured: P._ }, ({ structured }) => structured)
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
  const responseError = extractResponseError(value);
  if (responseError !== null) {
    return responseError;
  }

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

function extractResponseError(value: unknown): string | null {
  const message = match(value)
    .with({ data: { info: { error: { data: { message: P.string } } } } }, ({ data }) => data.info.error.data.message)
    .with({ info: { error: { data: { message: P.string } } } }, ({ info }) => info.error.data.message)
    .with({ data: { info: { error: { message: P.string } } } }, ({ data }) => data.info.error.message)
    .with({ info: { error: { message: P.string } } }, ({ info }) => info.error.message)
    .otherwise(() => "")
    .trim();

  return message.length > 0 ? message : null;
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

  if (hasSessionClient(started)) {
    return { client: started };
  }

  if (isRecord(started) && hasSessionClient(started.client)) {
    const cleanup = async (): Promise<void> => {
      const server = started.server;
      if (isRecord(server) === false) {
        return;
      }

      const close = server.close;
      if (typeof close === "function") {
        await close.call(server);
      }
    };

    return { client: started.client, cleanup };
  }

  throw { kind: "connection", message: "Failed to connect to OpenCode SDK" } as GenerateError;
}

function buildCommandArgs(context: GitContext): string {
  const detectedScope = detectWorkItemScope(context);
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
    detectedScope === null
      ? "scope: short module/area name (e.g. auth, cli, config), unless a ticket/reference number is present in branch/args"
      : `scope: MUST be exactly ${detectedScope} (ticket detected in branch/args)`,
    "If a ticket/reference number exists in branch/args (AB#1234, #1234, fix/1234-...), never use module/feature scope.",
    "Keep the full commit line <= 50 chars including type(scope): prefix.",
    "subject: imperative, lowercase, no period, usually 20-32 chars",
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
    agent: COMMIT_AGENT_NAME,
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

  let unwrapped = unwrapFieldsResponse(result);
  if (
    unwrapped.isOk() &&
    isEmptyObject(unwrapped.value) &&
    typeof client.session.promptAsync === "function"
  ) {
    await withTimeout(
      client.session.promptAsync({ path: { id: sessionId }, body: promptBody }),
      timeoutMs,
      "session.promptAsync",
    ).catch((error) => {
      throw normalizeUnknownError(error, "sdk", "Failed to execute session prompt_async");
    });

    const retried = await withTimeout(
      client.session.prompt({ path: { id: sessionId }, body: promptBody, responseStyle: "data" }),
      timeoutMs,
      "session.prompt.retry",
    ).catch((error) => {
      throw normalizeUnknownError(error, "sdk", "Failed to execute session prompt retry");
    });

    unwrapped = unwrapFieldsResponse(retried);
  }

  if (unwrapped.isErr()) {
    throw unwrapped.error;
  }

  if (isEmptyObject(unwrapped.value)) {
    throw sdkError("OpenCode returned an empty response for session.prompt");
  }

  const responseError = extractResponseError(unwrapped.value);
  if (responseError !== null) {
    throw sdkError(responseError);
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

    return enforceWorkItemScope(parsed.value, context);
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
