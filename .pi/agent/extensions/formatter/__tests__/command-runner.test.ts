import { expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFormatterCommand } from "../command-runner";

test("hard-kills a formatter that ignores the timeout signal", async () => {
  const startedAt = Date.now();
  const result = await runFormatterCommand(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { cwd: process.cwd(), timeoutMs: 50 },
  );

  expect(result.kind).toBe("timeout");
  expect(Date.now() - startedAt).toBeLessThan(2_000);
});

test("bounds captured formatter stderr", async () => {
  const result = await runFormatterCommand(
    process.execPath,
    ["-e", "process.stderr.write('x'.repeat(10000));process.exit(1)"],
    { cwd: process.cwd(), timeoutMs: 1_000 },
  );

  expect(result.kind).toBe("exit_error");
  if (result.kind !== "exit_error") return;
  expect(result.stderr.length).toBe(4_000);
});

test("kills formatter descendants before returning from a timeout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-formatter-process-tree-"));
  const markerPath = join(directory, "survived");
  try {
    const descendant = `setTimeout(() => Bun.write(${JSON.stringify(markerPath)}, "survived"), 500)`;
    const wrapper = [
      `const { spawn } = require("node:child_process")`,
      `spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" })`,
      `process.on("SIGTERM", () => {})`,
      `setInterval(() => {}, 1000)`,
    ].join(";");

    const result = await runFormatterCommand(process.execPath, ["-e", wrapper], {
      cwd: directory,
      timeoutMs: 50,
    });
    await Bun.sleep(600);

    expect(result.kind).toBe("timeout");
    await expect(access(markerPath)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
