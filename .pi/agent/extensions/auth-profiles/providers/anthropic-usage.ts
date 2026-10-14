import { createHash } from "node:crypto";
import { isRecord } from "../../shared/is-record";
import { readBoundedJson } from "../../shared/read-bounded-json";
import { authPathFor, DEFAULT_PROFILE, readJsonFile } from "../profile-store";
import {
  ProviderAuthError,
  type ProviderFetch,
  type ProviderUsageWindow,
} from "../provider-adapter";
import { createCredentialStore, createRuntime, formatReset } from "./openai-codex";

export const ANTHROPIC_PROVIDER_ID = "anthropic";
/** Share of the monthly usage-credit limit, for logins without subscription windows. */
export const CREDIT_WINDOW_ID = "credit";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_TIMEOUT_MS = 20_000;
const FORCE_REFRESH_VALIDITY_MS = 10 * 365 * 86_400_000;

export type AnthropicCredential = {
  /** Profile whose auth file holds the credential; the default profile for fallbacks. */
  owner: string;
  accessToken: string;
  expiresAt: number;
  /** Stable cache identity. Anthropic OAuth carries no account id, so the holding file stands in. */
  identity: string;
};

function parse(value: unknown, owner: string): AnthropicCredential | undefined {
  if (!isRecord(value) || value.type !== "oauth") return undefined;
  const { access, expires } = value;
  if (typeof access !== "string" || access === "" || typeof expires !== "number") return undefined;
  return {
    owner,
    accessToken: access,
    expiresAt: expires,
    identity: createHash("sha256").update(owner).digest("hex").slice(0, 16),
  };
}

/** A profile without its own Anthropic credential falls back to the default auth.json. */
export function readAnthropicCredential(
  profileLabel: string,
  agentDir: string,
): AnthropicCredential | undefined {
  for (const owner of profileLabel === DEFAULT_PROFILE
    ? [DEFAULT_PROFILE]
    : [profileLabel, DEFAULT_PROFILE]) {
    const file = readJsonFile(authPathFor(owner, agentDir));
    if (file?.[ANTHROPIC_PROVIDER_ID] === undefined) continue;
    return parse(file[ANTHROPIC_PROVIDER_ID], owner);
  }
  return undefined;
}

/** Refreshes through Pi's runtime, which writes the rotated tokens back to the owning file. */
export async function refreshAnthropicCredential(
  credential: AnthropicCredential,
  agentDir: string,
  force: boolean,
): Promise<AnthropicCredential> {
  const store = await createCredentialStore(authPathFor(credential.owner, agentDir));
  const runtime = await createRuntime(store);
  await runtime.getAuth(ANTHROPIC_PROVIDER_ID, {
    minOAuthValidityMs: force ? FORCE_REFRESH_VALIDITY_MS : 1,
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  });
  const refreshed = parse(
    await store.read(ANTHROPIC_PROVIDER_ID, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
    credential.owner,
  );
  if (refreshed === undefined || refreshed.expiresAt <= Date.now()) {
    throw new Error("Anthropic credential remained unusable after refresh.");
  }
  return refreshed;
}

function subscriptionWindow(
  payload: Record<string, unknown>,
  key: string,
  windowId: "primary" | "secondary",
  now: number,
): ProviderUsageWindow | undefined {
  const value = payload[key];
  // Credit-based logins have no subscription windows; null means there is nothing to report.
  if (!isRecord(value) || typeof value.utilization !== "number") return undefined;
  const remaining = Math.max(0, Math.min(100, 100 - Math.floor(value.utilization)));
  const resetAt = typeof value.resets_at === "string" ? Date.parse(value.resets_at) : Number.NaN;
  if (!Number.isFinite(resetAt)) return { windowId, remaining };
  const resetsIn = formatReset(Math.max(0, (resetAt - now) / 1000));
  return {
    windowId,
    remaining,
    ...(resetsIn === undefined ? {} : { resetsIn }),
    allowanceResetAt: resetAt,
  };
}

function formatMoney(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const { amount_minor: minor, currency, exponent } = value;
  if (typeof minor !== "number" || typeof currency !== "string") return undefined;
  const digits = typeof exponent === "number" && exponent >= 0 && exponent <= 6 ? exponent : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minor / 10 ** digits);
  } catch {
    return undefined;
  }
}

