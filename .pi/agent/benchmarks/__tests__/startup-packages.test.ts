import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const preflight = fileURLToPath(new URL("../startup-packages.ts", import.meta.url));

for (const version of ["1.0.0", "2.0.0"]) {
  test(`package preflight checks installed version ${version} without installing`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-startup-packages-"));
    try {
      const agent = join(directory, "agent");
      const packagePath = join(agent, "npm/node_modules/benchmark-fixture");
      await mkdir(packagePath, { recursive: true });
      await writeFile(
        join(agent, "settings.json"),
        JSON.stringify({ packages: ["npm:benchmark-fixture@1.0.0"] }),
      );
      const manifest = JSON.stringify({
        name: "benchmark-fixture",
        version,
        pi: { extensions: ["index.ts"] },
      });
      await writeFile(join(packagePath, "package.json"), manifest);
      await writeFile(join(packagePath, "index.ts"), "export default () => {};\n");
      const child = Bun.spawn([process.execPath, preflight, directory, agent], {
        env: { PATH: process.env.PATH, HOME: directory, PI_OFFLINE: "0" },
        stderr: "pipe",
        stdout: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      if (version === "1.0.0") {
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      } else {
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("Missing source: npm:benchmark-fixture@1.0.0");
      }
      expect(await readFile(join(packagePath, "package.json"), "utf8")).toBe(manifest);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
}
