import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createOpenAiCodexProfileAdapter } from "../providers/openai-codex";
import { readUsageStatusForCli, revalidateUsageStatus } from "../usage-status";
import { collectUsageStatus, type UsageStatusPayload } from "../usage-status-service";

const directories: string[] = [];
const now = Date.parse("2026-10-20T10:00:00Z");

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-usage-swr-"));
  directories.push(root);
  const agentDir = join(root, "agent");
  await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
  await writeFile(
    join(agentDir, "auth-profiles", "work.json"),
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "test-access",
        refresh: "test-refresh",
        accountId: basename(root),
        expires: now + 3_600_000,
      },
    }),
  );
  return { agentDir, cachePath: join(root, "usage.json"), now: () => now };
}

function response(input: string | URL, count: number): Response {
  return Response.json(
    String(input).endsWith("/usage")
      ? {
          rate_limit: { primary_window: { used_percent: 20, reset_after_seconds: 3_600 } },
          rate_limit_reset_credits: { available_count: count },
        }
      : {
          available_count: count,
          credits: [{ status: "available", expires_at: "2026-10-22T10:00:00Z" }],
        },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("usage stale-while-revalidate", () => {
  test("returns stale credits before the network completes and publishes refreshed credits", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const gate = deferred<void>();
    const refreshed = deferred<UsageStatusPayload>();
    let returned = false;
    const pending = collectUsageStatus({
      ...options,
      now: () => now + 11_000,
      staleWhileRevalidate: true,
      onRevalidated: refreshed.resolve,
      fetchFn: async (input) => {
        await gate.promise;
        return response(input, 2);
      },
    }).then((status) => {
      returned = true;
      return status;
    });
    try {
      await flush();
      await flush();
      expect(returned).toBe(true);
      expect((await pending).profiles[0]?.availableCount).toBe(3);
    } finally {
      gate.resolve();
      await pending;
    }
    expect((await refreshed.promise).profiles[0]?.availableCount).toBe(2);
    const cached = await collectUsageStatus({ ...options, cacheOnly: true });
    expect(cached.profiles[0]?.availableCount).toBe(2);
  });

  test("reuses fresh data without scheduling a refresh", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    let requests = 0;
    let updates = 0;
    const cached = await collectUsageStatus({
      ...options,
      now: () => now + 5_000,
      staleWhileRevalidate: true,
      onRevalidated: () => {
        updates += 1;
      },
      fetchFn: async () => {
        requests += 1;
        throw new Error("unexpected request");
      },
    });
    await flush();
    expect(cached.profiles[0]?.availableCount).toBe(3);
    expect(requests).toBe(0);
    expect(updates).toBe(0);
  });

  test("coalesces overlapping stale reads and updates both readers", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const gate = deferred<void>();
    const first = deferred<UsageStatusPayload>();
    const second = deferred<UsageStatusPayload>();
    let requests = 0;
    const staleOptions = {
      ...options,
      now: () => now + 11_000,
      staleWhileRevalidate: true,
      fetchFn: async (input: string | URL) => {
        requests += 1;
        await gate.promise;
        return response(input, 2);
      },
    };
    try {
      const cached = await Promise.all([
        collectUsageStatus({ ...staleOptions, onRevalidated: first.resolve }),
        collectUsageStatus({ ...staleOptions, onRevalidated: second.resolve }),
      ]);
      expect(cached.map((status) => status.profiles[0]?.availableCount)).toEqual([3, 3]);
      await flush();
      await flush();
      expect(requests).toBe(1);
    } finally {
      gate.resolve();
    }
    expect((await first.promise).profiles[0]?.availableCount).toBe(2);
    expect((await second.promise).profiles[0]?.availableCount).toBe(2);
    expect(requests).toBe(2);
  });

  test("keeps cached credits when background usage requests fail", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const refreshed = deferred<UsageStatusPayload>();
    const cached = await collectUsageStatus({
      ...options,
      now: () => now + 11_000,
      staleWhileRevalidate: true,
      onRevalidated: refreshed.resolve,
      fetchFn: async () => {
        throw new Error("offline");
      },
    });
    expect(cached.profiles[0]?.availableCount).toBe(3);
    const result = await refreshed.promise;
    expect(result.profiles[0]?.availableCount).toBe(3);
    expect(result.diagnostics).toEqual([{ profileLabel: "work", code: "usage-request-failed" }]);
    expect(
      (await collectUsageStatus({ ...options, cacheOnly: true })).profiles[0]?.availableCount,
    ).toBe(3);
  });

  test("returns a cold placeholder while collecting the first snapshot", async () => {
    const options = await fixture();
    const refreshed = deferred<UsageStatusPayload>();
    const cached = await collectUsageStatus({
      ...options,
      staleWhileRevalidate: true,
      onRevalidated: refreshed.resolve,
      fetchFn: async (input) => response(input, 2),
    });
    expect(cached.profiles[0]?.usage).toEqual([]);
    expect((await refreshed.promise).profiles[0]?.availableCount).toBe(2);
  });

  test("returns CLI data without fetching and schedules only stale data", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    let scheduled = 0;
    const schedule = () => {
      scheduled += 1;
    };
    const fetchFn = async (): Promise<Response> => {
      throw new Error("CLI must not fetch");
    };
    await readUsageStatusForCli({ ...options, fetchFn }, schedule);
    expect(scheduled).toBe(0);
    const cached = await readUsageStatusForCli(
      { ...options, fetchFn, now: () => now + 11_000 },
      schedule,
    );
    expect(cached.profiles[0]?.availableCount).toBe(3);
    expect(scheduled).toBe(1);
  });

  test("coalesces refresh workers and releases their lease after completion", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const gate = deferred<void>();
    let requests = 0;
    const refreshOptions = {
      ...options,
      now: () => now + 11_000,
      fetchFn: async (input: string | URL) => {
        requests += 1;
        await gate.promise;
        return response(input, 2);
      },
    };
    const first = revalidateUsageStatus(refreshOptions);
    try {
      await revalidateUsageStatus(refreshOptions);
      await flush();
      await flush();
      expect(requests).toBe(1);
    } finally {
      gate.resolve();
      await first;
    }
    await revalidateUsageStatus({
      ...options,
      now: () => now + 22_000,
      fetchFn: async (input) => response(input, 1),
    });
    expect(
      (await collectUsageStatus({ ...options, cacheOnly: true })).profiles[0]?.availableCount,
    ).toBe(1);
  });

  test("recovers an expired worker lease", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const lockPath = `${options.cachePath}.refresh.lock`;
    await writeFile(lockPath, "interrupted");
    const expired = new Date(Date.now() - 180_000);
    await utimes(lockPath, expired, expired);
    await revalidateUsageStatus({
      ...options,
      now: () => now + 11_000,
      fetchFn: async (input) => response(input, 2),
    });
    expect(
      (await collectUsageStatus({ ...options, cacheOnly: true })).profiles[0]?.availableCount,
    ).toBe(2);
  });

  test("retains the last good snapshot when credential renewal fails", async () => {
    const options = await fixture();
    await collectUsageStatus({ ...options, fetchFn: async (input) => response(input, 3) });
    const refreshed = deferred<UsageStatusPayload>();
    const cached = await collectUsageStatus({
      ...options,
      now: () => now + 3_600_001,
      staleWhileRevalidate: true,
      onRevalidated: refreshed.resolve,
      providerAdapter: {
        ...createOpenAiCodexProfileAdapter(options.agentDir),
        refreshCredential: async () => {
          throw new Error("offline");
        },
      },
    });
    expect(cached.profiles[0]?.availableCount).toBe(3);
    const update = await refreshed.promise;
    expect(update.profiles[0]?.availableCount).toBe(3);
    expect(update.diagnostics).toEqual([
      { profileLabel: "work", code: "credential-refresh-failed" },
    ]);
    const after = await collectUsageStatus({
      ...options,
      cacheOnly: true,
      now: () => now + 3_600_001,
    });
    expect(after.profiles[0]?.availableCount).toBe(3);
  });
});
