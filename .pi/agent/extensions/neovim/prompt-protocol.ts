import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { worktreesMatch } from "./contracts";
import { appendPrompt, submitPrompt } from "./prompt-dispatch";

export const PROMPT_NOTIFICATION = "pi:nvim-prompt/v1";
export const MAX_PROMPT_BYTES = 16 * 1024;
export const MAX_PROMPT_REQUEST_BYTES = 64 * 1024;
export const MAX_PROMPT_OUTCOMES = 64;

const launchIdPattern = /^[a-f0-9]{32}$/;
const sessionIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export type PromptOperation = "append" | "submit";
export type PromptState = "blocked" | "closed" | "idle" | "starting" | "streaming";
export type PromptFailureCode =
  | "PI_BUSY"
  | "PI_DISCONNECTED"
  | "PI_INVALID_REQUEST"
  | "PI_INVALID_UTF8"
  | "PI_LAUNCH_MISMATCH"
  | "PI_NO_UI"
  | "PI_PROMPT_EMPTY"
  | "PI_PROMPT_TOO_LARGE"
  | "PI_REQUEST_ID_REUSED"
  | "PI_REQUEST_OUT_OF_ORDER"
  | "PI_REQUEST_PENDING"
  | "PI_SESSION_MISMATCH"
  | "PI_SESSION_NOT_READY"
  | "PI_STALE_REQUEST"
  | "PI_UNSUPPORTED"
  | "PI_WORKTREE_MISMATCH";

export interface PromptBinding {
  readonly channelId: number;
  readonly cwd: string;
  readonly editorPid: number;
  readonly launchId: string;
  readonly ownerId: string;
  readonly sessionId: string;
  readonly version: 1;
}

export interface PromptRequestIdentity {
  readonly cwd: string;
  readonly editorPid: number;
  readonly launchId: string;
  readonly ownerId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly version: 1;
}

export interface PromptRequest extends PromptRequestIdentity {
  readonly context: null;
  readonly operation: PromptOperation;
  readonly text: string;
}

export interface PromptAcknowledgement {
  readonly code?: PromptFailureCode;
  readonly launchId: string;
  readonly outcome: "accepted" | "duplicate" | "rejected";
  readonly ownerId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly state: PromptState;
  readonly version: 1;
}

export type PromptNotificationResult =
  | { readonly ok: true; readonly value: PromptRequest }
  | {
      readonly error: PromptFailureCode;
      readonly identity?: PromptRequestIdentity;
      readonly ok: false;
    };

interface RequestRecord {
  acknowledgement?: PromptAcknowledgement;
  readonly fingerprint: string;
}

interface LaunchRequestState {
  expectedSequence: number;
  readonly records: Map<string, RequestRecord>;
}

export type PromptReplayState = Map<string, LaunchRequestState>;

interface PromptDispatcherDependencies {
  readonly binding: () => PromptBinding | undefined;
  readonly blockingPromptActive: () => boolean;
  readonly context: () => ExtensionContext | undefined;
  readonly replayState?: PromptReplayState;
}

const replayStateKey = "__piNvimPromptReplayV1";

function defaultReplayState(): PromptReplayState {
  const existing = Reflect.get(globalThis, replayStateKey);
  if (existing instanceof Map) return existing as PromptReplayState;
  const created: PromptReplayState = new Map();
  Reflect.set(globalThis, replayStateKey, created);
  return created;
}

export function createPromptReplayState(): PromptReplayState {
  return new Map();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key)) && keys.every((key) => key in value);
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.includes("\0") === false &&
    hasValidUnicode(value) &&
    Buffer.byteLength(value, "utf8") <= maxBytes
  );
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function promptState(context: ExtensionContext | undefined, blocked: boolean): PromptState {
  if (context === undefined) return "starting";
  if (blocked) return "blocked";
  return context.isIdle() ? "idle" : "streaming";
}

function acknowledgement(
  request: PromptRequestIdentity,
  outcome: PromptAcknowledgement["outcome"],
  state: PromptState,
  code?: PromptFailureCode,
): PromptAcknowledgement {
  return {
    ...(code === undefined ? {} : { code }),
    launchId: request.launchId,
    outcome,
    ownerId: request.ownerId,
    requestId: request.requestId,
    sessionId: request.sessionId,
    state,
    version: 1,
  };
}

