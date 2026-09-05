import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceRoot = resolve(import.meta.dir, "../..");
const patch = `diff --git a/node_modules/pi-worktrunk/example.txt b/node_modules/pi-worktrunk/example.txt
index 3367afd..5ea2ed4 100644
--- a/node_modules/pi-worktrunk/example.txt
+++ b/node_modules/pi-worktrunk/example.txt
@@ -1 +1 @@
-original
+patched
`;
let directory: string;
let agent: string;
let install: string;
let example: string;
let manifest: string;

function run(args: string[], env: Record<string, string> = {}) {
  return Bun.spawnSync([process.execPath, join(agent, "lib/pi-npm.ts"), ...args], {
    cwd: directory,
    env: { ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}`, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pi-npm-test-"));
  agent = join(directory, "agent config");
  install = join(directory, "managed npm");
  manifest = join(install, "node_modules/pi-worktrunk/package.json");
  example = join(install, "node_modules/pi-worktrunk/example.txt");
  mkdirSync(join(agent, "lib"), { recursive: true });
  mkdirSync(join(agent, "patches"));
  mkdirSync(join(agent, "node_modules"));
  mkdirSync(join(install, "node_modules/pi-worktrunk"), { recursive: true });
  mkdirSync(join(directory, "bin"));
  cpSync(join(sourceRoot, "lib/pi-npm.ts"), join(agent, "lib/pi-npm.ts"));
  symlinkSync(
    join(sourceRoot, "node_modules/patch-package"),
    join(agent, "node_modules/patch-package"),
  );
  writeFileSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"), patch);
  writeFileSync(join(install, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  writeFileSync(manifest, JSON.stringify({ name: "pi-worktrunk", version: "0.8.0" }));
  writeFileSync(example, "original\n");
  writeFileSync(
    join(directory, "bin/npm"),
    `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(directory, "npm-args.json"))}, JSON.stringify(process.argv.slice(2)));
