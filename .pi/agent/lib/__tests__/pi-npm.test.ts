import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";

setDefaultTimeout(20_000);

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
const fffPatch = `diff --git a/node_modules/@ff-labs/pi-fff/example.txt b/node_modules/@ff-labs/pi-fff/example.txt
index 3367afd..5ea2ed4 100644
--- a/node_modules/@ff-labs/pi-fff/example.txt
+++ b/node_modules/@ff-labs/pi-fff/example.txt
@@ -1 +1 @@
-original
+patched
`;
const lensPatch = `diff --git a/node_modules/pi-lens/example.txt b/node_modules/pi-lens/example.txt
index 3367afd..5ea2ed4 100644
--- a/node_modules/pi-lens/example.txt
+++ b/node_modules/pi-lens/example.txt
@@ -1 +1 @@
-original
+patched
`;
const newFilePatch = `diff --git a/node_modules/pi-worktrunk/generated.txt b/node_modules/pi-worktrunk/generated.txt
new file mode 100644
index 0000000..fa7af8c
--- /dev/null
+++ b/node_modules/pi-worktrunk/generated.txt
@@ -0,0 +1 @@
+created
`;
let directory: string;
let agent: string;
let install: string;
let example: string;
let manifest: string;
let fffExample: string;
let fffManifest: string;
let lensExample: string;
let lensManifest: string;
let targetRows: string[];

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function addTargetRow(
  packageName: string,
  patchFilename: string,
  path: string,
  before: string | null,
  after: string | null,
): void {
  targetRows.push(
    ["package", packageName, patchFilename, path, before ?? "-", after ?? "-"].join("\t"),
  );
  writeFileSync(
    join(agent, "patches/targets.tsv"),
    `# test target manifest\n${targetRows.join("\n")}\n`,
  );
}

