import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../shared/is-record";

export interface RoutingAccount {
  provider: "openai-codex" | "anthropic" | "claude-bridge";
  profile: string;
  remaining: number;
  observedAt: number;
  staleAt: number;
}
const REQUEST = "auth-profiles:routing-request/v1";
const REPLY = "auth-profiles:routing-reply/v1";
const TIMEOUT_MS = 30_000;
type Action = { action: "list" } | { action: "activate"; account: RoutingAccount };

export function isRoutingAccount(value: unknown): value is RoutingAccount {
  return (
    isRecord(value) &&
    ["openai-codex", "anthropic", "claude-bridge"].includes(String(value.provider)) &&
    typeof value.profile === "string" &&
    /^[A-Za-z0-9._-]+$/u.test(value.profile) &&
    typeof value.remaining === "number" &&
    Number.isFinite(value.remaining) &&
    value.remaining > 0 &&
    value.remaining <= 100 &&
    typeof value.observedAt === "number" &&
    Number.isFinite(value.observedAt) &&
    typeof value.staleAt === "number" &&
    Number.isFinite(value.staleAt) &&
    value.staleAt > value.observedAt
  );
}

async function call(
  events: ExtensionAPI["events"],
  action: Action,
  signal?: AbortSignal,
): Promise<readonly RoutingAccount[]> {
  signal?.throwIfAborted();
  const id = randomUUID();
  const controller = new AbortController();
  const operation = new Promise<readonly RoutingAccount[]>((resolve, reject) => {
    let accepted = false;
    let settled = false;
    const finish = (error?: Error, accounts: readonly RoutingAccount[] = []) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      controller.abort();
      if (error) reject(error);
      else resolve(accounts);
    };
    const onAbort = () =>
      finish(
        signal?.reason instanceof Error ? signal.reason : new Error("Routing request aborted"),
      );
    const unsubscribe = events.on(REPLY, (value) => {
      if (!isRecord(value) || value.id !== id) return;
      if (value.kind === "accepted") {
        accepted = true;
        return;
      }
      if (value.kind !== "result") return;
      if (typeof value.error === "string") {
        finish(new Error(value.error));
        return;
      }
      if (action.action === "list") {
        if (!Array.isArray(value.accounts) || !value.accounts.every(isRoutingAccount)) {
          finish(new Error("Auth routing returned invalid accounts"));
          return;
        }
        finish(undefined, value.accounts);
      } else finish();
    });
    const timer = setTimeout(() => finish(new Error("Auth routing service timed out")), TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    events.emit(REQUEST, { ...action, id, signal: controller.signal });
    // A session-local service acknowledges before starting asynchronous work.
    queueMicrotask(() => {
      if (!accepted) finish(new Error("Auth routing service is unavailable"));
    });
  });
  return operation;
}

export function requestRoutingAccounts(
  events: ExtensionAPI["events"],
  signal?: AbortSignal,
): Promise<readonly RoutingAccount[]> {
  return call(events, { action: "list" }, signal);
}
export async function activateRoutingAccount(
  events: ExtensionAPI["events"],
  account: RoutingAccount,
  signal?: AbortSignal,
): Promise<void> {
  if (!isRoutingAccount(account)) throw new Error("Invalid routing account");
  await call(events, { action: "activate", account }, signal);
}

export function installRoutingEligibilityService(
  events: ExtensionAPI["events"],
  service: {
    list(signal: AbortSignal): Promise<readonly RoutingAccount[]>;
    activate(account: RoutingAccount, signal: AbortSignal): Promise<void>;
  },
): () => void {
  const shutdown = new AbortController();
  const unsubscribe = events.on(REQUEST, (value) => {
    if (!isRecord(value) || typeof value.id !== "string" || !(value.signal instanceof AbortSignal))
      return;
    if (value.action !== "list" && value.action !== "activate") return;
    const { id, signal: caller } = value;
    const signal = AbortSignal.any([caller, shutdown.signal]);
    events.emit(REPLY, { id, kind: "accepted" });
    const run = async () => {
      signal.throwIfAborted();
      if (value.action === "list") {
        const accounts = await service.list(signal);
        signal.throwIfAborted();
        events.emit(REPLY, { id, kind: "result", accounts });
      } else {
        if (!isRoutingAccount(value.account)) throw new Error("Invalid routing account");
        await service.activate(value.account, signal);
        signal.throwIfAborted();
        events.emit(REPLY, { id, kind: "result" });
      }
    };
    void run().catch((error: unknown) =>
      events.emit(REPLY, {
        id,
        kind: "result",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  return () => {
    shutdown.abort();
    unsubscribe();
  };
}
