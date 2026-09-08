export const STARTUP_OWNER_REQUEST_EVENT = "dotfiles:pi-startup-header/request/v1";
export const STARTUP_OWNER_SNAPSHOT_EVENT = "dotfiles:pi-startup-header/snapshot/v1";
export const STARTUP_OWNER_SCHEMA_VERSION = 1;

export const STARTUP_OWNER_IDS = [
  "workspace",
  "neovim",
  "direnv",
  "lsp",
  "formatter",
  "auth",
  "resources",
  "context",
  "startup-time",
  "updates",
] as const;

export type StartupOwnerId = (typeof STARTUP_OWNER_IDS)[number];
export type StartupOwnerState = "unavailable" | "collecting" | "ready" | "degraded" | "disposed";

export interface StartupOwnerEnvelope {
  readonly schemaVersion: typeof STARTUP_OWNER_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly generationId: string;
  readonly ownerId: StartupOwnerId;
  readonly ownerRevision: number;
}

export interface StartupOwnerRequest extends StartupOwnerEnvelope {
  readonly type: "request";
}

export interface StartupOwnerSnapshot<T = unknown> extends StartupOwnerEnvelope {
  readonly type: "reply" | "change";
  readonly state: StartupOwnerState;
  readonly observedAt?: number;
  readonly staleAt?: number;
  readonly expiresAt?: number;
  readonly payload?: T;
}

export function createStartupOwnerRequest(
  sessionId: string,
  generationId: string,
  ownerId: StartupOwnerId,
): StartupOwnerRequest {
  return deepFreeze({
    type: "request",
    schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
    sessionId,
    generationId,
    ownerId,
    ownerRevision: 0,
  });
}

export function readStartupOwnerRequest(value: unknown): StartupOwnerRequest | undefined {
  if (!isRecord(value) || value.type !== "request") return undefined;
  if (value.schemaVersion !== STARTUP_OWNER_SCHEMA_VERSION) return undefined;
  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.generationId)) return undefined;
  if (!isStartupOwnerId(value.ownerId) || value.ownerRevision !== 0) return undefined;
  return deepFreeze({
    type: "request",
    schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
    sessionId: value.sessionId,
    generationId: value.generationId,
    ownerId: value.ownerId,
    ownerRevision: 0,
  });
}

export function readStartupOwnerSnapshot(value: unknown): StartupOwnerSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type !== "reply" && value.type !== "change") return undefined;
  if (value.schemaVersion !== STARTUP_OWNER_SCHEMA_VERSION) return undefined;
  if (!isNonEmptyString(value.sessionId) || !isNonEmptyString(value.generationId)) return undefined;
  if (!isStartupOwnerId(value.ownerId) || !isRevision(value.ownerRevision)) return undefined;
  if (!isStartupOwnerState(value.state)) return undefined;
  if (!isOptionalTimestamp(value.observedAt)) return undefined;
  if (!isOptionalTimestamp(value.staleAt)) return undefined;
  if (!isOptionalTimestamp(value.expiresAt)) return undefined;

  try {
    const snapshot: StartupOwnerSnapshot = {
      type: value.type,
      schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
      sessionId: value.sessionId,
      generationId: value.generationId,
      ownerId: value.ownerId,
      ownerRevision: value.ownerRevision,
      state: value.state,
      ...(value.observedAt === undefined ? {} : { observedAt: value.observedAt }),
      ...(value.staleAt === undefined ? {} : { staleAt: value.staleAt }),
      ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt }),
      ...(value.payload === undefined ? {} : { payload: structuredClone(value.payload) }),
    };
    return deepFreeze(snapshot);
  } catch {
    return undefined;
  }
}

export class StartupOwnerStore {
  private sessionId: string;
  private generationId: string;
  private readonly revisions = new Map<StartupOwnerId, number>();
  private readonly snapshots = new Map<StartupOwnerId, StartupOwnerSnapshot>();
  private disposed = false;

  public constructor(sessionId: string, generationId: string) {
    this.sessionId = sessionId;
    this.generationId = generationId;
  }

  public accept(value: unknown): boolean {
    if (this.disposed) return false;
    const snapshot = readStartupOwnerSnapshot(value);
    if (snapshot === undefined) return false;
    if (snapshot.sessionId !== this.sessionId || snapshot.generationId !== this.generationId) {
      return false;
    }

    const currentRevision = this.revisions.get(snapshot.ownerId);
    if (currentRevision !== undefined && snapshot.ownerRevision <= currentRevision) return false;

    this.revisions.set(snapshot.ownerId, snapshot.ownerRevision);
    if (snapshot.state === "disposed") this.snapshots.delete(snapshot.ownerId);
    else this.snapshots.set(snapshot.ownerId, snapshot);
    return true;
  }

  public get(ownerId: StartupOwnerId): StartupOwnerSnapshot | undefined {
    return this.snapshots.get(ownerId);
  }

  public availableOwners(): readonly StartupOwnerId[] {
    return Object.freeze([...this.snapshots.keys()]);
  }

  public replaceGeneration(sessionId: string, generationId: string): void {
    if (this.disposed) return;
    this.sessionId = sessionId;
    this.generationId = generationId;
    this.revisions.clear();
    this.snapshots.clear();
  }

  public dispose(): void {
    this.disposed = true;
    this.revisions.clear();
    this.snapshots.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isOptionalTimestamp(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isStartupOwnerId(value: unknown): value is StartupOwnerId {
  return typeof value === "string" && STARTUP_OWNER_IDS.includes(value as StartupOwnerId);
}

function isStartupOwnerState(value: unknown): value is StartupOwnerState {
  return (
    value === "unavailable" ||
    value === "collecting" ||
    value === "ready" ||
    value === "degraded" ||
    value === "disposed"
  );
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
