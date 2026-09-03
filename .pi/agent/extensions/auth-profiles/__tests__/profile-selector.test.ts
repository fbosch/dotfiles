import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexUsageLimitResetAt,
  codexUsageLimitResetAtFromMessage,
  selectProfile,
} from "../profile-selector";
import type { UsageStatusPayload } from "../usage-status-service";

const temporaryDirectories: string[] = [];

async function fixture(config: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "pi-profile-selector-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "auth-profiles.json"), `${JSON.stringify(config)}\n`);
  return { agentDir, projectDir };
}

async function writeCredential(
  path: string,
  credential: { access: string; accountId: string; expires: number },
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: credential.access,
        refresh: "test-refresh-token",
        expires: credential.expires,
        accountId: credential.accountId,
      },
    })}\n`,
  );
}

function usage(
  profiles: Array<{ profileLabel: string; remaining?: number; resetCredits?: number }>,
): UsageStatusPayload {
  return {
    schema: "fbb.pi-auth-profiles-usage/v1",
    profiles: profiles.map(({ profileLabel, remaining, resetCredits }) => ({
      profileLabel,
      active: false,
      urgency: "unknown",
      usage: remaining === undefined ? [] : [{ remaining }],
      ...(resetCredits === undefined ? {} : { availableCount: resetCredits }),
    })),
    diagnostics: [],
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("automatic auth profile selection", () => {
  test("chooses the first ordered profile with confirmed remaining usage", async () => {
    const { agentDir, projectDir } = await fixture({
      defaultProfile: "ct",
      hostDefaults: { "rvn-pc": ["fbb", "jpb", "ct"] },
    });

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async (options) => {
          expect(options.profileLabels).toEqual(["fbb", "jpb", "ct", "default"]);
          expect(options.includeResetCredits).toBe(false);
          return usage([
            { profileLabel: "fbb", remaining: 0 },
            { profileLabel: "jpb", remaining: 40 },
            { profileLabel: "ct", remaining: 80 },
          ]);
        },
      },
    );

    expect(selection).toMatchObject({
      profile: "jpb",
      profileOrder: ["fbb", "jpb", "ct", "default"],
      fallbackFrom: "fbb",
      fallbackReason: "confirmed usage",
      source: "host default",
    });
  });

  test("refreshes an expired alternate before selecting it", async () => {
    const currentTime = Date.now();
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb"] },
    });
    const profilesDir = join(agentDir, "auth-profiles");
    await mkdir(profilesDir);
    await writeCredential(join(profilesDir, "fbb.json"), {
      access: "fbb-access-token",
      accountId: "account-fbb",
      expires: currentTime + 60_000,
    });
    await writeCredential(join(profilesDir, "jpb.json"), {
      access: "expired-jpb-access-token",
      accountId: "account-jpb",
      expires: currentTime - 1,
    });

    const refreshedProfiles: string[] = [];
    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        cachePath: join(agentDir, "usage-cache.json"),
        env: {},
        fetchFn: async (_input, init) => {
          const accountId = new Headers(init?.headers).get("ChatGPT-Account-Id");
          return Response.json({
            rate_limit: {
              primary_window: {
                used_percent: accountId === "account-fbb" ? 100 : 20,
                reset_after_seconds: 60,
              },
              secondary_window: null,
            },
          });
        },
        forceUsageRefresh: true,
        hostname: () => "rvn-pc",
        now: () => currentTime,
        platform: "linux",
        refreshCredential: async ({ expectedAccountId, profileLabel }) => {
          expect(expectedAccountId).toBe("account-jpb");
          refreshedProfiles.push(profileLabel);
          await writeCredential(join(profilesDir, "jpb.json"), {
            access: "refreshed-jpb-access-token",
            accountId: "account-jpb",
            expires: currentTime + 60_000,
          });
        },
      },
    );

    expect(refreshedProfiles).toEqual(["jpb"]);
    expect(selection).toMatchObject({
      profile: "jpb",
      fallbackFrom: "fbb",
      fallbackReason: "confirmed usage",
    });
  });

  test("skips missing credentials and preserves a valid profile when usage is unavailable", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb"] },
    });

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async () => usage([{ profileLabel: "jpb" }]),
      },
    );

    expect(selection).toMatchObject({
      profile: "jpb",
      fallbackFrom: "fbb",
      fallbackReason: "credential availability",
    });
  });

  test("ignores the retired project-level profile setting", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb"] },
    });
    await writeFile(join(projectDir, ".pi", "settings.json"), '{"authProfile":"ct"}\n');

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => true },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async () =>
          usage([
            { profileLabel: "fbb", remaining: 0 },
            { profileLabel: "jpb", remaining: 60 },
          ]),
      },
    );

    expect(selection).toMatchObject({
      profile: "jpb",
      profileOrder: ["fbb", "jpb", "default"],
      source: "host default",
    });
  });

  test("uses a session preference as the starting point but skips it at zero quota", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb", "ct"] },
    });

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        preferredProfile: "jpb",
        usageCollector: async (options) => {
          expect(options.includeResetCredits).toBe(false);
          expect(options.profileLabels).toEqual(["jpb", "ct", "default", "fbb"]);
          return usage([
            { profileLabel: "jpb", remaining: 0, resetCredits: 2 },
            { profileLabel: "ct", remaining: 70 },
            { profileLabel: "fbb", remaining: 90 },
          ]);
        },
      },
    );

    expect(selection).toMatchObject({
      profile: "ct",
      profileOrder: ["jpb", "ct", "default", "fbb"],
      fallbackFrom: "jpb",
      fallbackReason: "confirmed usage",
      source: "session",
    });
  });

  test("does not use an unconfirmed fallback after observing zero quota", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb"] },
    });

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async () =>
          usage([{ profileLabel: "fbb", remaining: 0, resetCredits: 1 }, { profileLabel: "jpb" }]),
      },
    );

    expect(selection).toMatchObject({
      profile: "fbb",
      selectionWarning: "fbb is exhausted; no alternate profile has confirmed usage",
    });
    expect(selection.fallbackReason).toBeUndefined();
  });

  test("requires confirmed usage when rotating away from an exhausted profile", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb", "ct"] },
    });

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => false },
      {
        agentDir,
        allowUnconfirmedFallback: false,
        env: {},
        excludedProfiles: new Set(["fbb"]),
        forceUsageRefresh: true,
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async (options) => {
          expect(options.forceUsageRefresh).toBe(true);
          return usage([
            { profileLabel: "jpb", remaining: 0 },
            { profileLabel: "ct", remaining: 60 },
          ]);
        },
      },
    );

    expect(selection).toMatchObject({
      profile: "ct",
      fallbackFrom: "fbb",
      fallbackReason: "confirmed usage",
    });
  });
});

describe("Codex usage-limit headers", () => {
  test("uses the latest exhausted-window reset", () => {
    expect(
      codexUsageLimitResetAt(
        {
          "X-Codex-Primary-Reset-After-Seconds": "30",
          "X-Codex-Primary-Used-Percent": "100",
          "x-codex-secondary-reset-at": "1120",
          "x-codex-secondary-used-percent": "100",
        },
        1_000_000,
      ),
    ).toBe(1_120_000);
  });

  test("recognizes Pi's body-derived Codex usage-limit message", () => {
    expect(
      codexUsageLimitResetAtFromMessage(
        "You have hit your ChatGPT usage limit (plus plan). Try again in ~30 min.",
        1_000_000,
      ),
    ).toBe(1_060_000);
    expect(codexUsageLimitResetAtFromMessage("Too many requests", 1_000_000)).toBeUndefined();
  });

  test("ignores rate limits without confirmed quota exhaustion", () => {
    expect(codexUsageLimitResetAt({ "retry-after": "30" }, 1_000_000)).toBeUndefined();
    expect(
      codexUsageLimitResetAt({ "x-codex-primary-used-percent": "99.9" }, 1_000_000),
    ).toBeUndefined();
  });
});
