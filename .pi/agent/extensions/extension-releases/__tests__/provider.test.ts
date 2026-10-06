import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  readStartupOwnerSnapshot,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../../startup-header/contracts";
import extensionReleases, {
  type PreparedCheck,
  type ReleaseCheckDependencies,
  readReleaseCache,
  writeReleaseCache,
} from "../index";
import { createReleasePlan, RELEASE_CACHE_TTL_MS, type ReleaseCoverage } from "../release-check";

function makePrepared(fingerprint = "source-a", cacheFile?: string): PreparedCheck {
  return {
    cwd: "/tmp/project",
    ...(cacheFile === undefined ? {} : { cacheFile }),
    fingerprint,
    npmCommand: ["npm"],
    plan: createReleasePlan([{ source: "npm:checked@1.0.0", scope: "user" }]),
  };
}

function makeHarness(dependencies: ReleaseCheckDependencies) {
  const lifecycle = new Map<string, ((event: unknown, context: ExtensionContext) => void)[]>();
  const events = createEventBus();
  const pi = {
    events,
    on(event: string, handler: (event: unknown, context: ExtensionContext) => void) {
      const handlers = lifecycle.get(event) ?? [];
      handlers.push(handler);
      lifecycle.set(event, handlers);
    },
  } as unknown as ExtensionAPI;
  extensionReleases(pi, dependencies);
  return {
    events,
    scheduled: [] as (() => void)[],
    start(sessionId: string) {
      for (const handler of lifecycle.get("session_start") ?? []) {
        handler({}, {
          mode: "tui",
          cwd: "/tmp/project",
          isProjectTrusted: () => true,
          sessionManager: { getSessionId: () => sessionId },
        } as unknown as ExtensionContext);
      }
    },
    shutdown() {
      for (const handler of lifecycle.get("session_shutdown") ?? [])
        handler({}, {} as ExtensionContext);
    },
    request(sessionId: string, generationId: string) {
      events.emit(
        STARTUP_OWNER_REQUEST_EVENT,
        createStartupOwnerRequest(sessionId, generationId, "updates"),
      );
    },
  };
}

function waitForReply(
  events: ReturnType<typeof createEventBus>,
  sessionId: string,
  generationId: string,
): Promise<StartupOwnerSnapshot> {
  return new Promise((resolve) => {
    const unsubscribe = events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      const snapshot = readStartupOwnerSnapshot(value);
      if (
        snapshot?.ownerId === "updates" &&
        snapshot.type === "reply" &&
        snapshot.sessionId === sessionId &&
        snapshot.generationId === generationId
      ) {
        unsubscribe();
        resolve(snapshot);
      }
    });
  });
}

function waitForCoverage(
  events: ReturnType<typeof createEventBus>,
  predicate: (value: unknown) => boolean = () => true,
): Promise<unknown> {
  return new Promise((resolve) => {
    const unsubscribe = events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => {
      const snapshot = readStartupOwnerSnapshot(value);
      if (
        snapshot?.ownerId === "updates" &&
        snapshot.type === "change" &&
        predicate(snapshot.payload)
      ) {
        unsubscribe();
        resolve(snapshot.payload);
      }
    });
  });
}

