import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const sourceAgent = resolve(import.meta.dir, "../..");
const patchPath = resolve(sourceAgent, "runtime-patches/proper-lockfile-4.1.2.patch");
const sourcePackage = resolve(sourceAgent, "node_modules/proper-lockfile");
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pi-runtime-patch-test-"));
  directories.push(directory);
  const repo = join(directory, "repo");
  const agent = join(directory, "agent");
  const packageRoot = join(agent, "node_modules/proper-lockfile");
  const script = join(repo, ".pi/agent/runtime-patches/apply.sh");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(join(repo, ".pi/agent/patches"), { recursive: true });
  mkdirSync(dirname(packageRoot), { recursive: true });
  cpSync(resolve(sourceAgent, "runtime-patches/apply.sh"), script);
  cpSync(patchPath, join(dirname(script), "proper-lockfile-4.1.2.patch"));
  cpSync(resolve(sourceAgent, "patches/targets.tsv"), join(repo, ".pi/agent/patches/targets.tsv"));
  cpSync(sourcePackage, packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "proper-lockfile", version: "99.0.0" }),
  );
  const reverse = Bun.spawnSync(["git", "apply", "--reverse", patchPath], {
    cwd: agent,
    stderr: "pipe",
  });
  if (reverse.exitCode !== 0) throw new Error(reverse.stderr.toString());
  return { directory, agent, script, target: join(packageRoot, "lib/mtime-precision.js") };
}

function run(script: string, agent: string) {
  return Bun.spawnSync(["bash", script], {
    env: { ...process.env, PI_CODING_AGENT_DIR: agent },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("runtime patch matches reviewed content, ignores version, and is idempotent", () => {
  const target = fixture();
  const first = run(target.script, target.agent);
  expect(first.exitCode, first.stderr.toString()).toBe(0);
  const postimage = readFileSync(target.target, "utf8");
  expect(postimage).toContain("const precisionCache = new WeakMap();");

  writeFileSync(
    join(target.agent, "node_modules/proper-lockfile/package.json"),
    JSON.stringify({ name: "proper-lockfile", version: "1.0.0" }),
  );
  expect(run(target.script, target.agent).exitCode).toBe(0);
  expect(readFileSync(target.target, "utf8")).toBe(postimage);
});

test("runtime patch rejects changed target content without mutation", () => {
  const target = fixture();
  writeFileSync(target.target, "changed implementation\n");
  const result = run(target.script, target.agent);
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("does not match a reviewed preimage or postimage");
  expect(readFileSync(target.target, "utf8")).toBe("changed implementation\n");
});
