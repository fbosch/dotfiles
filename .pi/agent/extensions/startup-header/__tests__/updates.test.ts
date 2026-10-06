import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../contracts";
import {
  installUpdateStartupPublisher,
  readAvailableUpdates,
  readUpdateCoverage,
} from "../updates";

describe("update coverage publisher", () => {
  test("publishes complete, partial, offline, and failed coverage without fetching", () => {
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    let reads = 0;
    const publisher = installUpdateStartupPublisher(events, () => {
      reads += 1;
      return { coverage: "complete", available: 0 };
    });
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );

    expect(reads).toBe(0);
    events.emit(
      STARTUP_OWNER_REQUEST_EVENT,
      createStartupOwnerRequest("session", "generation", "updates"),
    );
    expect(reads).toBe(1);
    expect(snapshots.at(-1)).toMatchObject({
      state: "ready",
      payload: { coverage: "complete", available: 0 },
    });

    for (const coverage of [
      { coverage: "partial", available: 2 } as const,
      { coverage: "offline" } as const,
      { coverage: "failed" } as const,
    ]) {
      publisher.publish({ state: "degraded", payload: coverage });
    }
    expect(snapshots.slice(-3).map(({ payload }) => payload)).toEqual([
      { coverage: "partial", available: 2 },
      { coverage: "offline" },
      { coverage: "failed" },
    ]);
    publisher.dispose();
  });

  test("preserves freshness metadata and reports failed checks without an available count", () => {
    const events = createEventBus();
    const snapshots: StartupOwnerSnapshot[] = [];
    const publisher = installUpdateStartupPublisher(events, () => undefined);
    events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    events.emit(
      STARTUP_OWNER_REQUEST_EVENT,
      createStartupOwnerRequest("session", "generation", "updates"),
    );
    publisher.publish({
      state: "degraded",
      observedAt: 10,
      staleAt: 20,
      expiresAt: 30,
      payload: { coverage: "partial", available: 1, gitNotChecked: 2 },
    });
    publisher.publish({
      state: "degraded",
      observedAt: 40,
      staleAt: 50,
      expiresAt: 60,
      payload: { coverage: "failed", failed: 1 },
    });

    expect(snapshots.at(-2)).toMatchObject({
      observedAt: 10,
      staleAt: 20,
      expiresAt: 30,
      payload: { coverage: "partial", gitNotChecked: 2 },
    });
    expect(snapshots.at(-1)).toMatchObject({
      state: "degraded",
      payload: { coverage: "failed", failed: 1 },
    });
    expect(snapshots.at(-1)?.payload).not.toHaveProperty("available");
    publisher.dispose();
  });

  test("accepts validated immutable update details and rejects invalid or equal versions", () => {
    const updates = [
      { name: "@acme/pkg", current: "1.0.0-rc.1", latest: "1.0.0", scope: "project" as const },
    ];
    const parsed = readUpdateCoverage({ coverage: "complete", available: 1, updates });
    expect(parsed?.updates).toEqual(updates);
    expect(Object.isFrozen(parsed?.updates)).toBe(true);
    expect(
      readUpdateCoverage({
        coverage: "complete",
        available: 1,
        updates: [{ name: "pkg", current: "1.0.0", latest: "2.0.0" }],
      }),
    ).toBeUndefined();
    expect(
      readUpdateCoverage({
        coverage: "complete",
        available: 1,
        updates: [{ name: "pkg", current: "1.0.0", latest: "1.0.0", scope: "user" }],
      }),
    ).toBeUndefined();
    expect(
      readUpdateCoverage({
        coverage: "complete",
        available: 1,
        updates: [{ name: "pkg\\nBAD", current: "1.0.0", latest: "2.0.0", scope: "user" }],
      }),
    ).toBeUndefined();
    expect(
      readUpdateCoverage({
        coverage: "complete",
        available: 1,
        updates: Array.from({ length: 101 }, () => ({
          name: "p",
          current: "1.0.0",
          latest: "2.0.0",
          scope: "user",
        })),
      }),
    ).toBeUndefined();
  });

  test("offers only complete, current, fully listed updates", () => {
    const snapshot: StartupOwnerSnapshot = {
      type: "reply",
      schemaVersion: 1,
      sessionId: "session",
      generationId: "generation",
      ownerId: "updates",
      ownerRevision: 1,
      state: "ready",
      staleAt: 20,
      expiresAt: 30,
      payload: {
        coverage: "complete",
        available: 1,
        updates: [{ name: "pkg", current: "1.0.0", latest: "2.0.0", scope: "project" }],
      },
    };

    expect(readAvailableUpdates(snapshot, 10)).toEqual([
      { name: "pkg", current: "1.0.0", latest: "2.0.0", scope: "project" },
    ]);
    expect(readAvailableUpdates(snapshot, 20)).toBeUndefined();
    expect(readAvailableUpdates(snapshot, 30)).toBeUndefined();
    expect(
      readAvailableUpdates(
        {
          ...snapshot,
          payload: {
            coverage: "partial",
            available: 2,
            updates: [{ name: "pkg", current: "1.0.0", latest: "2.0.0", scope: "project" }],
          },
        },
        10,
      ),
    ).toBeUndefined();
  });

  test("rejects malformed or unqualified zero coverage", () => {
    expect(readUpdateCoverage({ coverage: "partial", available: -1 })).toBeUndefined();
    expect(readUpdateCoverage({ coverage: "unknown", available: 0 })).toBeUndefined();
    expect(readUpdateCoverage({ available: 0 })).toBeUndefined();
  });
});
