import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../contracts";
import { installStartupOwnerPublisher } from "../publisher";

describe("startup owner publisher", () => {
  test("remains absent until requested, then publishes ordered immutable transitions", () => {
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      snapshots.push(value as StartupOwnerSnapshot);
    });
    const publisher = installStartupOwnerPublisher(events, "auth", () => ({
      state: "collecting",
      observedAt: 10,
    }));

    expect(publisher.publish({ state: "ready", observedAt: 11 })).toBe(false);
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g1", "auth"),
    );
    expect(snapshots.at(-1)).toMatchObject({
      type: "reply",
      sessionId: "s",
      generationId: "g1",
      ownerRevision: 1,
      state: "collecting",
      observedAt: 10,
    });
    expect(Object.isFrozen(snapshots.at(-1))).toBe(true);

    publisher.publish({
      state: "ready",
      observedAt: 20,
      staleAt: 40,
      expiresAt: 60,
      payload: { profile: "work" },
    });
    publisher.publish({ state: "degraded", observedAt: 20, staleAt: 40, expiresAt: 60 });
    publisher.publish({ state: "unavailable", observedAt: 70, expiresAt: 60 });
    expect(snapshots.slice(-3).map(({ state, ownerRevision }) => [state, ownerRevision])).toEqual([
      ["ready", 2],
      ["degraded", 3],
      ["unavailable", 4],
    ]);
    expect(snapshots.at(-1)?.expiresAt).toBe(60);

    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g2", "auth"),
    );
    expect(snapshots.at(-1)).toMatchObject({ generationId: "g2", ownerRevision: 1 });

    publisher.dispose();
    expect(snapshots.at(-1)).toMatchObject({ state: "disposed", ownerRevision: 2 });
    expect(publisher.publish({ state: "ready" })).toBe(false);
  });

  test("ignores other owners and converts owner collection failures to unavailable", () => {
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      snapshots.push(value as StartupOwnerSnapshot);
    });
    installStartupOwnerPublisher(events, "lsp", () => {
      throw new Error("private diagnostic");
    });

    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "auth"),
    );
    expect(snapshots).toEqual([]);
    events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("s", "g", "lsp"),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ state: "unavailable" });
    expect(JSON.stringify(snapshots)).not.toContain("private diagnostic");
  });
});
