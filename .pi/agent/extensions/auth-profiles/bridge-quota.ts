import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isRoutingAccount, type RoutingAccount } from "./routing-eligibility";

// User-managed association: Claude Code's external CLI login belongs to fbb. This does not
// switch CLI accounts; changing that login requires clearing this observation and reassessing it.
export const BRIDGE_OWNER = "fbb";
const TTL_MS = 60_000;
const SCHEMA = "fbb.auth-bridge-quota/v1";

export function bridgeQuotaPath(agentDir = getAgentDir()): string {
  return join(agentDir, "node_modules", ".cache", "auth-profiles", "bridge-quota.json");
}

export function bridgeSubscriptionEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return ![
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
  ].some((key) => Boolean(env[key]));
}

export function parseBridgeQuota(
  headers: Record<string, string>,
  now = Date.now(),
): RoutingAccount | undefined {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const prefix = "anthropic-ratelimit-unified-";
  if (!["allowed", "allowed_warning"].includes(normalized[`${prefix}status`] ?? ""))
    return undefined;
  const windows = ["5h", "7d"].map((name) => {
    const utilization = Number(normalized[`${prefix}${name}-utilization`]);
    const reset = Number(normalized[`${prefix}${name}-reset`]) * 1000;
    if (
      !normalized[`${prefix}${name}-utilization`] ||
      !normalized[`${prefix}${name}-reset`] ||
      !Number.isFinite(utilization) ||
      utilization < 0 ||
      utilization >= 1 ||
      !Number.isFinite(reset) ||
      reset <= now
    )
      return undefined;
    return { remaining: Math.floor((1 - utilization) * 100), reset };
  });
  if (windows.some((window) => window === undefined)) return undefined;
  const available = windows.filter((window) => window !== undefined);
  const remaining = Math.min(...available.map((window) => window.remaining));
  const staleAt = Math.min(now + TTL_MS, ...available.map((window) => window.reset));
  return remaining > 0
    ? { provider: "claude-bridge", profile: BRIDGE_OWNER, remaining, observedAt: now, staleAt }
    : undefined;
}

export function readBridgeQuota(
  now = Date.now(),
  path = bridgeQuotaPath(),
): RoutingAccount | undefined {
  try {
    const raw = readFileSync(path, "utf8");
    if (raw.length > 2048) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object" ||
      value === null ||
      !("schema" in value) ||
      value.schema !== SCHEMA ||
      !("observation" in value) ||
      typeof value.observation !== "object" ||
      value.observation === null
    )
      return undefined;
    const account = value.observation;
    if (
      !isRoutingAccount(account) ||
      account.provider !== "claude-bridge" ||
      account.profile !== BRIDGE_OWNER ||
      account.observedAt > now ||
      account.staleAt <= now ||
      account.staleAt > account.observedAt + TTL_MS
    )
      return undefined;
    return account;
  } catch {
    return undefined;
  }
}

export function recordBridgeQuota(
  headers: Record<string, string>,
  now = Date.now(),
  path = bridgeQuotaPath(),
): void {
  const account = parseBridgeQuota(headers, now);
  if (
    !bridgeSubscriptionEnvironment() ||
    !Object.keys(headers).some((key) =>
      key.toLowerCase().startsWith("anthropic-ratelimit-unified-"),
    )
  )
    return;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schema: SCHEMA, observation: account ?? null }), {
    mode: 0o600,
  });
  renameSync(temporary, path);
}
