import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

test("the active runtime credential store uses runtime locks beside read-only agent configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profile-runtime-lock-"));
  const agent = join(root, "agent");
  const locks = join(root, "locks");
  const auth = join(agent, "auth.json");
  mkdirSync(agent);
  mkdirSync(locks);
  writeFileSync(auth, "{}", { mode: 0o600 });
  chmodSync(agent, 0o500);
  try {
    const adapter = new URL("../providers/openai-codex.ts", import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      import { existsSync, readdirSync } from "node:fs";
      import { createCredentialStore } from ${JSON.stringify(adapter)};
      const auth = process.env.FIXTURE_AUTH_PATH;
      const store = await createCredentialStore(auth);
      assert.deepEqual(await store.list(), []);
      await store.modify("fixture", async () => {
        assert.ok(readdirSync(process.env.PI_LOCKFILE_DIR).length > 0);
        return {type:"api_key", key:"synthetic-key"};
      });
      assert.equal((await store.read("fixture")).key, "synthetic-key");
      assert.equal(existsSync(auth + ".lock"), false);
    `;
    const child = spawnSync(process.execPath, ["--eval", script], {
      cwd: resolve(import.meta.dir, "../../.."),
      env: {
        ...process.env,
        PI_PACKAGE_DIR: getPackageDir(),
        PI_CODING_AGENT_DIR: agent,
        PI_LOCKFILE_DIR: locks,
        FIXTURE_AUTH_PATH: auth,
      },
      encoding: "utf8",
      timeout: 15000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(readFileSync(auth, "utf8"))).toEqual({
      fixture: { type: "api_key", key: "synthetic-key" },
    });
    expect(readdirSync(locks)).toEqual([]);
  } finally {
    chmodSync(agent, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real auth-profiles startup hook loads with read-only agent configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-profile-startup-"));
  const agent = join(root, "agent");
  const locks = join(root, "locks");
  const work = join(root, "work");
  for (const directory of [agent, locks, work, join(root, "tmp")]) mkdirSync(directory);
  for (const directory of ["auth-profiles", "sessions", "cache"]) mkdirSync(join(agent, directory));
  writeFileSync(join(agent, "auth.json"), "{}");
  writeFileSync(
    join(agent, "settings.json"),
    JSON.stringify({
      packages: [],
      extensions: ["-builtin:mcp", fileURLToPath(new URL("../index.ts", import.meta.url))],
    }),
  );
  chmodSync(agent, 0o500);
  try {
    const node = Bun.which("node");
    if (!node) throw new Error("The startup regression test requires Node");
    const child = spawnSync(
      node,
      [join(getPackageDir(), "dist/bundle/cli.js"), "--mode", "rpc", "--no-session"],
      {
        cwd: work,
        input: `${JSON.stringify({ id: "auth-startup-proof", type: "get_commands" })}\n`,
        env: {
          HOME: root,
          PATH: process.env.PATH,
          TMPDIR: join(root, "tmp"),
          PI_CODING_AGENT_DIR: agent,
          PI_LOCKFILE_DIR: locks,
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
          JITI_FS_CACHE: "false",
          NO_COLOR: "1",
        },
        encoding: "utf8",
        timeout: 15000,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain('"name":"profile"');
    expect(child.stderr).not.toContain("Could not prepare model availability");
  } finally {
    chmodSync(agent, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
