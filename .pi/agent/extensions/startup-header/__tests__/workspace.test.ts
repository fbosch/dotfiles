import { describe, expect, test } from "bun:test";
import { type GitReader, inspectWorkspace } from "../workspace";

function gitReader(options: {
  root?: string;
  gitDir?: string;
  commonDir?: string;
  branch?: string;
  fail?: boolean;
}): GitReader {
  return async (_cwd, args) => {
    if (options.fail) throw new Error("inspection failed");
    if (args.includes("--show-toplevel")) return `${options.root ?? "/repo"}\n`;
    if (args.includes("--git-common-dir")) {
      return `${options.gitDir ?? "/repo/.git"}\n${options.commonDir ?? "/repo/.git"}\n`;
    }
    if (args.includes("symbolic-ref")) {
      if (options.branch === undefined) throw { code: 1 };
      return `${options.branch}\n`;
    }
    throw new Error("unexpected Git command");
  };
}

describe("workspace inspection", () => {
  test("distinguishes ordinary and linked worktrees using common-dir metadata", async () => {
    await expect(inspectWorkspace("/repo", gitReader({ branch: "main" }))).resolves.toEqual({
      branch: "main",
      detached: false,
      root: "/repo",
      linkedWorktree: false,
    });
    await expect(
      inspectWorkspace(
        "/worktrees/topic",
        gitReader({
          root: "/worktrees/topic",
          gitDir: "/repo/.git/worktrees/topic",
          commonDir: "/repo/.git",
          branch: "topic",
        }),
      ),
    ).resolves.toEqual({
      branch: "topic",
      detached: false,
      root: "/worktrees/topic",
      linkedWorktree: true,
    });
  });

  test("keeps submodules and separate gitdirs distinct from linked worktrees", async () => {
    for (const directory of ["/parent/.git/modules/submodule", "/gitdirs/project"]) {
      await expect(
        inspectWorkspace(
          "/workspace",
          gitReader({
            root: "/workspace",
            gitDir: directory,
            commonDir: directory,
            branch: "main",
          }),
        ),
      ).resolves.toMatchObject({ linkedWorktree: false });
    }
  });

  test("represents detached heads and omits non-Git or malformed inspections", async () => {
    await expect(inspectWorkspace("/repo", gitReader({}))).resolves.toEqual({
      detached: true,
      root: "/repo",
      linkedWorktree: false,
    });
    await expect(inspectWorkspace("/tmp", gitReader({ fail: true }))).resolves.toBeUndefined();
    await expect(
      inspectWorkspace("/tmp", async (_cwd, args) =>
        args.includes("--show-toplevel") ? "/repo\n" : "missing\n",
      ),
    ).resolves.toBeUndefined();
  });
});
