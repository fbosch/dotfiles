import { describe, expect, test } from "bun:test";
import {
  createPiInstallCommand,
  runCapturedProcess,
  type PackageInstallOutputStream,
} from "../package-install";
import type { UpdateDetail } from "../updates";

const update: UpdateDetail = {
  name: "@acme/tool",
  current: "1.0.0",
  latest: "2.0.0",
  scope: "project",
};

describe("captured Pi package installs", () => {
  test("builds a scoped project install command", () => {
    expect(createPiInstallCommand("/usr/bin/node", "/opt/pi/dist/main.js", update)).toEqual({
      command: "/usr/bin/node",
      args: ["/opt/pi/dist/main.js", "install", "npm:@acme/tool@2.0.0", "--local"],
    });
    expect(
      createPiInstallCommand("/usr/bin/node", "/opt/pi/dist/main.js", {
        ...update,
        scope: "user",
      }).args,
    ).toEqual(["/opt/pi/dist/main.js", "install", "npm:@acme/tool@2.0.0"]);
  });

  test("captures stdout and stderr without forwarding them to the terminal", async () => {
    const output: Record<PackageInstallOutputStream, string[]> = {
      stdout: [],
      stderr: [],
    };

    await runCapturedProcess(
      process.execPath,
      [
        "-e",
        "process.stdout.write('package output'); process.stderr.write('script output')",
      ],
      process.cwd(),
      (stream, chunk) => output[stream].push(chunk),
    );

    expect(output.stdout.join("")).toBe("package output");
    expect(output.stderr.join("")).toBe("script output");
  });

  test("reports a failed process while preserving its stderr", async () => {
    const stderr: string[] = [];

    await expect(
      runCapturedProcess(
        process.execPath,
        ["-e", "process.stderr.write('install failed'); process.exitCode = 7"],
        process.cwd(),
        (stream, chunk) => {
          if (stream === "stderr") stderr.push(chunk);
        },
      ),
    ).rejects.toThrow("exit code 7");

    expect(stderr.join("")).toBe("install failed");
  });
});