function creditWindow(payload: Record<string, unknown>): ProviderUsageWindow | undefined {
  const spend = payload.spend;
  if (!isRecord(spend) || spend.enabled !== true || typeof spend.percent !== "number") {
    return undefined;
  }
  const used = formatMoney(spend.used);
  const limit = formatMoney(spend.limit);
  return {
    windowId: CREDIT_WINDOW_ID,
    remaining: Math.max(0, Math.min(100, 100 - Math.floor(spend.percent))),
    ...(used !== undefined && limit !== undefined ? { detail: `${used} of ${limit}` } : {}),
  };
}

export function anthropicUsageFromPayload(
  payload: unknown,
  now = Date.now(),
): ProviderUsageWindow[] {
  if (
    !isRecord(payload) ||
    !("five_hour" in payload || "seven_day" in payload || "spend" in payload)
  ) {
    throw new Error("usage response has an unexpected shape");
  }
  return [
    subscriptionWindow(payload, "five_hour", "primary", now),
    subscriptionWindow(payload, "seven_day", "secondary", now),
    creditWindow(payload),
  ].filter((window): window is ProviderUsageWindow => window !== undefined);
}

export async function fetchAnthropicUsage(
  credential: AnthropicCredential,
  fetchFn: ProviderFetch,
  now = Date.now(),
): Promise<ProviderUsageWindow[]> {
  const response = await fetchFn(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 || response.status === 403) {
    throw new ProviderAuthError(`request rejected with ${response.status}`);
  }
  if (!response.ok) throw new Error(`request failed with ${response.status}`);
  return anthropicUsageFromPayload(await readBoundedJson(response), now);
}

// The 429 carries no reset time, so an owner without exhausted usage windows is retried
// after one usage-cache interval instead of on the very next request.
const UNKNOWN_USAGE_COOLDOWN_MS = 5 * 60_000;
const RETRY_DELAY_PATTERN = /Server requested (\d+)s retry delay/;

/**
 * Detect an Anthropic usage limit from an assistant error message.
 *
 * The SDK throws on HTTP 429 before Pi's `after_provider_response` hook runs, so the
 * error text (`429 {"type":"error","error":{"type":"rate_limit_error",...}}`) is the
 * only signal. Pi's retry wrapper prefixes `Server requested Ns retry delay` when the
 * server's Retry-After exceeds its retry limit; that delay is the best reset estimate.
 */
export function anthropicUsageLimitFromMessage(
  errorMessage: string | undefined,
  now = Date.now(),
): { resetAt?: number } | undefined {
  if (errorMessage === undefined) return undefined;
  if (!/\b429\b/.test(errorMessage) || !errorMessage.includes("rate_limit_error")) return undefined;
  const seconds = Number(RETRY_DELAY_PATTERN.exec(errorMessage)?.[1]);
  return Number.isFinite(seconds) && seconds > 0 ? { resetAt: now + seconds * 1000 } : {};
}

/**
 * When an exhausted owner's usage resets: the latest reset among exhausted windows,
 * else the 5-hour window reset (cached usage can lag the 429), else a short cooldown.
 */
export function anthropicExhaustionResetAt(
  windows: readonly ProviderUsageWindow[] | undefined,
  now = Date.now(),
): number {
  const future = (window: ProviderUsageWindow) =>
    window.allowanceResetAt !== undefined && window.allowanceResetAt > now;
  const exhausted = (windows ?? []).filter((window) => window.remaining <= 0 && future(window));
  if (exhausted.length > 0) {
    return Math.max(...exhausted.map((window) => window.allowanceResetAt ?? now));
  }
  const primary = windows?.find((window) => window.windowId === "primary" && future(window));
  return primary?.allowanceResetAt ?? now + UNKNOWN_USAGE_COOLDOWN_MS;
}

/** Whether every reported Anthropic window still has usage, confirming the owner can serve. */
export function hasConfirmedAnthropicUsage(
  windows: readonly ProviderUsageWindow[] | undefined,
): boolean {
  return windows !== undefined && windows.length > 0 && windows.every((w) => w.remaining > 0);
}
