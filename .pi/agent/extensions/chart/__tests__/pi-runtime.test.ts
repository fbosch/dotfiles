import { expect, test } from "bun:test";
import { type ExecFileOptionsWithStringEncoding, execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function execFileAsync(
  file: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    // Print mode consumes piped stdin before starting the session.
    child.stdin?.end();
  });
}
// Use the deployed CLI, not the repository's SDK or the test runner's Bun.
const executable = process.env.PI_CHART_TEST_EXECUTABLE ?? Bun.which("pi");
test.skipIf(!executable)(
  "renders full-resolution charts without redundant input uploads in installed Pi before and after /reload",
  async () => {
    if (!executable) throw new Error("Pi executable is unavailable");
    const agentDir = await mkdtemp(join(tmpdir(), "chart-pi-runtime-"));
    try {
      const { stdout, stderr } = await execFileAsync(
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
          "/chart-runtime-reload",
        ],
        {
          cwd: agentDir,
          encoding: "utf8",
          env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
          timeout: 25_000,
        },
      );
      expect(stderr).toBe("");
      expect(stdout).toContain("CHART_RUNTIME_OK startup ");
      expect(stdout).toContain("CHART_RUNTIME_OK reload ");
      expect(stdout).toContain("CHART_REDRAW startup Rendering bezier chart");
      expect(stdout).toContain("CHART_REDRAW reload Rendering bezier chart");
      expect(stdout).toContain("CHART_REDRAW startup Rendering heatmap");
      expect(stdout).toContain("CHART_REDRAW reload Rendering heatmap");
      expect(stdout).toContain("CHART_REDRAW startup Rendering box plot");
      expect(stdout).toContain("CHART_REDRAW reload Rendering box plot");
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  },
  30_000,
);

const python = Bun.which("python3");
test.skipIf(!executable || !python || process.platform === "win32")(
  "restores a saved chart backlog in installed Pi interactive startup and /reload",
  async () => {
    if (!executable || !python) throw new Error("Pi and Python are required");
    const { stdout, stderr } = await execFileAsync(
      python,
      [fileURLToPath(new URL("./fixtures/pi-resume.py", import.meta.url)), executable],
      { encoding: "utf8", timeout: 80_000 },
    );
    expect(stderr).toBe("");
    expect(stdout).toContain("CHART_RESUME_OK startup 32");
    expect(stdout).toContain("CHART_RESUME_OK reload 32");
  },
  85_000,
);
