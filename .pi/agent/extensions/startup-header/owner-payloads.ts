import { sanitizeHeaderField } from "./sanitize";

export type NeovimStartupPayload =
  | { readonly problem: "channel-problem" }
  | { readonly problem: "workspace-mismatch" };

export type DirenvStartupPayload =
  | { readonly problem: "blocked" }
  | { readonly problem: "load-failed" }
  | { readonly problem: "missing" };

export type LspStartupPayload =
  | { readonly observedDocuments: number }
  | { readonly problem: "server-problem" }
  | { readonly problem: "workspace-mismatch" };

export type AuthStartupWindow = {
  readonly windowId: string;
  readonly remaining: number;
  readonly allowanceResetAt?: number;
  /** Short spend text such as "$2.78 of $500.00" for credit-based usage. */
  readonly detail?: string;
};

/** A provider the profile can use besides its selection provider (`provider`). */
export type AuthStartupProviderStatus = {
  readonly provider: string;
  /** Profile whose credential is used when the profile has none of its own. */
  readonly borrowedFrom?: string;
  readonly windows: readonly AuthStartupWindow[];
};

export type AuthStartupProfile = {
  readonly profileLabel: string;
  readonly status: "reported" | "errored" | "not-reported";
  readonly method?: string;
  readonly provider?: string;
  readonly windows: readonly AuthStartupWindow[];
  readonly bankedResetCount?: number;
  readonly bankedExpiryAt?: number;
  readonly providers?: readonly AuthStartupProviderStatus[];
  readonly observedAt?: number;
  readonly staleAt?: number;
};

export type AuthStartupPayload = {
  readonly activeProfile: string;
  readonly profiles: readonly AuthStartupProfile[];
};

export type AuthStartupObservation = Omit<
  AuthStartupProfile,
  "status" | "observedAt" | "staleAt"
> & {
  readonly observedAt: number;
  readonly staleAt: number;
  readonly error?: "credential" | "usage" | "credits";
};

export function createAuthStartupPayload(
  activeProfile: string,
  profileOrder: readonly string[],
  observations: readonly AuthStartupObservation[],
): AuthStartupPayload | undefined {
  const active = sanitizeLabel(activeProfile);
  if (active === undefined) return undefined;
  const byLabel = new Map<string, AuthStartupObservation>();
  for (const observation of observations) {
    const label = sanitizeLabel(observation.profileLabel);
    if (label !== undefined && !byLabel.has(label)) byLabel.set(label, observation);
  }
  const ordered = [active, ...profileOrder.map(sanitizeLabel).filter(isDefined)];
  const seen = new Set<string>();
  const profiles: AuthStartupProfile[] = [];
  for (const label of ordered) {
    if (seen.has(label)) continue;
    seen.add(label);
    const observation = byLabel.get(label);
    if (observation === undefined) {
      profiles.push(
        Object.freeze({
          profileLabel: label,
          status: "not-reported",
          windows: Object.freeze([]),
        }),
      );
      continue;
    }
    const profile = readAuthProfile(observation, label);
    if (profile !== undefined) profiles.push(profile);
  }
  return Object.freeze({ activeProfile: active, profiles: Object.freeze(profiles) });
}

export function readAuthStartupPayload(value: unknown): AuthStartupPayload | undefined {
  if (
    !isRecord(value) ||
    typeof value.activeProfile !== "string" ||
    !Array.isArray(value.profiles)
  ) {
    return undefined;
  }
  const activeProfile = sanitizeLabel(value.activeProfile);
  if (activeProfile === undefined) return undefined;
  const profiles = value.profiles.map(readUnknownAuthProfile);
  if (profiles.some((profile) => profile === undefined)) return undefined;
  return Object.freeze({
    activeProfile,
    profiles: Object.freeze(profiles as AuthStartupProfile[]),
  });
}

export function readNeovimStartupPayload(value: unknown): NeovimStartupPayload | undefined {
  return readProblem(value, ["channel-problem", "workspace-mismatch"] as const);
}

export function readDirenvStartupPayload(value: unknown): DirenvStartupPayload | undefined {
  return readProblem(value, ["blocked", "load-failed", "missing"] as const);
}

export function readLspStartupPayload(value: unknown): LspStartupPayload | undefined {
  const problem = readProblem(value, ["server-problem", "workspace-mismatch"] as const);
  if (problem !== undefined) return problem;
  if (!isRecord(value) || !isCount(value.observedDocuments)) return undefined;
  return Object.freeze({ observedDocuments: value.observedDocuments });
}

