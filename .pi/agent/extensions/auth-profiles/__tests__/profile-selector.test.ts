import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexUsageLimitResetAt, selectProfile } from "../profile-selector";
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

function usage(profiles: Array<{ profileLabel: string; remaining?: number }>): UsageStatusPayload {
  return {
    schema: "fbb.pi-auth-profiles-usage/v1",
    profiles: profiles.map(({ profileLabel, remaining }) => ({
      profileLabel,
      active: false,
      urgency: "unknown",
      usage: remaining === undefined ? [] : [{ remaining }],
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

  test("does not override an explicit trusted project profile", async () => {
    const { agentDir, projectDir } = await fixture({
      hostDefaults: { "rvn-pc": ["fbb", "jpb"] },
    });
    await writeFile(join(projectDir, ".pi", "settings.json"), '{"authProfile":"ct"}\n');
    let collectedUsage = false;

    const selection = await selectProfile(
      { cwd: projectDir, isProjectTrusted: () => true },
      {
        agentDir,
        env: {},
        hostname: () => "rvn-pc",
        platform: "linux",
        usageCollector: async () => {
          collectedUsage = true;
          return usage([]);
        },
      },
    );

    expect(selection).toMatchObject({ profile: "ct", profileOrder: ["ct"], source: "project" });
    expect(collectedUsage).toBe(false);
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

  test("ignores rate limits without confirmed quota exhaustion", () => {
    expect(codexUsageLimitResetAt({ "retry-after": "30" }, 1_000_000)).toBeUndefined();
    expect(
      codexUsageLimitResetAt({ "x-codex-primary-used-percent": "99.9" }, 1_000_000),
    ).toBeUndefined();
  });
});