console.log('npm stdout');
console.error('npm stderr');
if (process.env.TEST_INSTALLED_VERSION) writeFileSync(${JSON.stringify(manifest)}, JSON.stringify({name:'pi-worktrunk',version:process.env.TEST_INSTALLED_VERSION}));
process.exit(Number(process.env.TEST_NPM_STATUS ?? 0));
`,
    { mode: 0o755 },
  );
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("tracked Pi package patches", () => {
  test("applies with the real patch-package and is idempotent", () => {
    for (let count = 0; count < 2; count++) {
      const result = run(["--apply-patches", install]);
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(readFileSync(example, "utf8")).toBe("patched\n");
    }
  });

  test("resolves symlinked install roots before passing a relative patch directory", () => {
    mkdirSync(join(directory, "links/nested"), { recursive: true });
    const link = join(directory, "links/nested/npm");
    symlinkSync(install, link);
    expect(run(["--apply-patches", link]).exitCode).toBe(0);
    expect(readFileSync(example, "utf8")).toBe("patched\n");
  });

  test.each(["0.7.0", "0.8.1", "0.8.0-beta", "^0.8.0"])(
    "rejects %s before writing anything",
    (version) => {
      writeFileSync(manifest, JSON.stringify({ name: "pi-worktrunk", version }));
      const result = run(["--apply-patches", install]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("requires exactly 0.8.0");
      expect(readFileSync(example, "utf8")).toBe("original\n");
    },
  );

  test("fails on a missing package or malformed manifest", () => {
    rmSync(manifest);
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
    writeFileSync(manifest, "null");
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
  });

  test.each(["", " \n", "not a patch", "diff --git a/example b/example\n"])(
    "rejects empty and no-diff patches: %j",
    (contents) => {
      writeFileSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"), contents);
      const result = run(["--apply-patches", install]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("contains no textual changes");
      expect(readFileSync(example, "utf8")).toBe("original\n");
    },
  );

  test("fails when a patch target file is missing", () => {
    rmSync(example);
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
  });

  test("does not partly apply a conflicting patch", () => {
    writeFileSync(join(install, "node_modules/pi-worktrunk/second.txt"), "unexpected\n");
    writeFileSync(
      join(agent, "patches/pi-worktrunk+0.8.0.patch"),
      `${patch}${patch.replaceAll("example.txt", "second.txt")}`,
    );
    const result = run(["--apply-patches", install]);
    expect(result.exitCode).toBe(1);
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("refuses missing or unreviewed patch files", () => {
    rmSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"));
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
    writeFileSync(join(agent, "patches/pi-worktrunk+0.8.1.patch"), patch);
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("passes strict flags only and propagates patch-package failures", () => {
    rmSync(join(agent, "node_modules/patch-package"));
    mkdirSync(join(agent, "node_modules/patch-package"));
    writeFileSync(
      join(agent, "node_modules/patch-package/index.js"),
      `console.log(JSON.stringify(process.argv.slice(2))); process.exit(17);`,
    );
    const result = run(["--apply-patches", install]);
    expect(result.exitCode).toBe(17);
    expect(JSON.parse(result.stdout.toString())).toEqual([
      "--patch-dir",
      "../agent config/patches",
      "--error-on-fail",
      "--error-on-warn",
    ]);
  });
});

describe("Pi npmCommand wrapper", () => {
  test.each(["install", "ci", "update"])("reapplies after npm %s", (command) => {
    const args = [
      command,
      ...(command === "install" ? ["pi-worktrunk@0.8.0"] : []),
      "--prefix",
      install,
      "--legacy-peer-deps",
    ];
    const result = run(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("npm stdout");
    expect(result.stderr.toString()).toContain("npm stderr");
    expect(JSON.parse(readFileSync(join(directory, "npm-args.json"), "utf8"))).toEqual([
      "--save-exact",
      ...args,
    ]);
    expect(readFileSync(example, "utf8")).toBe("patched\n");
  });

  test("rejects requested upgrades before invoking npm", () => {
    const result = run(["install", "pi-worktrunk@0.9.0", "--prefix", install]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout.toString()).toBe("");
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("checks the installed version again after npm finishes", () => {
    const result = run(["install", "other-package", `--prefix=${install}`], {
      TEST_INSTALLED_VERSION: "0.9.0",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("requires exactly 0.8.0");
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("preserves npm failure status without applying patches", () => {
    const result = run(["install", "--prefix", install], { TEST_NPM_STATUS: "23" });
    expect(result.exitCode).toBe(23);
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test.each([
    { args: ["view", "pi-worktrunk", "version", "--json"] },
    { args: ["install", "--dry-run"] },
    { args: ["install", "-g"] },
  ])("does not patch for %j", ({ args }) => {
    const result = run([...args, "--prefix", install]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("npm stdout\n");
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("unrelated installs and removal work without Worktrunk", () => {
    rmSync(join(install, "node_modules/pi-worktrunk"), { recursive: true });
    expect(run(["uninstall", "pi-worktrunk", "--prefix", install]).exitCode).toBe(0);
    expect(run(["install", "other", "--prefix", install]).exitCode).toBe(0);
    writeFileSync(
      join(install, "package.json"),
      JSON.stringify({ dependencies: { "pi-worktrunk": "0.8.0" } }),
    );
    expect(run(["install", "other", "--prefix", install]).exitCode).toBe(1);
  });

  test("settings launcher forwards arguments without shell interpretation", () => {
    const { npmCommand } = JSON.parse(readFileSync(join(sourceRoot, "settings.json"), "utf8"));
    const result = Bun.spawnSync([...npmCommand, "view", "literal;echo INJECTED", "--json"], {
      cwd: directory,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: agent,
        PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(directory, "npm-args.json"), "utf8"))).toEqual([
      "--save-exact",
      "view",
      "literal;echo INJECTED",
      "--json",
    ]);
    expect(result.stdout.toString()).toBe("npm stdout\n");
  });
});
