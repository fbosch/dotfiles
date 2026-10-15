import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GitRunner,
  readAuthProfilesConfig,
  repositoryNameFromOrigin,
  resolveHostIdentity,
  resolveProfile,
  resolveRepositoryIdentity,
} from "../profile-resolver";

const temporaryDirectories: string[] = [];

async function temporaryFixture(config?: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), "pi-profile-resolver-"));
  temporaryDirectories.push(root);
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  await mkdir(join(projectDir, ".pi"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  if (config !== undefined) {
    await writeFile(join(agentDir, "auth-profiles.json"), `${JSON.stringify(config)}\n`);
  }
  return { agentDir, projectDir };
}

function gitRepository(root: string, origin = "git@github.com:fbb/dotfiles.git"): GitRunner {
  return async (_cwd, args) => {
    if (args.join(" ") === "rev-parse --show-toplevel") return root;
    if (args.join(" ") === "remote get-url origin") return origin;
    return undefined;
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("auth profile precedence", () => {
  test("resolves repository and host profiles without project-level pins", async () => {
    const { agentDir, projectDir } = await temporaryFixture({
      defaultProfile: "ct",
      hostDefaults: { "rvn-pc": ["fbb", "jpb", "ct"] },
      repositoryPreferences: { dotfiles: ["jpb", "fbb"] },
    });
    const options = {
      agentDir,
      env: {},
      hostname: () => "rvn-pc",
      platform: "linux" as NodeJS.Platform,
      runGit: gitRepository(projectDir),
    };
    const trusted = { cwd: projectDir, isProjectTrusted: () => true };

    await writeFile(join(projectDir, ".pi", "settings.json"), '{"authProfile":"ct"}\n');
    const repositoryResolution = await resolveProfile(trusted, options);
    expect(repositoryResolution).toMatchObject({
      profile: "jpb",
      source: "repository",
      repository: { name: "dotfiles", source: "origin" },
      repositoryPreferences: ["jpb", "fbb"],
      profileOrder: ["jpb", "fbb", "ct", "default"],
    });
    expect(existsSync(join(agentDir, "auth-profiles", "jpb.json"))).toBe(false);

    let ranGit = false;
    expect(
      await resolveProfile(
        { cwd: projectDir, isProjectTrusted: () => false },
        {
          ...options,
          runGit: async () => {
            ranGit = true;
            return undefined;
          },
        },
      ),
    ).toMatchObject({
      profile: "fbb",
      profileOrder: ["fbb", "jpb", "ct", "default"],
      source: "host default",
    });
    expect(ranGit).toBe(false);
  });

  test("selects GitHub source preferences and honors exact repository preferences", async () => {
    const { agentDir, projectDir } = await temporaryFixture({
      repositoryPreferences: { pinned: ["ct"] },
      repositorySources: [
        {
          host: "github.com",
          owner: "fbosch",
          repository: ["new-repo", "pinned"],
          profiles: ["fbb", "jpb"],
        },
        {
          host: "github.com",
          owner: "charlietango",
          repository: "*",
          profiles: ["ct", "fbb", "jpb"],
        },
      ],
    });
    const context = { cwd: projectDir, isProjectTrusted: () => true };
    const resolveOrigin = (origin: string) =>
      resolveProfile(context, {
        agentDir,
        env: {},
        runGit: gitRepository(projectDir, origin),
      });

    expect(await resolveOrigin("git@github.com:fbosch/new-repo.git")).toMatchObject({
      profile: "fbb",
      source: "repository",
      repositoryPreferences: ["fbb", "jpb"],
      repository: {
        sourceIdentity: {
          host: "github.com",
          owner: "fbosch",
          repository: "new-repo",
        },
      },
    });
    expect(await resolveOrigin("https://github.com/fbosch/unlisted.git")).toMatchObject({
      source: "built-in default",
      repositoryPreferences: [],
    });
    expect(await resolveOrigin("https://github.com/charlietango/another-repo.git")).toMatchObject({
      profile: "ct",
      repositoryPreferences: ["ct", "fbb", "jpb"],
    });
    expect(await resolveOrigin("https://github.com/fbosch/pinned.git")).toMatchObject({
      profile: "ct",
      repositoryPreferences: ["ct"],
    });
    expect(await resolveOrigin("https://example.com/fbosch/new-repo.git")).toMatchObject({
      source: "built-in default",
      repositoryPreferences: [],
    });
  });

  test("matches Azure organization rules from HTTPS and SSH origins", async () => {
    const { agentDir, projectDir } = await temporaryFixture({
      repositorySources: [
        {
          host: "dev.azure.com",
          organization: "KommuneKredit",
          repository: "*",
          profiles: ["kk", "ct"],
        },
      ],
    });
    const context = { cwd: projectDir, isProjectTrusted: () => true };
    const resolveOrigin = (origin: string) =>
      resolveProfile(context, {
        agentDir,
        env: {},
        runGit: gitRepository(projectDir, origin),
      });

    expect(
      await resolveOrigin(
        "https://KommuneKredit@dev.azure.com/KommuneKredit/Frontend/_git/ui.git",
      ),
    ).toMatchObject({
      profile: "kk",
      repository: {
        sourceIdentity: {
          host: "dev.azure.com",
          organization: "kommunekredit",
          repository: "ui",
        },
      },
    });
    expect(
      await resolveOrigin("git@ssh.dev.azure.com:v3/KommuneKredit/Frontend/cli"),
    ).toMatchObject({
      profile: "kk",
      repository: {
        sourceIdentity: {
          host: "dev.azure.com",
          organization: "kommunekredit",
          repository: "cli",
        },
      },
    });
  });


  test("falls back from an unknown host to the global and built-in defaults", async () => {
    const configured = await temporaryFixture({ defaultProfile: "ct" });
    const context = { cwd: configured.projectDir, isProjectTrusted: () => false };
    const host = {
      env: {},
      hostname: () => "unmapped-host",
      platform: "linux" as NodeJS.Platform,
    };

    expect(await resolveProfile(context, { ...host, agentDir: configured.agentDir })).toMatchObject(
      {
        profile: "ct",
        source: "global default",
      },
    );

    const empty = await temporaryFixture();
    expect(
      await resolveProfile(
        { cwd: empty.projectDir, isProjectTrusted: () => false },
        { ...host, agentDir: empty.agentDir },
      ),
    ).toMatchObject({ profile: "default", source: "built-in default" });
  });
});

describe("profile routing identities", () => {
  test("uses the Darwin host key before the MDM-managed hostname", () => {
    expect(
      resolveHostIdentity({
        env: { NH_DARWIN_HOST: "kmd-mac" },
        hostname: () => "mdm-assigned-name",
        platform: "darwin",
      }),
    ).toEqual({ name: "kmd-mac", source: "NH_DARWIN_HOST" });
  });

  test("derives repository names from common origins and worktree fallback", async () => {
    expect(repositoryNameFromOrigin("https://github.com/org/my%20repo.git")).toBe("my repo");
    expect(repositoryNameFromOrigin("git@github.com:org/dotfiles.git")).toBe("dotfiles");

    const root = "/work/nixos-feature";
    const repository = await resolveRepositoryIdentity(root, async (_cwd, args) => {
      if (args.join(" ") === "rev-parse --show-toplevel") return root;
      return undefined;
    });
    expect(repository).toEqual({ name: "nixos-feature", root, source: "worktree" });
  });
});

describe("auth profile configuration", () => {
  test("normalizes host keys and preserves ordered profile preferences", async () => {
    const { agentDir } = await temporaryFixture({
      defaultProfile: "ct",
      hostDefaults: { "RVN-PC": ["fbb", "jpb", "ct"] },
      repositoryPreferences: { dotfiles: ["fbb", "jpb"] },
      repositorySources: [
        {
          host: "GITHUB.COM",
          owner: "FBosch",
          repository: ["DotFiles", "NIXOS"],
          profiles: ["fbb", "jpb"],
        },
      ],
    });

    expect(readAuthProfilesConfig(agentDir)).toEqual({
      defaultProfile: "ct",
      hostDefaults: { "rvn-pc": ["fbb", "jpb", "ct"] },
      repositoryPreferences: { dotfiles: ["fbb", "jpb"] },
      repositorySources: [
        {
          host: "github.com",
          owner: "fbosch",
          repository: ["dotfiles", "nixos"],
          profiles: ["fbb", "jpb"],
        },
      ],
    });
  });

  test("accepts the previous scalar host-default form", async () => {
    const { agentDir } = await temporaryFixture({ hostDefaults: { "rvn-pc": "fbb" } });

    expect(readAuthProfilesConfig(agentDir).hostDefaults).toEqual({ "rvn-pc": ["fbb"] });
  });

  test("handles prototype-like mapping keys as ordinary data", async () => {
    const config = JSON.parse(
      '{"hostDefaults":{"constructor":["fbb"]},"repositoryPreferences":{"__proto__":["jpb"]}}',
    ) as Record<string, unknown>;
    const { agentDir } = await temporaryFixture(config);
    const parsed = readAuthProfilesConfig(agentDir);

    expect(Object.entries(parsed.hostDefaults)).toContainEqual(["constructor", ["fbb"]]);
    expect(Object.entries(parsed.repositoryPreferences)).toContainEqual(["__proto__", ["jpb"]]);
  });

  test("rejects duplicate repository preferences", async () => {
    const { agentDir } = await temporaryFixture({
      repositoryPreferences: { dotfiles: ["fbb", "fbb"] },
    });

    expect(() => readAuthProfilesConfig(agentDir)).toThrow(
      "repositoryPreferences.dotfiles contains duplicate profiles",
    );
  });

  test("rejects repository source rules without exactly one namespace", async () => {
    const { agentDir } = await temporaryFixture({
      repositorySources: [{ host: "github.com", repository: "*", profiles: ["fbb"] }],
    });

    expect(() => readAuthProfilesConfig(agentDir)).toThrow(
      "repositorySources[0] must specify exactly one of owner or organization",
    );
  });
});
