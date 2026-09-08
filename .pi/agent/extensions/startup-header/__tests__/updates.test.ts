import { describe, expect, test } from "bun:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../contracts";
import { installUpdateStartupPublisher, readUpdateCoverage } from "../updates";

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

  test("rejects malformed or unqualified zero coverage", () => {
    expect(readUpdateCoverage({ coverage: "partial", available: -1 })).toBeUndefined();
    expect(readUpdateCoverage({ coverage: "unknown", available: 0 })).toBeUndefined();
    expect(readUpdateCoverage({ available: 0 })).toBeUndefined();
  });
});
