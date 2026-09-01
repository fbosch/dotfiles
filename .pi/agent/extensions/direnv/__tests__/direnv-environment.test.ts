import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyDirenvEnvironment,
  findProjectDirectory,
  loadDirenvEnvironment,
} from "../direnv-environment";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-direnv-"));
  directories.push(directory);
  await mkdir(join(directory, ".git"));
  return directory;
}

test("finds the repository boundary from a child directory", async () => {
  const project = await temporaryProject();
  const child = join(project, "packages", "app");
  await mkdir(child, { recursive: true });

  expect(findProjectDirectory(child)).toBe(project);
});

test("skips repositories without an envrc without invoking direnv", async () => {
  const project = await temporaryProject();
  let invoked = false;

  const result = await loadDirenvEnvironment(project, project, async () => {
    invoked = true;
    throw new Error("direnv should not run");
  });

  expect(result).toEqual({ status: "missing" });
  expect(invoked).toBe(false);
});

test("loads the nearest envrc inside the repository", async () => {
  const project = await temporaryProject();
  const child = join(project, "packages", "app");
  await mkdir(child, { recursive: true });
  await writeFile(join(project, ".envrc"), "");

  let invokedFrom: string | undefined;
  const result = await loadDirenvEnvironment(child, project, async (directory) => {
    invokedFrom = directory;
    return JSON.stringify({ PATH: "/repo/bin:/usr/bin", REMOVED_VALUE: null });
  });

  expect(invokedFrom).toBe(project);
  expect(result).toEqual({
    status: "loaded",
    environment: { PATH: "/repo/bin:/usr/bin", REMOVED_VALUE: null },
  });
});

test("reports blocked envrcs without loading their environment", async () => {
  const project = await temporaryProject();
  await writeFile(join(project, ".envrc"), "");

  const result = await loadDirenvEnvironment(project, project, async () => {
    throw { stderr: "direnv: error .envrc is blocked" };
  });

  expect(result).toEqual({ status: "blocked" });
});

test("applies exports and removals without mutating the process environment", () => {
  const base = { PATH: "/usr/bin", REMOVED_VALUE: "inherited" };

  expect(
    applyDirenvEnvironment(base, {
      PATH: "/repo/bin:/usr/bin",
      REMOVED_VALUE: null,
      PROJECT_VALUE: "available",
    }),
  ).toEqual({ PATH: "/repo/bin:/usr/bin", PROJECT_VALUE: "available" });
  expect(base).toEqual({ PATH: "/usr/bin", REMOVED_VALUE: "inherited" });
});
