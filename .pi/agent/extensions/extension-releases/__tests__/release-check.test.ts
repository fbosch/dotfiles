import { describe, expect, test } from "bun:test";
import {
  checkReleases,
  compareSemver,
  createReleasePlan,
  isFreshCoverage,
  RELEASE_CACHE_TTL_MS,
  type ReleasePackageDeclaration,
} from "../release-check";

const signal = new AbortController().signal;

function declaration(
  source: string,
  scope: "user" | "project" = "user",
  overrides: Partial<ReleasePackageDeclaration> = {},
): ReleasePackageDeclaration {
  return { source, scope, ...overrides };
}

describe("available extension releases", () => {
  test("counts newer pinned npm releases and treats an equal latest version as current", async () => {
    const plan = createReleasePlan([
      declaration("npm:@acme/extension@1.2.3"),
      declaration("npm:stable-extension@2.0.0"),
    ]);
    const coverage = await checkReleases(
      plan,
      async (name) => (name === "@acme/extension" ? "1.3.0" : "2.0.0"),
      { signal, now: 1_000 },
    );

    expect(coverage).toMatchObject({
      coverage: "complete",
      available: 1,
      updates: [{ name: "@acme/extension", current: "1.2.3", latest: "1.3.0", scope: "user" }],
    });
    expect(coverage.staleAt).toBe(1_000 + RELEASE_CACHE_TTL_MS);
    expect(coverage.expiresAt).toBe(1_000 + 2 * RELEASE_CACHE_TTL_MS);
    expect(compareSemver("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
  });

  test("deduplicates npm package identity across scopes and honors explicit extension filters", () => {
    const plan = createReleasePlan([
      declaration("npm:@acme/tool@1.0.0", "user"),
      declaration("npm:@acme/tool@1.1.0", "project"),
      declaration("npm:disabled@1.0.0", "user", { extensions: [] }),
      declaration("npm:skills-only@1.0.0", "user", { autoload: false }),
      declaration("./local-extension", "user"),
    ]);

    expect(plan.npm).toEqual([
      { name: "@acme/tool", source: "npm:@acme/tool@1.1.0", scope: "project", baseline: "1.1.0" },
    ]);
  });

  test("applies project autoload-false extension deltas over the user package", async () => {
    const user = declaration("npm:shared@1.0.0", "user", {
      installedVersion: "3.0.0",
      autoload: false,
      extensions: ["+extensions/main.js"],
    });
    const skillsOnly = createReleasePlan([
      user,
      declaration("npm:shared@1.0.0", "project", {
        autoload: false,
        skills: ["skills/assistant/SKILL.md"],
      }),
    ]);
    expect(skillsOnly.npm).toEqual([
      { name: "shared", source: "npm:shared@1.0.0", scope: "user", baseline: "3.0.0" },
    ]);
    await expect(
      checkReleases(skillsOnly, async () => "4.0.0", { signal, now: 1_500 }),
    ).resolves.toMatchObject({ coverage: "complete", available: 1 });

    const disabled = createReleasePlan([
      user,
      declaration("npm:shared@1.0.0", "project", {
        autoload: false,
        extensions: ["-extensions/main.js"],
      }),
    ]);
    expect(disabled).toEqual({ npm: [], gitNotChecked: 0, unsupported: 0 });

    const enabled = createReleasePlan([
      declaration("npm:shared@1.0.0", "user", {
        installedVersion: "3.0.0",
        autoload: false,
        extensions: ["-extensions/main.js"],
      }),
      declaration("npm:shared@1.0.0", "project", {
        autoload: false,
        extensions: ["+extensions/main.js"],
      }),
    ]);
    expect(enabled.npm).toEqual([
      { name: "shared", source: "npm:shared@1.0.0", scope: "user", baseline: "3.0.0" },
    ]);

    const uncertainDisable = createReleasePlan([
      declaration("npm:default-filter@1.0.0", "user"),
      declaration("npm:default-filter@1.0.0", "project", {
        autoload: false,
        extensions: ["-extensions/**/*.js"],
      }),
    ]);
    await expect(
      checkReleases(uncertainDisable, async () => "1.0.0", { signal, now: 1_600 }),
    ).resolves.toMatchObject({ coverage: "partial", available: 0, unsupported: 1 });
  });

  test("prefers installed versions, falls back to npm pins, and reports Git coverage as partial", async () => {
    const plan = createReleasePlan([
      declaration("npm:unpinned", "user", { installedVersion: "3.0.0" }),
      declaration("npm:pinned@1.0.0", "user", { installedVersion: "2.0.0" }),
      declaration("https://github.com/acme/extension.git", "user"),
      declaration("git:github.com/acme/extension@v1", "project"),
    ]);
    expect(plan.npm.map(({ name, baseline }) => [name, baseline])).toEqual([
      ["unpinned", "3.0.0"],
      ["pinned", "2.0.0"],
    ]);
    const coverage = await checkReleases(
      plan,
      async (name) => (name === "pinned" ? "1.9.0" : "3.0.0"),
      { signal, now: 2_000 },
    );

    expect(coverage).toMatchObject({ coverage: "partial", available: 0, gitNotChecked: 1 });
  });

  test("keeps failed npm queries distinct from complete zero and preserves partial findings", async () => {
    const plan = createReleasePlan([
      declaration("npm:one@1.0.0"),
      declaration("npm:two@1.0.0"),
      declaration("git:github.com/acme/unsupported"),
    ]);
    const partial = await checkReleases(
      plan,
      async (name) => {
        if (name === "one") return "2.0.0";
        throw new Error("registry unavailable");
      },
      { signal, now: 3_000 },
    );
    expect(partial).toMatchObject({
      coverage: "partial",
      available: 1,
      failed: 1,
      gitNotChecked: 1,
    });

    const failed = await checkReleases(
      plan,
      async () => {
        throw new Error("registry unavailable");
      },
      { signal, now: 4_000 },
    );
    expect(failed).toMatchObject({ coverage: "failed", failed: 2, gitNotChecked: 1 });
    expect(failed).not.toHaveProperty("available");
  });

  test("bounds concurrent npm release queries", async () => {
    const plan = createReleasePlan(
      ["one", "two", "three", "four", "five"].map((name) => declaration(`npm:${name}@1.0.0`)),
    );
    let active = 0;
    let maxActive = 0;
    await checkReleases(
      plan,
      async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return "1.0.0";
      },
      { signal, now: 5_000 },
    );
    expect(maxActive).toBe(3);
  });

  test("validates cache freshness and never reuses expired results", () => {
    const coverage = {
      coverage: "complete" as const,
      available: 0,
      observedAt: 10,
      staleAt: 20,
      expiresAt: 30,
    };
    expect(isFreshCoverage(coverage, 19)).toBe(true);
    expect(isFreshCoverage(coverage, 20)).toBe(false);
    expect(isFreshCoverage({ ...coverage, available: -1 }, 19)).toBe(false);
  });
});
