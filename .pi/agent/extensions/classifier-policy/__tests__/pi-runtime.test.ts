import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const executable = Bun.which("pi");
test.skipIf(!executable)(
  "installed Pi gates native and shared requests before and after reload",
  async () => {
    if (!executable) throw new Error("Pi is unavailable");
    const agentDirectory = await mkdtemp(join(tmpdir(), "classifier-policy-runtime-"));
    try {
      await writeFile(
        join(agentDirectory, "settings.json"),
        JSON.stringify({ classifier: { enabled: false } }),
      );
      const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = execFile(
          executable,
          [
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
            "--no-session",
            "-e",
            fileURLToPath(new URL("./fixtures/pi-runtime.ts", import.meta.url)),
            "-p",
            "/classifier-policy-probe",
          ],
          {
            cwd: agentDirectory,
            env: { ...process.env, PI_CODING_AGENT_DIR: agentDirectory },
            timeout: 25_000,
            encoding: "utf8",
          },
          (error, stdout, stderr) => {
            if (error) reject(Object.assign(error, { stdout, stderr }));
            else resolve({ stdout, stderr });
          },
        );
        child.stdin?.end();
      });
      // Print mode routes extension console output to stderr, leaving stdout for model output.
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("CLASSIFIER_POLICY_RUNTIME_OK\nCLASSIFIER_POLICY_RUNTIME_OK\n");
    } finally {
      await rm(agentDirectory, { recursive: true, force: true });
    }
  },
  30_000,
);
