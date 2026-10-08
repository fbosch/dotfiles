import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverJustRecipes, executeJustRecipe } from "../index";

const pi: Pick<ExtensionAPI, "exec"> = {
  async exec(command, args, options) {
    const child = Bun.spawn([command, ...args], {
      ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code, killed: false };
  },
};

async function worktree(check: (cwd: string) => Promise<void>): Promise<void> {
  const container = await mkdtemp(join(tmpdir(), "pi-just-discovery-"));
  const cwd = join(container, "worktree");
  try {
    await mkdir(cwd);
    await writeFile(join(container, "justfile"), "outside:\n");
    await writeFile(join(cwd, ".git"), "gitdir: ../metadata\n");
    await check(cwd);
  } finally {
    await rm(container, { recursive: true, force: true });
  }
}

test("discovery does not load a Justfile from outside the worktree", async () => {
  await worktree(async (cwd) => {
    expect(await discoverJustRecipes(pi, cwd)).toEqual([]);
  });
});

test("default executor uses the same discovery boundary without running a recipe", async () => {
  await worktree(async (cwd) => {
    const result = await executeJustRecipe(cwd, ["--no-dotenv", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no justfile found/i);
  });
});

for (const name of ["justfile", "Justfile", ".justfile"]) {
  test(`discovers the worktree's ${name}`, async () => {
    await worktree(async (cwd) => {
      await writeFile(join(cwd, name), "inside:\n");
      expect((await discoverJustRecipes(pi, cwd)).map((recipe) => recipe.namepath)).toEqual([
        "inside",
      ]);
    });
  });
}

test("invalid worktree Justfiles remain errors rather than empty catalogs", async () => {
  await worktree(async (cwd) => {
    await writeFile(join(cwd, "justfile"), "invalid syntax !\n");
    await expect(discoverJustRecipes(pi, cwd)).rejects.toThrow("Could not inspect Just recipes");
  });
});

test("permission failures remain errors rather than empty catalogs", async () => {
  const denied: Pick<ExtensionAPI, "exec"> = {
    async exec() {
      return { stdout: "", stderr: "Operation not permitted (os error 1)", code: 1, killed: false };
    },
  };
  await worktree(async (cwd) => {
    await expect(discoverJustRecipes(denied, cwd)).rejects.toThrow("Operation not permitted");
  });
});

test("a symlink cwd cannot bypass the canonical discovery ceiling", async () => {
  await worktree(async (cwd) => {
    const alias = join(cwd, "..", "cwd-alias");
    await symlink(cwd, alias);
    expect(await discoverJustRecipes(pi, alias)).toEqual([]);
    const result = await executeJustRecipe(alias, ["--no-dotenv", "--json"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no justfile found/i);
  });
});
