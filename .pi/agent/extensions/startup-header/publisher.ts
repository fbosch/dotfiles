import type { EventBus } from "@earendil-works/pi-coding-agent";
import {
  readStartupOwnerRequest,
  readStartupOwnerSnapshot,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SCHEMA_VERSION,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerId,
  type StartupOwnerSnapshot,
  type StartupOwnerState,
} from "./contracts";

export interface StartupOwnerStatus<T = unknown> {
  readonly state: Exclude<StartupOwnerState, "disposed">;
  readonly observedAt?: number;
  readonly staleAt?: number;
  readonly expiresAt?: number;
  readonly payload?: T;
}

export interface StartupOwnerPublisher<T = unknown> {
  publish(status: StartupOwnerStatus<T>): boolean;
  dispose(): void;
}

export interface StartupOwnerPublisherOptions {
  readonly responds?: () => boolean;
}

export function installStartupOwnerPublisher<T>(
  events: EventBus,
  ownerId: StartupOwnerId,
  getCurrent: () => StartupOwnerStatus<T>,
  options: StartupOwnerPublisherOptions = {},
): StartupOwnerPublisher<T> {
  let activeRequest: ReturnType<typeof readStartupOwnerRequest>;
  let ownerRevision = 0;
  let disposed = false;

  const emit = (
    type: StartupOwnerSnapshot["type"],
    status: StartupOwnerStatus<T> | { readonly state: "disposed" },
  ): boolean => {
    if (disposed || activeRequest === undefined) return false;
    ownerRevision += 1;
    const snapshot = readStartupOwnerSnapshot({
      type,
      schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
      sessionId: activeRequest.sessionId,
      generationId: activeRequest.generationId,
      ownerId,
      ownerRevision,
      ...status,
    });
    if (snapshot === undefined) throw new TypeError(`Invalid startup snapshot from ${ownerId}`);
    events.emit(STARTUP_OWNER_SNAPSHOT_EVENT, snapshot);
    return true;
  };

  const unsubscribe = events.on(STARTUP_OWNER_REQUEST_EVENT, (value) => {
    if (disposed) return;
    const request = readStartupOwnerRequest(value);
    if (request === undefined || request.ownerId !== ownerId) return;
    activeRequest = request;
    ownerRevision = 0;
    if (options.responds?.() === false) return;
    try {
      emit("reply", getCurrent());
    } catch {
      emit("reply", { state: "unavailable" });
    }
  });

  return {
    publish(status) {
      return emit("change", status);
    },
    dispose() {
      if (disposed) return;
      if (activeRequest !== undefined) emit("change", { state: "disposed" });
      disposed = true;
      activeRequest = undefined;
      unsubscribe();
    },
  };
}
