import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const agentRoot = resolve(import.meta.dir, "../..");
const patchPath = resolve(agentRoot, "patches/@juicesharp+rpiv-todo+2.11.0.patch");
const installedPackage = resolve(agentRoot, "npm/node_modules/@juicesharp/rpiv-todo");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the host-typebox patch applies and the todo overlay still renders", async () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "rpiv-todo-patch-"));
  temporaryDirectories.push(fixture);
  const packageDir = resolve(fixture, "node_modules/@juicesharp/rpiv-todo");
  mkdirSync(packageDir, { recursive: true });
  cpSync(installedPackage, packageDir, { recursive: true });
  symlinkSync(
    resolve(agentRoot, "npm/node_modules/@earendil-works"),
    resolve(fixture, "node_modules/@earendil-works"),
    "dir",
  );

  const reverse = Bun.spawnSync(["git", "apply", "--reverse", "--check", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverse.exitCode, reverse.stderr.toString()).toBe(0);
  const reverseApply = Bun.spawnSync(["git", "apply", "--reverse", patchPath], {
    cwd: fixture,
    stderr: "pipe",
  });
  expect(reverseApply.exitCode, reverseApply.stderr.toString()).toBe(0);

  const pristineManifest = JSON.parse(
    readFileSync(resolve(packageDir, "package.json"), "utf8"),
  ) as {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  expect(pristineManifest.peerDependencies.typebox).toBeUndefined();
  expect(pristineManifest.dependencies.typebox).toBe("^1.1.24");
  expect(pristineManifest.dependencies["@juicesharp/rpiv-config"]).toBe("^2.11.0");

  const forward = Bun.spawnSync(["git", "apply", patchPath], { cwd: fixture, stderr: "pipe" });
  expect(forward.exitCode, forward.stderr.toString()).toBe(0);
  const patchedManifest = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
  };
  expect(patchedManifest.peerDependencies.typebox).toBe("*");
  expect(patchedManifest.dependencies.typebox).toBeUndefined();
  expect(patchedManifest.dependencies["@juicesharp/rpiv-config"]).toBe("^2.11.0");

  const { formatOverlayTaskLine } = await import(
    pathToFileURL(resolve(packageDir, "view/format.ts")).href
  );
  const line = formatOverlayTaskLine(
    {
      id: 7,
      subject: "Verify upgraded todo package",
      status: "in_progress",
      activeForm: "testing overlay",
    },
    {
      fg: (_color: string, text: string) => text,
      strikethrough: (text: string) => text,
    },
    true,
  );
  expect(line).toContain("◐ #7 Verify upgraded todo package (testing overlay)");
});
