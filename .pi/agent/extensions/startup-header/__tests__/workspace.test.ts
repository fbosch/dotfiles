import { describe, expect, test } from "bun:test";
import { type GitReader, inspectWorkspace } from "../workspace";

function gitReader(options: {
  root?: string;
  gitDir?: string;
  commonDir?: string;
  branch?: string;
  fail?: boolean;
}): GitReader {
  return async () => {
    if (options.fail) throw new Error("inspection failed");
    return [
      options.root ?? "/repo",
      options.gitDir ?? "/repo/.git",
      options.commonDir ?? "/repo/.git",
      options.branch ?? "HEAD",
      "",
    ].join("\n");
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