function readUnknownAuthProfile(value: unknown): AuthStartupProfile | undefined {
  if (!isRecord(value)) return undefined;
  const profileLabel =
    typeof value.profileLabel === "string" ? sanitizeLabel(value.profileLabel) : undefined;
  if (
    profileLabel !== undefined &&
    value.status === "not-reported" &&
    Array.isArray(value.windows) &&
    value.windows.length === 0
  ) {
    return Object.freeze({
      profileLabel,
      status: "not-reported",
      windows: Object.freeze([]),
    });
  }
  if (
    profileLabel === undefined ||
    (value.status !== "reported" && value.status !== "errored") ||
    !Array.isArray(value.windows) ||
    !isTimestamp(value.observedAt) ||
    !isTimestamp(value.staleAt)
  )
    return undefined;
  return readAuthProfile(
    {
      profileLabel,
      status: value.status,
      ...(typeof value.method === "string" ? { method: value.method } : {}),
      ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
      windows: value.windows as AuthStartupWindow[],
      ...(typeof value.bankedResetCount === "number"
        ? { bankedResetCount: value.bankedResetCount }
        : {}),
      ...(typeof value.bankedExpiryAt === "number" ? { bankedExpiryAt: value.bankedExpiryAt } : {}),
      ...(Array.isArray(value.providers)
        ? { providers: value.providers as AuthStartupProviderStatus[] }
        : {}),
      observedAt: value.observedAt,
      staleAt: value.staleAt,
    },
    profileLabel,
  );
}

function readAuthProfile(
  value:
    | AuthStartupObservation
    | (AuthStartupProfile & { readonly status?: "reported" | "errored" }),
  profileLabel: string,
): AuthStartupProfile | undefined {
  if (
    !isTimestamp(value.observedAt) ||
    !isTimestamp(value.staleAt) ||
    !Array.isArray(value.windows)
  ) {
    return undefined;
  }
  const windows = readAuthWindows(value.windows);
  if (windows === undefined) return undefined;
  const providers = value.providers === undefined ? undefined : readAuthProviders(value.providers);
  if (value.providers !== undefined && providers === undefined) return undefined;
  if (value.bankedResetCount !== undefined && !isCount(value.bankedResetCount)) return undefined;
  if (value.bankedExpiryAt !== undefined && !isTimestamp(value.bankedExpiryAt)) return undefined;
  const bankedExpiryAt = value.bankedResetCount === 0 ? undefined : value.bankedExpiryAt;
  const method = value.method === undefined ? undefined : sanitizeLabel(value.method);
  const provider = value.provider === undefined ? undefined : sanitizeLabel(value.provider);
  if (
    (value.method !== undefined && method === undefined) ||
    (value.provider !== undefined && provider === undefined)
  )
    return undefined;
  return Object.freeze({
    profileLabel,
    status:
      ("error" in value && value.error !== undefined) ||
      ("status" in value && value.status === "errored")
        ? "errored"
        : "reported",
    ...(method === undefined ? {} : { method }),
    ...(provider === undefined ? {} : { provider }),
    windows: Object.freeze(windows),
    ...(value.bankedResetCount === undefined ? {} : { bankedResetCount: value.bankedResetCount }),
    ...(bankedExpiryAt === undefined ? {} : { bankedExpiryAt }),
    ...(providers === undefined || providers.length === 0 ? {} : { providers }),
    observedAt: value.observedAt,
    staleAt: value.staleAt,
  });
}

function readAuthWindows(values: readonly unknown[]): AuthStartupWindow[] | undefined {
  const windows: AuthStartupWindow[] = [];
  const seen = new Set<string>();
  for (const window of values) {
    if (!isRecord(window) || typeof window.windowId !== "string") return undefined;
    const windowId = sanitizeLabel(window.windowId);
    if (windowId === undefined || seen.has(windowId) || !isPercent(window.remaining))
      return undefined;
    if (window.allowanceResetAt !== undefined && !isTimestamp(window.allowanceResetAt))
      return undefined;
    seen.add(windowId);
    const detail = typeof window.detail === "string" ? sanitizeHeaderField(window.detail, 32) : "";
    windows.push(
      Object.freeze({
        windowId,
        remaining: window.remaining,
        ...(window.allowanceResetAt === undefined
          ? {}
          : { allowanceResetAt: window.allowanceResetAt }),
        ...(detail === "" ? {} : { detail }),
      }),
    );
  }
  return windows;
}

function readAuthProviders(values: unknown): AuthStartupProviderStatus[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const providers: AuthStartupProviderStatus[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || typeof value.provider !== "string" || !Array.isArray(value.windows))
      return undefined;
    const provider = sanitizeLabel(value.provider);
    if (provider === undefined || seen.has(provider)) return undefined;
    const borrowedFrom =
      typeof value.borrowedFrom === "string" ? sanitizeLabel(value.borrowedFrom) : undefined;
    if (value.borrowedFrom !== undefined && borrowedFrom === undefined) return undefined;
    const windows = readAuthWindows(value.windows);
    if (windows === undefined) return undefined;
    seen.add(provider);
    providers.push(
      Object.freeze({
        provider,
        ...(borrowedFrom === undefined ? {} : { borrowedFrom }),
        windows: Object.freeze(windows),
      }),
    );
  }
  return providers;
}
function sanitizeLabel(value: string): string | undefined {
  const sanitized = sanitizeHeaderField(value, 64);
  return sanitized === "" ? undefined : sanitized;
}

function readProblem<T extends string>(
  value: unknown,
  allowed: readonly T[],
): { readonly problem: T } | undefined {
  if (
    !isRecord(value) ||
    typeof value.problem !== "string" ||
    !allowed.includes(value.problem as T)
  ) {
    return undefined;
  }
  return Object.freeze({ problem: value.problem as T });
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 64;
}

function isPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
