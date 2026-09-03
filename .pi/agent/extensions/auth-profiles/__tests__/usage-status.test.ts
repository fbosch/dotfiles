import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileProviderAdapter } from "../provider-adapter";
import { createOpenAiCodexProfileAdapter } from "../providers/openai-codex";
import { collectUsageStatus, usageFromPayload } from "../usage-status";

const temporaryDirectories: string[] = [];
const now = Date.parse("2026-09-02T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function writeCredential(
  path: string,
  credential: { access: string; accountId: string; expires?: number },
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: credential.access,
        refresh: "test-refresh-token",
        expires: credential.expires ?? now + 60 * 60 * 1_000,
        accountId: credential.accountId,
      },
    })}\n`,
    { mode: 0o600 },
  );
}

function usageResponse(usedPercent: number, availableCount: number): Response {
  return Response.json({
    rate_limit: {
      primary_window: {
        used_percent: usedPercent,
        reset_after_seconds: 3 * 60 * 60,
      },
      secondary_window: null,
    },
    rate_limit_reset_credits: { available_count: availableCount },
  });
}

function resetCreditsResponse(availableCount: number, expiresAt: string): Response {
  return Response.json({
    available_count: availableCount,
    credits: [
      {
        id: "credit",
        status: "available",
        expires_at: expiresAt,
      },
    ],
  });
}

describe("auth profile usage status", () => {
  test("reports named Pi profiles without exposing credentials and reuses the cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-usage-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const profilesDir = join(agentDir, "auth-profiles");
    const cachePath = join(root, "cache", "usage.json");
    await mkdir(profilesDir, { recursive: true });
    await writeCredential(join(agentDir, "auth.json"), {
      access: "default-access-token",
      accountId: "account-default",
    });
    await writeCredential(join(profilesDir, "work.json"), {
      access: "work-access-token",
      accountId: "account-work",
    });
    const requestedTokens: string[] = [];
    const fetchFn = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "") ?? "";
      requestedTokens.push(token);
      const isUsage = String(input).endsWith("/usage");
      if (token !== "work-access-token") throw new Error("unexpected profile request");
      return isUsage
        ? usageResponse(57, 2)
        : resetCreditsResponse(2, new Date(now + 6 * 60 * 60 * 1_000).toISOString());
    };

    const payload = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath,
      fetchFn,
      now: () => now,
    });

    expect(payload).toEqual({
      schema: "fbb.pi-auth-profiles-usage/v1",
      profiles: [
        {
          profileLabel: "work",
          active: true,
          availableCount: 2,
          urgency: "urgent",
          usage: [{ remaining: 43, resetsIn: "3h" }],
        },
      ],
      diagnostics: [],
    });
    expect(requestedTokens).toEqual(["work-access-token", "work-access-token"]);
    expect(payload.profiles.some((profile) => profile.profileLabel === "default")).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("access-token");
    expect(JSON.stringify(payload)).not.toContain("account-work");
    expect((await stat(cachePath)).mode & 0o777).toBe(0o600);

    let cacheMiss = false;
    const cached = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath,
      fetchFn: async () => {
        cacheMiss = true;
        throw new Error("unexpected network request");
      },
      now: () => now + 5_000,
    });
    expect(cacheMiss).toBe(false);
    expect(cached).toEqual(payload);

    const inactive = await collectUsageStatus({
      activeProfile: "default",
      agentDir,
      cachePath,
      fetchFn: async () => {
        throw new Error("unexpected network request");
      },
      now: () => now + 5_000,
    });
    expect(inactive.profiles[0]?.active).toBe(false);
    expect(JSON.parse(await readFile(cachePath, "utf8")).schema).toBe(
      "fbb.pi-auth-profiles-usage-cache/v2",
    );
  });

  test("refreshes instead of using a partially malformed cached snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-malformed-cache-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const cachePath = join(root, "usage.json");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    await writeCredential(join(agentDir, "auth-profiles", "work.json"), {
      access: "work-access-token",
      accountId: "account-work",
    });
    const credentialKey = createHash("sha256")
      .update("openai-codex")
      .update("\0")
      .update("account-work")
      .digest("hex");
    await writeFile(
      cachePath,
      JSON.stringify({
        schema: "fbb.pi-auth-profiles-usage-cache/v2",
        accounts: {
          [credentialKey]: {
            credentialKey,
            usage: { windows: [{ remaining: 0 }, { remaining: 101 }] },
            usageCheckedAt: now,
          },
        },
      }),
    );
    let requestCount = 0;

    const payload = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath,
      includeResetCredits: false,
      fetchFn: async () => {
        requestCount += 1;
        return usageResponse(20, 0);
      },
      now: () => now + 1_000,
    });

    expect(requestCount).toBe(1);
    expect(payload.profiles[0]?.usage).toEqual([{ remaining: 80, resetsIn: "3h" }]);
    expect(payload.diagnostics).toEqual([]);
  });

  test("refreshes an expired profile before requesting its usage", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-refresh-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const credentialPath = join(agentDir, "auth-profiles", "work.json");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    await writeCredential(credentialPath, {
      access: "expired-access-token",
      accountId: "account-work",
      expires: now - 1,
    });

    const refreshes: string[] = [];
    const payload = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath: join(root, "cache.json"),
      fetchFn: async (_input, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer refreshed-access-token",
        );
        return usageResponse(25, 0);
      },
      includeResetCredits: false,
      now: () => now,
      providerAdapter: createOpenAiCodexProfileAdapter(agentDir, {
        createRuntime: async (credentials) => ({
          async getAuth() {
            refreshes.push("work");
            await credentials.modify("openai-codex", async () => ({
              type: "oauth",
              access: "refreshed-access-token",
              refresh: "rotated-refresh-token",
              expires: now + 60 * 60 * 1_000,
              accountId: "account-work",
            }));
            return { auth: { apiKey: "refreshed-access-token" } };
          },
        }),
        now: () => now,
      }),
    });

    expect(refreshes).toEqual(["work"]);
    expect(payload.profiles[0]).toMatchObject({
      profileLabel: "work",
      usage: [{ remaining: 75 }],
    });
    expect(payload.diagnostics).toEqual([]);
  });

  test("skips an expired profile when its credential refresh fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-refresh-failure-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "auth-profiles"), { recursive: true });
    await writeCredential(join(agentDir, "auth-profiles", "work.json"), {
      access: "expired-access-token",
      accountId: "account-work",
      expires: now - 1,
    });

    let requestedUsage = false;
    const payload = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath: join(root, "cache.json"),
      fetchFn: async () => {
        requestedUsage = true;
        return usageResponse(25, 0);
      },
      includeResetCredits: false,
      now: () => now,
      providerAdapter: createOpenAiCodexProfileAdapter(agentDir, {
        createRuntime: async () => ({
          async getAuth() {
            throw new Error("refresh failed");
          },
        }),
        now: () => now,
      }),
    });

    expect(requestedUsage).toBe(false);
    expect(payload.profiles).toEqual([]);
    expect(payload.diagnostics).toContainEqual({
      profileLabel: "work",
      code: "credential-refresh-failed",
    });
  });

  test("returns live usage when the cache cannot be written", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-auth-profile-cache-failure-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    const profilesDir = join(agentDir, "auth-profiles");
    await mkdir(profilesDir, { recursive: true });
    await writeCredential(join(profilesDir, "work.json"), {
      access: "work-access-token",
      accountId: "account-work",
    });

    const requestedUrls: string[] = [];
    const payload = await collectUsageStatus({
      activeProfile: "work",
      agentDir,
      cachePath: root,
      fetchFn: async (input) => {
        requestedUrls.push(String(input));
        return usageResponse(20, 0);
      },
      includeResetCredits: false,
      now: () => now,
    });

    expect(payload.profiles[0]).toMatchObject({
      active: true,
      profileLabel: "work",
      usage: [{ remaining: 80 }],
    });
    expect(requestedUrls).toEqual(["https://chatgpt.com/backend-api/wham/usage"]);
    expect(payload.diagnostics).toContainEqual({
      profileLabel: "cache",
      code: "usage-cache-write-failed",
    });
  });

  test("collects usage through a provider adapter without provider-specific credential fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-provider-adapter-"));
    temporaryDirectories.push(root);
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
    const credential = {
      accessToken: "future-provider-token",
      expiresAt: 2_000_000,
      identity: "future-tenant",
    };
    const providerAdapter: ProfileProviderAdapter = {
      providerId: "future-provider",
      async createCredentialStore() {
        throw new Error("not used by usage discovery");
      },
      async readCredential() {
        return { kind: "valid", credential };
      },
      async resolveCredential() {
        return credential;
      },
      async refreshCredential() {
        return credential;
      },
      async fetchUsage(receivedCredential) {
        expect(receivedCredential).toEqual(credential);
        return { windows: [{ remaining: 73, resetsIn: "2h" }] };
      },
      usageLimitResetAt: () => undefined,
      usageLimitResetAtFromMessage: () => undefined,
    };

    const result = await collectUsageStatus({
      agentDir,
      cachePath: join(root, "usage-cache.json"),
      includeDefault: true,
      includeResetCredits: false,
      now: () => 1_000_000,
      providerAdapter,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.profiles).toEqual([
      {
        active: true,
        profileLabel: "default",
        urgency: "unknown",
        usage: [{ remaining: 73, resetsIn: "2h" }],
      },
    ]);
  });

  test("rejects malformed usage windows", () => {
    expect(() => usageFromPayload({ rate_limit: null })).toThrow(
      "usage response has an unexpected shape",
    );
    expect(() =>
      usageFromPayload({
        rate_limit: {
          primary_window: { used_percent: 101, reset_after_seconds: 30 },
          secondary_window: { used_percent: 20, reset_after_seconds: 60 },
        },
      }),
    ).toThrow("usage response has an unexpected primary window");
  });
});
