import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UpdateDetail } from "./updates";

export type PackageInstallOutputStream = "stdout" | "stderr";
export type PackageInstallOutputHandler = (
  stream: PackageInstallOutputStream,
  chunk: string,
) => void;

export interface PiInstallCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function createPiInstallCommand(
  execPath: string,
  cliEntry: string,
  update: UpdateDetail,
): PiInstallCommand {
  return {
    command: execPath,
    args: [
      resolve(cliEntry),
      "install",
      `npm:${update.name}@${update.latest}`,
      ...(update.scope === "project" ? ["--local"] : []),
    ],
  };
}

// The in-process installer inherits the active terminal. Running the CLI as a subprocess pipes
// package lifecycle output into the modal.
export async function installPackageInPiCli(
  context: ExtensionContext,
  update: UpdateDetail,
  onOutput: PackageInstallOutputHandler,
): Promise<void> {
  const cliEntry = process.argv[1];
  if (cliEntry === undefined) throw new Error("Could not locate Pi's CLI entry point.");

  const { command, args } = createPiInstallCommand(process.execPath, cliEntry, update);
  await runCapturedProcess(command, args, context.cwd, onOutput);
}

export function runCapturedProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  onOutput: PackageInstallOutputHandler,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const child = spawn(command, [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string | Buffer) =>
      onOutput("stdout", typeof chunk === "string" ? chunk : chunk.toString("utf8")),
    );
    child.stderr?.on("data", (chunk: string | Buffer) =>
      onOutput("stderr", typeof chunk === "string" ? chunk : chunk.toString("utf8")),
    );

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolvePromise();
        return;
      }
      const exit = code === null ? `signal ${signal ?? "unknown"}` : `exit code ${code}`;
      rejectPromise(new Error(`Pi package install failed with ${exit}.`));
    });
  });
}
