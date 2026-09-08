import { expect, test } from "bun:test";
import { createEventBus, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import contextViewStartupPublisher from "../context-view-startup";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../startup-header/contracts";
import type { StartupRuntimeSnapshot, StartupSnapshotAPI } from "../startup-header/runtime-types";

function runtime(context: StartupRuntimeSnapshot["context"]): StartupRuntimeSnapshot {
  return {
    sessionId: "runtime-session",
    generationId: "runtime-generation",
    ownerId: "pi-runtime",
    ownerRevision: 1,
    resources: { status: "unavailable" },
    context,
  };
}

test("publishes only structured pi-context-view startup aggregates", () => {
  const events = createEventBus();
  const handlers = new Map<string, () => void>();
  const snapshots: StartupOwnerSnapshot[] = [];
  let listener: ((snapshot: StartupRuntimeSnapshot) => void) | undefined;
  let unsubscribed = false;
  const capability = {
    capability: "pi.startupSnapshot",
    schemaVersion: 1,
    get: () => runtime({ status: "collecting" }),
    subscribe: (next: (snapshot: StartupRuntimeSnapshot) => void) => {
      listener = next;
      return () => {
        unsubscribed = true;
      };
    },
  } satisfies StartupSnapshotAPI;
  const pi = {
    events,
    on(event: string, handler: () => void) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => snapshots.push(value as StartupOwnerSnapshot));

  contextViewStartupPublisher(pi);
  events.emit(
    STARTUP_OWNER_REQUEST_EVENT,
    createStartupOwnerRequest("session", "generation", "context"),
  );
  expect(snapshots.at(-1)).toMatchObject({ state: "unavailable" });
  (pi as ExtensionAPI & { startupSnapshot?: unknown }).startupSnapshot = capability;
  handlers.get("session_start")?.();
  events.emit(
    STARTUP_OWNER_REQUEST_EVENT,
    createStartupOwnerRequest("session", "generation", "context"),
  );
  expect(snapshots.at(-1)).toMatchObject({ state: "collecting" });

  listener?.(
    runtime({
      status: "ready",
      value: {
        contextWindowTokens: 200_000,
        autoCompactReserveTokens: 12_000,
        estimatedTokens: 100,
        categories: [{ id: "system-prompt", tokens: 100 }],
      },
    }),
  );
  expect(snapshots.at(-1)).toMatchObject({
    state: "ready",
    payload: { estimatedTokens: 100 },
  });
  expect(JSON.stringify(snapshots)).not.toMatch(/prompt text|tool schema|file content/i);

  handlers.get("session_shutdown")?.();
  expect(unsubscribed).toBe(true);
  expect(snapshots.at(-1)).toMatchObject({ state: "disposed" });
});
