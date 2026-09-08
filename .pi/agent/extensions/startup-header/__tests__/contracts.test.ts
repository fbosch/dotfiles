import { describe, expect, test } from "bun:test";
import {
  createStartupOwnerRequest,
  readStartupOwnerSnapshot,
  STARTUP_OWNER_SCHEMA_VERSION,
  type StartupOwnerSnapshot,
  StartupOwnerStore,
} from "../contracts";

function snapshot(overrides: Partial<StartupOwnerSnapshot> = {}): StartupOwnerSnapshot {
  return {
    type: "change",
    schemaVersion: STARTUP_OWNER_SCHEMA_VERSION,
    sessionId: "session-a",
    generationId: "generation-a",
    ownerId: "lsp",
    ownerRevision: 1,
    state: "ready",
    payload: { status: "ready" },
    ...overrides,
  };
}

describe("startup owner contracts", () => {
  test("creates immutable owner-targeted discovery requests", () => {
    const request = createStartupOwnerRequest("session-a", "generation-a", "auth");

    expect(request).toEqual({
      type: "request",
      schemaVersion: 1,
      sessionId: "session-a",
      generationId: "generation-a",
      ownerId: "auth",
      ownerRevision: 0,
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  test("reconstructs an owned immutable snapshot and strips unknown fields", () => {
    const payload = { nested: { count: 2 } };
    const parsed = readStartupOwnerSnapshot({
      ...snapshot({ payload }),
      privatePath: "/secret/project",
    });

    expect(parsed).toBeDefined();
    expect(parsed).not.toHaveProperty("privatePath");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed?.payload)).toBe(true);
    payload.nested.count = 7;
    expect(parsed?.payload).toEqual({ nested: { count: 2 } });
  });

  test("rejects incompatible, malformed, and uncloneable snapshots", () => {
    expect(readStartupOwnerSnapshot(snapshot({ schemaVersion: 2 as 1 }))).toBeUndefined();
    expect(readStartupOwnerSnapshot({ ...snapshot(), ownerId: "unknown-owner" })).toBeUndefined();
    expect(readStartupOwnerSnapshot(snapshot({ observedAt: Number.NaN }))).toBeUndefined();
    expect(readStartupOwnerSnapshot(snapshot({ payload: () => undefined }))).toBeUndefined();
  });
});

describe("StartupOwnerStore", () => {
  test("keeps absent owners absent and rejects stale or foreign updates", () => {
    const store = new StartupOwnerStore("session-a", "generation-a");

    expect(store.availableOwners()).toEqual([]);
    expect(store.accept(snapshot({ ownerRevision: 2 }))).toBe(true);
    expect(store.accept(snapshot({ ownerRevision: 1, state: "degraded" }))).toBe(false);
    expect(store.accept(snapshot({ ownerRevision: 2, state: "degraded" }))).toBe(false);
    expect(store.accept(snapshot({ sessionId: "session-b", ownerRevision: 3 }))).toBe(false);
    expect(store.accept(snapshot({ generationId: "generation-b", ownerRevision: 3 }))).toBe(false);
    expect(store.get("lsp")?.state).toBe("ready");
  });

  test("clears owner state on generation replacement and rejects delayed A to B to A replies", () => {
    const store = new StartupOwnerStore("session-a", "generation-a1");
    expect(store.accept(snapshot({ generationId: "generation-a1" }))).toBe(true);

    store.replaceGeneration("session-a", "generation-b");
    expect(store.availableOwners()).toEqual([]);
    expect(store.accept(snapshot({ generationId: "generation-a1", ownerRevision: 9 }))).toBe(false);
    expect(store.accept(snapshot({ generationId: "generation-b", ownerRevision: 1 }))).toBe(true);

    store.replaceGeneration("session-a", "generation-a2");
    expect(store.accept(snapshot({ generationId: "generation-a1", ownerRevision: 10 }))).toBe(
      false,
    );
    expect(store.accept(snapshot({ generationId: "generation-a2", ownerRevision: 1 }))).toBe(true);
    expect(store.get("lsp")?.generationId).toBe("generation-a2");
  });

  test("uses disposed revisions as tombstones and stops after store disposal", () => {
    const store = new StartupOwnerStore("session-a", "generation-a");
    expect(store.accept(snapshot({ ownerRevision: 3 }))).toBe(true);
    expect(store.accept(snapshot({ ownerRevision: 4, state: "disposed" }))).toBe(true);
    expect(store.get("lsp")).toBeUndefined();
    expect(store.accept(snapshot({ ownerRevision: 3 }))).toBe(false);

    store.dispose();
    expect(store.availableOwners()).toEqual([]);
    expect(store.accept(snapshot({ ownerRevision: 5 }))).toBe(false);
  });
});
