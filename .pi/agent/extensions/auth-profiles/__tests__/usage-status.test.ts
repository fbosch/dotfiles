import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUsageStatus, usageFromPayload } from "../usage-status";

const temporaryDirectories: string[] = [];
const now = Date.parse("2026-09-02T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

async function writeCredential(
  path: string,
  credential: { access: string; accountId: string },
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: credential.access,
        refresh: "test-refresh-token",
        expires: now + 60 * 60 * 1_000,
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
    const projectDir = join(root, "project");
    const cachePath = join(root, "cache", "usage.json");
    await mkdir(profilesDir, { recursive: true });
    await mkdir(join(projectDir, ".pi"), { recursive: true });
    await writeCredential(join(agentDir, "auth.json"), {
      access: "default-access-token",
      accountId: "account-default",
    });
    await writeCredential(join(profilesDir, "work.json"), {
      access: "work-access-token",
      accountId: "account-work",
    });
    await writeFile(join(projectDir, ".pi", "settings.json"), '{"authProfile":"work"}\n');

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
      agentDir,
      cachePath,
      cwd: projectDir,
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
      agentDir,
      cachePath,
      cwd: projectDir,
      fetchFn: async () => {
        cacheMiss = true;
        throw new Error("unexpected network request");
      },
      now: () => now + 5_000,
    });
    expect(cacheMiss).toBe(false);
    expect(cached).toEqual(payload);
    expect(JSON.parse(await readFile(cachePath, "utf8")).schema).toBe(
      "fbb.pi-auth-profiles-usage-cache/v1",
    );
  });

  test("rejects malformed usage windows", () => {
    expect(() => usageFromPayload({ rate_limit: null })).toThrow(
      "usage response has an unexpected shape",
    );
    expect(
      usageFromPayload({
        rate_limit: {
          primary_window: { used_percent: 101, reset_after_seconds: 30 },
          secondary_window: null,
        },
      }),
    ).toEqual({ windows: [] });
  });
});