function parseRequestIdentity(value: Record<string, unknown>): PromptRequestIdentity | undefined {
  if (
    value.version !== 1 ||
    typeof value.launchId !== "string" ||
    launchIdPattern.test(value.launchId) === false ||
    Number.isSafeInteger(value.sequence) === false ||
    (value.sequence as number) < 1 ||
    value.requestId !== `nvim:${value.launchId}:${value.sequence}` ||
    typeof value.sessionId !== "string" ||
    sessionIdPattern.test(value.sessionId) === false ||
    Buffer.byteLength(value.sessionId, "utf8") > 128 ||
    isBoundedText(value.ownerId, 128) === false ||
    isBoundedText(value.cwd, 4096) === false ||
    Number.isSafeInteger(value.editorPid) === false ||
    (value.editorPid as number) < 1
  ) {
    return undefined;
  }
  return {
    cwd: value.cwd,
    editorPid: value.editorPid as number,
    launchId: value.launchId,
    ownerId: value.ownerId,
    requestId: value.requestId,
    sequence: value.sequence as number,
    sessionId: value.sessionId,
    version: 1,
  };
}

function promptFailure(
  error: PromptFailureCode,
  identity?: PromptRequestIdentity,
): PromptNotificationResult {
  return { ...(identity === undefined ? {} : { identity }), error, ok: false };
}

export function parsePromptNotification(
  method: string,
  args: unknown,
): PromptNotificationResult | undefined {
  if (method !== PROMPT_NOTIFICATION) return undefined;
  if (Array.isArray(args) === false || args.length !== 1 || isRecord(args[0]) === false) {
    return promptFailure("PI_INVALID_REQUEST");
  }
  const value = args[0];
  const identity = parseRequestIdentity(value);
  if (
    hasOnlyKeys(value, [
      "version",
      "requestId",
      "sequence",
      "operation",
      "launchId",
      "sessionId",
      "ownerId",
      "cwd",
      "editorPid",
      "text",
      "context",
    ]) === false ||
    identity === undefined ||
    (value.operation !== "submit" && value.operation !== "append") ||
    typeof value.text !== "string" ||
    value.context !== null
  ) {
    return promptFailure("PI_INVALID_REQUEST", identity);
  }
  if (value.text.includes("\0")) {
    return promptFailure("PI_INVALID_REQUEST", identity);
  }
  if (hasValidUnicode(value.text) === false) {
    return promptFailure("PI_INVALID_UTF8", identity);
  }
  if (Buffer.byteLength(value.text, "utf8") > MAX_PROMPT_BYTES) {
    return promptFailure("PI_PROMPT_TOO_LARGE", identity);
  }
  if (value.operation === "submit" && value.text.trim() === "") {
    return promptFailure("PI_PROMPT_EMPTY", identity);
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PROMPT_REQUEST_BYTES) {
    return promptFailure("PI_PROMPT_TOO_LARGE", identity);
  }

  return {
    ok: true,
    value: {
      ...identity,
      context: null,
      operation: value.operation,
      text: value.text,
    },
  };
}

export function parsePromptBinding(
  value: unknown,
  expected: {
    readonly channelId: number;
    readonly cwd: string;
    readonly editorPid: number;
    readonly launchId: string;
    readonly sessionId: string;
  },
): PromptBinding | undefined {
  if (isRecord(value) === false) return undefined;
  if (
    hasOnlyKeys(value, [
      "version",
      "channelId",
      "cwd",
      "editorPid",
      "launchId",
      "ownerId",
      "sessionId",
    ]) === false ||
    value.version !== 1 ||
    value.channelId !== expected.channelId ||
    value.editorPid !== expected.editorPid ||
    value.launchId !== expected.launchId ||
    value.sessionId !== expected.sessionId ||
    isBoundedText(value.ownerId, 128) === false ||
    typeof value.cwd !== "string" ||
    worktreesMatch(value.cwd, expected.cwd) === false
  ) {
    return undefined;
  }
  return {
    channelId: value.channelId as number,
    cwd: value.cwd,
    editorPid: value.editorPid as number,
    launchId: value.launchId,
    ownerId: value.ownerId,
    sessionId: value.sessionId,
    version: 1,
  };
}

export class PromptRequestDispatcher {
  readonly #dependencies: PromptDispatcherDependencies;
  readonly #pi: ExtensionAPI;
  readonly #replayState: PromptReplayState;

  constructor(pi: ExtensionAPI, dependencies: PromptDispatcherDependencies) {
    this.#pi = pi;
    this.#dependencies = dependencies;
    this.#replayState = dependencies.replayState ?? defaultReplayState();
  }

