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

export interface PromptRequest {
  readonly context: null;
  readonly cwd: string;
  readonly editorPid: number;
  readonly launchId: string;
  readonly operation: PromptOperation;
  readonly ownerId: string;
  readonly requestId: string;
  readonly sequence: number;
  readonly sessionId: string;
  readonly text: string;
  readonly version: 1;
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
  | { readonly error: PromptFailureCode; readonly ok: false };

interface RequestRecord {
  acknowledgement?: PromptAcknowledgement;
  readonly fingerprint: string;
}

interface PromptDispatcherDependencies {
  readonly binding: () => PromptBinding | undefined;
  readonly blockingPromptActive: () => boolean;
  readonly context: () => ExtensionContext | undefined;
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
  request: PromptRequest,
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

export function parsePromptNotification(
  method: string,
  args: unknown,
): PromptNotificationResult | undefined {
  if (method !== PROMPT_NOTIFICATION) return undefined;
  if (Array.isArray(args) === false || args.length !== 1 || isRecord(args[0]) === false) {
    return { error: "PI_INVALID_REQUEST", ok: false };
  }
  const value = args[0];
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
    value.version !== 1 ||
    (value.operation !== "submit" && value.operation !== "append") ||
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
    (value.editorPid as number) < 1 ||
    typeof value.text !== "string" ||
    value.context !== null
  ) {
    return { error: "PI_INVALID_REQUEST", ok: false };
  }
  if (value.text.includes("\0")) {
    return { error: "PI_INVALID_REQUEST", ok: false };
  }
  if (hasValidUnicode(value.text) === false) {
    return { error: "PI_INVALID_UTF8", ok: false };
  }
  if (Buffer.byteLength(value.text, "utf8") > MAX_PROMPT_BYTES) {
    return { error: "PI_PROMPT_TOO_LARGE", ok: false };
  }
  if (value.operation === "submit" && value.text.trim() === "") {
    return { error: "PI_PROMPT_EMPTY", ok: false };
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_PROMPT_REQUEST_BYTES) {
    return { error: "PI_PROMPT_TOO_LARGE", ok: false };
  }

  return {
    ok: true,
    value: {
      context: null,
      cwd: value.cwd,
      editorPid: value.editorPid as number,
      launchId: value.launchId,
      operation: value.operation,
      ownerId: value.ownerId,
      requestId: value.requestId,
      sequence: value.sequence as number,
      sessionId: value.sessionId,
      text: value.text,
      version: 1,
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
  #expectedSequence = 1;
  #records = new Map<string, RequestRecord>();

  constructor(pi: ExtensionAPI, dependencies: PromptDispatcherDependencies) {
    this.#pi = pi;
    this.#dependencies = dependencies;
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

    const fingerprint = JSON.stringify(request);
    const existing = this.#records.get(request.requestId);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return acknowledgement(request, "rejected", state, "PI_REQUEST_ID_REUSED");
      }
      return existing.acknowledgement === undefined
        ? acknowledgement(request, "duplicate", state, "PI_REQUEST_PENDING")
        : { ...existing.acknowledgement, outcome: "duplicate" };
    }
    if (request.sequence < this.#expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_STALE_REQUEST");
    }
    if (request.sequence > this.#expectedSequence) {
      return acknowledgement(request, "rejected", state, "PI_REQUEST_OUT_OF_ORDER");
    }

    const record: RequestRecord = { fingerprint };
    this.#records.set(request.requestId, record);
    this.#expectedSequence += 1;
    const result =
      request.operation === "submit"
        ? submitPrompt(this.#pi, context, request.text, blocked)
        : appendPrompt(context, request.text);
    record.acknowledgement = result.ok
      ? acknowledgement(request, "accepted", state)
      : acknowledgement(request, "rejected", state, result.code);
    this.#trimRecords();
    return record.acknowledgement;
  }

  reset(): void {
    this.#expectedSequence = 1;
    this.#records = new Map();
  }

  #trimRecords(): void {
    while (this.#records.size > MAX_PROMPT_OUTCOMES) {
      const oldest = this.#records.keys().next().value;
      if (oldest === undefined) return;
      this.#records.delete(oldest);
    }
  }
}