describe("extension release-check provider", () => {
  test("reuses a fresh cache without querying npm", async () => {
    const cached: ReleaseCoverage = {
      coverage: "complete",
      available: 0,
      observedAt: 1_000,
      staleAt: 1_000 + RELEASE_CACHE_TTL_MS,
      expiresAt: 1_000 + 2 * RELEASE_CACHE_TTL_MS,
    };
    let queries = 0;
    const scheduled: (() => void)[] = [];
    const dependencies: ReleaseCheckDependencies = {
      prepare: () => makePrepared(),
      readCache: () => cached,
      writeCache: () => {},
      queryLatest: async () => {
        queries += 1;
        return "2.0.0";
      },
      now: () => 2_000,
      schedule: (callback) => scheduled.push(callback),
    };
    const harness = makeHarness(dependencies);
    const result = waitForCoverage(harness.events);
    harness.request("session-a", "generation-a");
    harness.start("session-a");
    scheduled[0]?.();

    await expect(result).resolves.toMatchObject({ coverage: "complete", available: 0 });
    expect(queries).toBe(0);
    harness.shutdown();
  });

  test("retains completed coverage across generations without replying across sessions", async () => {
    const cached: ReleaseCoverage = {
      coverage: "complete",
      available: 1,
      observedAt: 1_000,
      staleAt: 1_000 + RELEASE_CACHE_TTL_MS,
      expiresAt: 1_000 + 2 * RELEASE_CACHE_TTL_MS,
    };
    const scheduled: (() => void)[] = [];
    let queries = 0;
    const dependencies: ReleaseCheckDependencies = {
      prepare: () => makePrepared(),
      readCache: () => cached,
      writeCache: () => {},
      queryLatest: async () => {
        queries += 1;
        return "2.0.0";
      },
      now: () => 2_000,
      schedule: (callback) => scheduled.push(callback),
    };
    const harness = makeHarness(dependencies);
    harness.start("session-a");
    scheduled[0]?.();

    const firstReply = waitForReply(harness.events, "session-a", "generation-a");
    harness.request("session-a", "generation-a");
    await expect(firstReply).resolves.toMatchObject({
      state: "ready",
      payload: { coverage: "complete", available: 1 },
    });

    const wrongSessionReply = waitForReply(harness.events, "session-b", "generation-b");
    harness.request("session-b", "generation-b");
    await expect(wrongSessionReply).resolves.toMatchObject({ state: "unavailable" });

    const nextGenerationReply = waitForReply(harness.events, "session-a", "generation-c");
    harness.request("session-a", "generation-c");
    await expect(nextGenerationReply).resolves.toMatchObject({
      state: "ready",
      payload: { coverage: "complete", available: 1 },
    });
    expect(queries).toBe(0);

    harness.start("session-b");
    const replacementReply = waitForReply(harness.events, "session-b", "generation-d");
    harness.request("session-b", "generation-d");
    await expect(replacementReply).resolves.toMatchObject({ state: "unavailable" });
    harness.shutdown();
  });

  test("does not publish results completed after session replacement", async () => {
    const scheduled: (() => void)[] = [];
    let resolveFirst: ((value: string) => void) | undefined;
    let firstQueryStarted: (() => void) | undefined;
    const queryStarted = new Promise<void>((resolve) => {
      firstQueryStarted = resolve;
    });
    let calls = 0;
    const dependencies: ReleaseCheckDependencies = {
      prepare: () => makePrepared(),
      readCache: () => undefined,
      writeCache: () => {},
      queryLatest: async (_prepared, _name, signal) => {
        calls += 1;
        if (calls === 1) {
          firstQueryStarted?.();
          return await new Promise<string>((resolve) => {
            resolveFirst = resolve;
          });
        }
        expect(signal.aborted).toBe(false);
        return "2.0.0";
      },
      now: () => 2_000,
      schedule: (callback) => scheduled.push(callback),
    };
    const harness = makeHarness(dependencies);
    const result = waitForCoverage(harness.events);
    harness.start("session-a");
    harness.request("session-a", "generation-a");
    expect(calls).toBe(0);
    scheduled[0]?.();
    await queryStarted;

    harness.start("session-b");
    harness.request("session-b", "generation-b");
    resolveFirst?.("9.0.0");
    await Promise.resolve();
    await Promise.resolve();
    scheduled[1]?.();

    await expect(result).resolves.toMatchObject({ coverage: "complete", available: 1 });
    expect(calls).toBe(2);
    harness.shutdown();
  });

  test("does not cache a failed registry check or publish it as zero updates", async () => {
    const scheduled: (() => void)[] = [];
    let writes = 0;
    const dependencies: ReleaseCheckDependencies = {
      prepare: () => makePrepared(),
      readCache: () => undefined,
      writeCache: () => {
        writes += 1;
      },
      queryLatest: async () => {
        throw new Error("registry unavailable");
      },
      now: () => 2_000,
      schedule: (callback) => scheduled.push(callback),
    };
    const harness = makeHarness(dependencies);
    const result = waitForCoverage(harness.events);
    harness.start("session-a");
    harness.request("session-a", "generation-a");
    scheduled[0]?.();

    await expect(result).resolves.toMatchObject({ coverage: "failed", failed: 1 });
    expect(writes).toBe(0);
    harness.shutdown();
  });

  test("persists completed observations and invalidates cache when the source fingerprint changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-extension-releases-"));
    try {
      const cacheFile = join(directory, "cache.json");
      const prepared = makePrepared("source-a", cacheFile);
      const observedAt = Date.now();
      const coverage: ReleaseCoverage = {
        coverage: "complete",
        available: 1,
        updates: [{ name: "checked", current: "1.0.0", latest: "2.0.0", scope: "user" }],
        observedAt,
        staleAt: observedAt + RELEASE_CACHE_TTL_MS,
        expiresAt: observedAt + 2 * RELEASE_CACHE_TTL_MS,
      };
      writeReleaseCache(prepared, coverage);

      expect(readReleaseCache(prepared, observedAt + 1)).toMatchObject({
        coverage: "complete",
        available: 1,
        updates: [{ name: "checked", current: "1.0.0", latest: "2.0.0" }],
      });
      const changedSource = makePrepared("source-b", cacheFile);
      expect(readReleaseCache(changedSource, observedAt + 1)).toBeUndefined();
      writeReleaseCache(changedSource, { ...coverage, available: 1 });
      expect(readReleaseCache(prepared, observedAt + 1)).toMatchObject({ available: 1 });
      expect(readReleaseCache(changedSource, observedAt + 1)).toMatchObject({ available: 1 });
      expect(readReleaseCache(prepared, observedAt + RELEASE_CACHE_TTL_MS)).toBeUndefined();
      expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toMatchObject({
        schemaVersion: 3,
        entries: { "source-a": { coverage: { coverage: "complete" } } },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