  dispatch(request: PromptRequest): PromptAcknowledgement {
    const binding = this.#dependencies.binding();
    const context = this.#dependencies.context();
    const blocked = this.#dependencies.blockingPromptActive();
    const state = promptState(context, blocked);
    if (binding === undefined || context === undefined) {
      return acknowledgement(request, "rejected", state, "PI_SESSION_NOT_READY");
    }
    if (request.launchId !== binding.launchId) {
      return acknowledgement(request, "rejected", state, "PI_LAUNCH_MISMATCH");
    }
    if (
      request.sessionId !== binding.sessionId ||
      request.ownerId !== binding.ownerId ||
      request.editorPid !== binding.editorPid ||
      context.sessionManager.getSessionId() !== binding.sessionId
    ) {
      return acknowledgement(request, "rejected", state, "PI_SESSION_MISMATCH");
    }
    if (
      worktreesMatch(request.cwd, binding.cwd) === false ||
      worktreesMatch(context.cwd, binding.cwd) === false
    ) {
      return acknowledgement(request, "rejected", state, "PI_WORKTREE_MISMATCH");
    }

    const launchState = this.#launchState(request.launchId);
    const fingerprint = JSON.stringify(request);
    const existing = launchState.records.get(request.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return acknowledgement(request, "rejected", state, "PI_REQUEST_ID_REUSED");
      }
      return existing.acknowledgement === undefined
        ? acknowledgement(request, "duplicate", state, "PI_REQUEST_PENDING")
        : { ...existing.acknowledgement, outcome: "duplicate" };
    }
    if (request.sequence < launchState.expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_STALE_REQUEST");
    }
    if (request.sequence > launchState.expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_REQUEST_OUT_OF_ORDER");
    }

    const record: RequestRecord = { fingerprint };
    launchState.records.set(request.requestId, record);
    launchState.expectedSequence += 1;
    const result =
      request.operation === "submit"
        ? submitPrompt(this.#pi, context, request.text, blocked)
        : appendPrompt(context, request.text);
    record.acknowledgement = result.ok
      ? acknowledgement(request, "accepted", state)
      : acknowledgement(request, "rejected", state, result.code);
    this.#trimRecords(launchState);
    return record.acknowledgement;
  }

  rejectMalformed(request: PromptRequestIdentity, code: PromptFailureCode): PromptAcknowledgement {
    const binding = this.#dependencies.binding();
    const context = this.#dependencies.context();
    const blocked = this.#dependencies.blockingPromptActive();
    const state = promptState(context, blocked);
    if (binding === undefined || context === undefined) {
      return acknowledgement(request, "rejected", state, "PI_SESSION_NOT_READY");
    }
    if (request.launchId !== binding.launchId) {
      return acknowledgement(request, "rejected", state, "PI_LAUNCH_MISMATCH");
    }
    if (
      request.sessionId !== binding.sessionId ||
      request.ownerId !== binding.ownerId ||
      request.editorPid !== binding.editorPid ||
      context.sessionManager.getSessionId() !== binding.sessionId
    ) {
      return acknowledgement(request, "rejected", state, "PI_SESSION_MISMATCH");
    }
    if (
      worktreesMatch(request.cwd, binding.cwd) === false ||
      worktreesMatch(context.cwd, binding.cwd) === false
    ) {
      return acknowledgement(request, "rejected", state, "PI_WORKTREE_MISMATCH");
    }

    const launchState = this.#launchState(request.launchId);
    const fingerprint = `malformed:${code}`;
    const existing = launchState.records.get(request.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return acknowledgement(request, "rejected", state, "PI_REQUEST_ID_REUSED");
      }
      return existing.acknowledgement === undefined
        ? acknowledgement(request, "duplicate", state, "PI_REQUEST_PENDING")
        : { ...existing.acknowledgement, outcome: "duplicate" };
    }
    if (request.sequence < launchState.expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_STALE_REQUEST");
    }
    if (request.sequence > launchState.expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_REQUEST_OUT_OF_ORDER");
    }

    const rejected = acknowledgement(request, "rejected", state, code);
    launchState.records.set(request.requestId, { acknowledgement: rejected, fingerprint });
    launchState.expectedSequence += 1;
    this.#trimRecords(launchState);
    return rejected;
  }

  #launchState(launchId: string): LaunchRequestState {
    const existing = this.#replayState.get(launchId);
    if (existing !== undefined) return existing;
    const created: LaunchRequestState = { expectedSequence: 1, records: new Map() };
    this.#replayState.set(launchId, created);
    return created;
  }

  #trimRecords(state: LaunchRequestState): void {
    while (state.records.size > MAX_PROMPT_OUTCOMES) {
      const oldest = state.records.keys().next().value;
      if (oldest === undefined) return;
      state.records.delete(oldest);
    }
  }
}
