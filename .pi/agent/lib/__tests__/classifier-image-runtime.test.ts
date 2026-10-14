import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Opt in with the installed SDK entry point; do not launch a nested Pi sandbox.
const runtimeModule = process.env.PI_CLASSIFIER_RUNTIME_MODULE;
test.skipIf(!runtimeModule)(
  "installed Pi SDK preserves images through native and tool classifier paths",
  async () => {
    if (!runtimeModule) throw new Error("Pi runtime module is unavailable");
    const directory = await mkdtemp(join(tmpdir(), "classifier-image-runtime-"));
    try {
      const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [
            fileURLToPath(new URL("./fixtures/classifier-image-runtime.ts", import.meta.url)),
            runtimeModule,
            directory,
          ],
          { timeout: 25_000, encoding: "utf8" },
          (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stdout, stderr }));
            else resolve({ stdout, stderr });
          },
        );
        child.stdin?.end();
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("CLASSIFIER_IMAGE_RUNTIME_OK");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