function removeTargetRows(patchFilename: string): void {
  targetRows = targetRows.filter((row) => row.split("\t")[2] !== patchFilename);
  writeFileSync(
    join(agent, "patches/targets.tsv"),
    `# test target manifest\n${targetRows.join("\n")}\n`,
  );
}

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
  fffManifest = join(install, "node_modules/@ff-labs/pi-fff/package.json");
  fffExample = join(install, "node_modules/@ff-labs/pi-fff/example.txt");
  lensManifest = join(install, "node_modules/pi-lens/package.json");
  lensExample = join(install, "node_modules/pi-lens/example.txt");
  mkdirSync(join(agent, "lib"), { recursive: true });
  mkdirSync(join(agent, "patches"));
  targetRows = [];
  mkdirSync(join(agent, "node_modules"));
  mkdirSync(join(install, "node_modules/pi-worktrunk"), { recursive: true });
  mkdirSync(join(install, "node_modules/@ff-labs/pi-fff"), { recursive: true });
  mkdirSync(join(install, "node_modules/pi-lens"), { recursive: true });
  mkdirSync(join(directory, "bin"));
  cpSync(join(sourceRoot, "lib/pi-npm.ts"), join(agent, "lib/pi-npm.ts"));
  cpSync(join(sourceRoot, "lib/patch-catalog.ts"), join(agent, "lib/patch-catalog.ts"));
  cpSync(join(sourceRoot, "lib/patch-targets.ts"), join(agent, "lib/patch-targets.ts"));
  symlinkSync(
    join(sourceRoot, "node_modules/patch-package"),
    join(agent, "node_modules/patch-package"),
  );
  writeFileSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"), patch);
  writeFileSync(join(agent, "patches/@ff-labs+pi-fff+0.11.0.patch"), fffPatch);
  writeFileSync(join(agent, "patches/pi-lens+4.3.0.patch"), lensPatch);
  writeFileSync(join(install, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  writeFileSync(manifest, JSON.stringify({ name: "pi-worktrunk", version: "0.8.0" }));
  writeFileSync(example, "original\n");
  writeFileSync(fffManifest, JSON.stringify({ name: "@ff-labs/pi-fff", version: "0.11.0" }));
  writeFileSync(fffExample, "original\n");
  writeFileSync(lensManifest, JSON.stringify({ name: "pi-lens", version: "4.3.0" }));
  writeFileSync(lensExample, "original\n");
  addTargetRow(
    "pi-worktrunk",
    "pi-worktrunk+0.8.0.patch",
    "example.txt",
    digest("original\n"),
    digest("patched\n"),
  );
  addTargetRow(
    "@ff-labs/pi-fff",
    "@ff-labs+pi-fff+0.11.0.patch",
    "example.txt",
    digest("original\n"),
    digest("patched\n"),
  );
  addTargetRow(
    "pi-lens",
    "pi-lens+4.3.0.patch",
    "example.txt",
    digest("original\n"),
    digest("patched\n"),
  );
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
      expect(readFileSync(fffExample, "utf8")).toBe("patched\n");
      expect(readFileSync(lensExample, "utf8")).toBe("patched\n");
    }
  });

  test("resolves symlinked install roots before passing a relative patch directory", () => {
    mkdirSync(join(directory, "links/nested"), { recursive: true });
    const link = join(directory, "links/nested/npm");
    symlinkSync(install, link);
    expect(run(["--apply-patches", link]).exitCode).toBe(0);
    expect(readFileSync(example, "utf8")).toBe("patched\n");
    expect(readFileSync(fffExample, "utf8")).toBe("patched\n");
  });

  test("accepts reviewed target content across installed package versions", () => {
    writeFileSync(manifest, JSON.stringify({ name: "pi-worktrunk", version: "0.9.0" }));
    writeFileSync(fffManifest, JSON.stringify({ name: "@ff-labs/pi-fff", version: "0.12.0" }));
    writeFileSync(lensManifest, JSON.stringify({ name: "pi-lens", version: "5.0.0" }));
    expect(run(["--apply-patches", install]).exitCode).toBe(0);
    expect(readFileSync(example, "utf8")).toBe("patched\n");
    expect(readFileSync(fffExample, "utf8")).toBe("patched\n");
    expect(readFileSync(lensExample, "utf8")).toBe("patched\n");
  });

  test("rejects a changed patch payload before mutating installed targets", () => {
    writeFileSync(
      join(agent, "patches/pi-worktrunk+0.8.0.patch"),
      patch.replace("+patched", "+different"),
    );
    const result = run(["--apply-patches", install]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("did not produce the reviewed postimage");
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("rejects changed target content at the same dependency version before any mutation", () => {
    writeFileSync(example, "changed\n");
    const result = run(["--apply-patches", install]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("does not match a reviewed preimage or postimage");
    expect(readFileSync(example, "utf8")).toBe("changed\n");
    expect(readFileSync(fffExample, "utf8")).toBe("original\n");
    expect(readFileSync(lensExample, "utf8")).toBe("original\n");
  });

  test("requires a new-file target to be absent, then remains idempotent", () => {
    writeFileSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"), `${patch}${newFilePatch}`);
    addTargetRow(
      "pi-worktrunk",
      "pi-worktrunk+0.8.0.patch",
      "generated.txt",
      null,
      digest("created\n"),
    );
    const generated = join(install, "node_modules/pi-worktrunk/generated.txt");
    writeFileSync(generated, "pre-existing\n");
    expect(run(["--apply-patches", install]).exitCode).toBe(1);
    expect(readFileSync(example, "utf8")).toBe("original\n");
    expect(readFileSync(generated, "utf8")).toBe("pre-existing\n");

    rmSync(generated);
    expect(run(["--apply-patches", install]).exitCode).toBe(0);
    expect(readFileSync(generated, "utf8")).toBe("created\n");
    expect(run(["--apply-patches", install]).exitCode).toBe(0);
  });

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

  test("keeps explicit --apply-patches strict and transactional on multi-file conflict", () => {
    writeFileSync(join(install, "node_modules/pi-worktrunk/second.txt"), "unexpected\n");
    addTargetRow(
      "pi-worktrunk",
      "pi-worktrunk+0.8.0.patch",
      "second.txt",
      digest("original\n"),
      digest("patched\n"),
    );
    writeFileSync(
      join(agent, "patches/pi-worktrunk+0.8.0.patch"),
      `${patch}${patch.replaceAll("example.txt", "second.txt")}`,
    );
    const result = run(["--apply-patches", install]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).not.toContain("Pi will launch with unpatched packages");
    expect(readFileSync(example, "utf8")).toBe("original\n");
  });

  test("uses the patch directory as the package inventory", () => {
    rmSync(join(agent, "patches/pi-worktrunk+0.8.0.patch"));
    removeTargetRows("pi-worktrunk+0.8.0.patch");

    expect(run(["--apply-patches", install]).exitCode).toBe(0);
    expect(readFileSync(example, "utf8")).toBe("original\n");
    expect(readFileSync(fffExample, "utf8")).toBe("patched\n");
  });

  test("applies a valid patch added without changing the runner", () => {
    const packageDir = join(install, "node_modules/extra-package");
    const packageExample = join(packageDir, "example.txt");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, "package.json"),
      JSON.stringify({ name: "extra-package", version: "1.2.3" }),
    );
    writeFileSync(packageExample, "original\n");
    writeFileSync(
      join(agent, "patches/extra-package+1.2.3.patch"),
      patch.replaceAll("pi-worktrunk", "extra-package"),
    );
    addTargetRow(
      "extra-package",
      "extra-package+1.2.3.patch",
      "example.txt",
      digest("original\n"),
      digest("patched\n"),
    );

    expect(run(["--apply-patches", install]).exitCode).toBe(0);
    expect(readFileSync(packageExample, "utf8")).toBe("patched\n");
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
    const args = JSON.parse(result.stdout.toString()) as string[];
    expect(args).toEqual(["--patch-dir", "../patches", "--error-on-fail", "--error-on-warn"]);
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
    expect(readFileSync(fffExample, "utf8")).toBe("patched\n");
  });

  test("accepts a changed installed version when target content matches the reviewed preimage", () => {
    const result = run(["install", "pi-worktrunk@0.9.0", "--prefix", install], {
      TEST_INSTALLED_VERSION: "0.9.0",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("npm stdout");
    expect(result.stderr.toString()).not.toContain("Pi will launch with unpatched packages");
    expect(JSON.parse(readFileSync(join(directory, "npm-args.json"), "utf8"))).toEqual([
      "--save-exact",
      "install",
      "pi-worktrunk@0.9.0",
      "--prefix",
      install,
    ]);
    expect(readFileSync(example, "utf8")).toBe("patched\n");
  });

  test("falls back when a post-install patch conflicts", () => {
    writeFileSync(join(install, "node_modules/pi-worktrunk/second.txt"), "unexpected\n");
    addTargetRow(
      "pi-worktrunk",
      "pi-worktrunk+0.8.0.patch",
      "second.txt",
      digest("original\n"),
      digest("patched\n"),
    );
    writeFileSync(
      join(agent, "patches/pi-worktrunk+0.8.0.patch"),
      `${patch}${patch.replaceAll("example.txt", "second.txt")}`,
    );
    const result = run(["install", "other-package", "--prefix", install]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain("Pi will launch with unpatched packages");
    expect(result.stderr.toString()).toContain(
      "patches must be reviewed and target hashes updated",
    );
    expect(readFileSync(example, "utf8")).toBe("original\n");
    expect(readFileSync(join(install, "node_modules/pi-worktrunk/second.txt"), "utf8")).toBe(
      "unexpected\n",
    );
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
    const result = run(["install", "other", "--prefix", install]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain("Pi will launch with unpatched packages");
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
