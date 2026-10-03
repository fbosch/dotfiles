import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PreparedCheck, queryLatest } from "../index";

function waitForFile(directory: string, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (existsSync(join(directory, fileName))) {
      resolve();
      return;
    }
    const watcher = watch(directory, (_event, changedName) => {
      if (changedName?.toString() !== fileName) return;
      clearTimeout(timeout);
      watcher.close();
      resolve();
    });
    const timeout = setTimeout(() => {
      watcher.close();
      reject(new Error("npm wrapper did not start its child"));
    }, 2_000);
  });
}

async function waitForExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe("npm latest-version process lifecycle", () => {
  test("aborting a wrapper terminates its child and settles without waiting for inherited stdout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pi-npm-wrapper-"));
    const pidFile = join(directory, "child.pid");
    const script = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {',
      '  stdio: ["ignore", "inherit", "ignore"],',
      "});",
      `writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`,
      "setTimeout(() => {}, 30000);",
    ].join("\n");
    const prepared: PreparedCheck = {
      cwd: directory,
      fingerprint: "test",
      npmCommand: [process.execPath, "-e", script],
      plan: { npm: [], gitNotChecked: 0, unsupported: 0 },
    };
    const controller = new AbortController();
    let childPid: number | undefined;
    let query: Promise<string> | undefined;
    try {
      const ready = waitForFile(directory, "child.pid");
      query = queryLatest(prepared, "example", controller.signal);
      await ready;
      childPid = Number(readFileSync(pidFile, "utf8"));
      expect(Number.isSafeInteger(childPid)).toBe(true);
      controller.abort();

      const result = await Promise.race([
        query.then(
          () => "resolved",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), 1_500)),
      ]);
      expect(result).toBe("Release query cancelled");
      expect(await waitForExit(childPid)).toBe(true);
    } finally {
      controller.abort();
      if (childPid !== undefined) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The process-tree termination may already have exited the child.
        }
      }
      await query?.catch(() => {});
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
