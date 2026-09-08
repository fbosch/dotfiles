import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
  readStartupOwnerRequest,
  readStartupOwnerSnapshot,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SCHEMA_VERSION,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
  type StartupOwnerState,
} from "../startup-header/contracts";
import {
  type AuthStartupPayload,
  type AuthStartupProfile,
  createAuthStartupPayload,
} from "../startup-header/owner-payloads";

export interface AuthUsageWindowObservation {
  readonly windowId: string;
  readonly remaining: number;
  readonly allowanceResetAt?: number;
}

export interface AuthProfileObservation {
  readonly profileLabel: string;
  readonly method?: string;
  readonly provider?: string;
  readonly windows: readonly AuthUsageWindowObservation[];
  readonly bankedResetCount?: number;
  readonly bankedExpiryAt?: number;
  readonly observedAt: number;
  readonly staleAt: number;
  readonly error?: "credential" | "usage" | "credits";
}

export interface AuthStartupState {
  readonly activeProfile?: string;
  readonly profileOrder: readonly string[];
  readonly observations: readonly AuthProfileObservation[];
}

export interface AuthStartupClock {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(timer: unknown): void;
}

const systemClock: AuthStartupClock = {
  now: Date.now,
  setTimeout,
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** Owns only already-observed auth state; it never reads credentials or starts collection. */
export class AuthStartupOwner {
  private activeRequest: ReturnType<typeof readStartupOwnerRequest>;
  private revision = 0;
  private timer: unknown;
  private disposed = false;

  public constructor(
    private readonly events: EventBus,
    private readonly getState: () => AuthStartupState | undefined,
    private readonly clock: AuthStartupClock = systemClock,
  ) {
    this.unsubscribe = events.on(STARTUP_OWNER_REQUEST_EVENT, (value) => this.onRequest(value));
  }

  private readonly unsubscribe: () => void;

  public update(): boolean {
    if (this.disposed || this.activeRequest === undefined) return false;
    return this.publish("change");
  }

  public dispose(): void {
    if (this.disposed) return;
    this.clearDeadline();
    if (this.activeRequest !== undefined) this.emit("change", { state: "disposed" });
    this.disposed = true;
    this.activeRequest = undefined;
    this.unsubscribe();
  }

  private onRequest(value: unknown): void {
    if (this.disposed) return;
    const request = readStartupOwnerRequest(value);
    if (request === undefined || request.ownerId !== "auth") return;
    this.clearDeadline();
    this.activeRequest = request;
    this.revision = 0;
    this.publish("reply");
  }

  private publish(type: StartupOwnerSnapshot["type"]): boolean {
    const state = this.getState();
    const status = statusFromState(state, this.clock.now());
    const published = this.emit(type, status);
    if (published) this.scheduleDeadline(status);
    return published;
  }

  private emit(
    type: StartupOwnerSnapshot["type"],
    status: {
      readonly state: StartupOwnerState;
      readonly observedAt?: number;
      readonly staleAt?: number;
      readonly expiresAt?: number;
      readonly payload?: AuthStartupPayload;
    },
  ): boolean {
    if (this.activeRequest === undefined || this.disposed) return false;
    this.revision += 1;
    const snapshot = readStartupOwnerSnapshot({
      type,
      schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
      sessionId: this.activeRequest.sessionId,
      generationId: this.activeRequest.generationId,
      ownerId: "auth",
      ownerRevision: this.revision,
      ...status,
    });
    if (snapshot === undefined) return false;
    this.events.emit(STARTUP_OWNER_SNAPSHOT_EVENT, snapshot);
    return true;
  }

  private scheduleDeadline(status: ReturnType<typeof statusFromState>): void {
    this.clearDeadline();
    if (this.activeRequest === undefined || status.payload === undefined) return;
    const deadlines = [
      status.staleAt,
      ...status.payload.profiles.flatMap((profile) => [
        ...profile.windows.map((window) => window.allowanceResetAt),
        profile.bankedExpiryAt,
      ]),
    ].filter((value): value is number => value !== undefined && value > this.clock.now());
    const deadline = Math.min(...deadlines);
    if (!Number.isFinite(deadline)) return;
    const generationId = this.activeRequest.generationId;
    this.timer = this.clock.setTimeout(
      () => {
        this.timer = undefined;
        if (this.disposed || this.activeRequest?.generationId !== generationId) return;
        this.publish("change");
      },
      Math.max(0, deadline - this.clock.now()),
    );
  }

  private clearDeadline(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function statusFromState(
  state: AuthStartupState | undefined,
  now: number,
): {
  readonly state: Exclude<StartupOwnerState, "disposed">;
  readonly observedAt?: number;
  readonly staleAt?: number;
  readonly expiresAt?: number;
  readonly payload?: AuthStartupPayload;
} {
  if (state === undefined || state.activeProfile === undefined) return { state: "unavailable" };
  const payload = createAuthStartupPayload(
    state.activeProfile,
    state.profileOrder,
    state.observations,
  );
  if (payload === undefined) return { state: "degraded" };
  const observedProfiles = payload.profiles.filter(
    (profile): profile is AuthStartupProfile & { observedAt: number; staleAt: number } =>
      profile.observedAt !== undefined && profile.staleAt !== undefined,
  );
  if (observedProfiles.length === 0) return { state: "collecting", payload };
  const observedAt = Math.max(...observedProfiles.map((profile) => profile.observedAt));
  const staleAt = Math.min(...observedProfiles.map((profile) => profile.staleAt));
  const expires = observedProfiles.flatMap((profile) =>
    profile.bankedExpiryAt === undefined ? [] : [profile.bankedExpiryAt],
  );
  const expiresAt = expires.length === 0 ? undefined : Math.min(...expires);
  const hasError = payload.profiles.some((profile) => profile.status === "errored");
  const stale = staleAt <= now;
  return {
    state: hasError || stale ? "degraded" : "ready",
    observedAt,
    staleAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    payload,
  };
}
