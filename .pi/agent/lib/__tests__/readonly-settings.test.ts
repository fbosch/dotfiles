import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getPackageDir } from "@earendil-works/pi-coding-agent";

test("extension settings readers share core runtime locks without needing writable settings", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-readonly-settings-"));
  const agent = join(root, "agent");
  const locks = join(root, "locks");
  mkdirSync(agent);
  mkdirSync(locks);
  const settings = join(agent, "settings.json");
  writeFileSync(settings, JSON.stringify({
    showFileChanges: false,
    quickReplies: { enabled: false },
    autoSessionTitle: { model: "fixture/model", thinkingLevel: "minimal" },
    references: { fixture: { path: root, description: "Local fixture" } },
  }), { mode: 0o400 });
  chmodSync(agent, 0o500);
  try {
    const moduleUrl = (path: string) => new URL(path, import.meta.url).href;
    const script = `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { join, relative } from "node:path";
      import { readFileSync, realpathSync } from "node:fs";
      import { getPackageDir } from "@earendil-works/pi-coding-agent";
      import { readLockedJsonFile, updateLockedJsonFile } from ${JSON.stringify(moduleUrl("../locked-json-file.ts"))};
      import { loadFileChangesSettings } from ${JSON.stringify(moduleUrl("../../extensions/file-changes/settings.ts"))};
      import { loadQuickRepliesSettings } from ${JSON.stringify(moduleUrl("../../extensions/quick-replies/settings.ts"))};
      import { loadAutoSessionTitleSettings } from ${JSON.stringify(moduleUrl("../../extensions/auto-session-title/settings.ts"))};
      import { loadConfiguredReferences } from ${JSON.stringify(moduleUrl("../../extensions/mentions/project-references/configured.ts"))};
      const file = process.env.FIXTURE_SETTINGS;
      const root = process.env.FIXTURE_ROOT;
      const before = readFileSync(file, "utf8");
      assert.equal(readLockedJsonFile(file).showFileChanges, false);
      assert.deepEqual(loadFileChangesSettings(file), {showFileChanges:false, warnings:[]});
      const quick = loadQuickRepliesSettings(file);
      assert.equal(quick.enabled, false);
      assert.deepEqual(quick.warnings, []);
      assert.deepEqual(loadAutoSessionTitleSettings(file), {model:{provider:"fixture",id:"model"},thinkingLevel:"minimal"});
      assert.deepEqual(loadConfiguredReferences(file, root, root), [{name:"fixture",path:realpathSync(root),description:"Local fixture"}]);
      const load = createRequire(join(getPackageDir(), "package.json"));
      const coreLock = load("proper-lockfile");
      const release = coreLock.lockSync(file, {realpath:false});
      try {
        assert.throws(() => readLockedJsonFile(file), /settings file is locked by another process/);
        assert.throws(() => readLockedJsonFile(relative(process.cwd(), file)), /settings file is locked by another process/);
      } finally { release(); }
      assert.throws(() => updateLockedJsonFile(file, () => ({changed:true})), error => ["EACCES","EPERM"].includes(error.code));
      assert.equal(readFileSync(file,"utf8"), before);
    `;
    const child = spawnSync(process.execPath, ["--eval", script], {
      cwd: resolve(import.meta.dir, "../.."),
      env: {
        ...process.env,
        PI_PACKAGE_DIR: getPackageDir(),
        PI_CODING_AGENT_DIR: agent,
        PI_LOCKFILE_DIR: locks,
        FIXTURE_ROOT: root,
        FIXTURE_SETTINGS: settings,
      },
      encoding: "utf8",
      timeout: 15000,
    });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(readdirSync(locks)).toEqual([]);
  } finally {
    chmodSync(agent, 0o700);
    rmSync(root, { recursive: true, force: true });
  }
});
