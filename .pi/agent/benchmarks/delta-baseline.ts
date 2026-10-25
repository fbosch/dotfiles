import { spawn } from "node:child_process";
import type { ExecOptions, ExecResult } from "@earendil-works/pi-coding-agent";

// Keep the external-process comparison independent of the active Shiki extension.
export function buildDeltaInvocation(display: "inline" | "side-by-side", width: number): string[] {
  return [
    "--no-gitconfig",
    "--paging=never",
    "--dark",
    `--width=${width}`,
    "--line-numbers",
    "--line-fill-method=spaces",
    "--line-numbers-minus-style=88",
    "--line-numbers-plus-style=28",
    '--minus-style=syntax "#3E2225"',
    '--minus-emph-style=syntax "#3E2225"',
    '--plus-style=syntax "#232D1A"',
    '--plus-emph-style=syntax "#232D1A"',
    "--commit-decoration-style=omit",
    "--file-decoration-style=omit",
    "--hunk-header-style=omit",
    "--hunk-header-decoration-style=omit",
    "--syntax-theme=Zenwritten Dark",
    "--file-style=bold",
    ...(display === "side-by-side" ? ["--side-by-side"] : []),
  ];
}

export function executeDeltaProcess(
  args: readonly string[],
  input: string | undefined,
  options: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("delta", [...args], { cwd: options.cwd, stdio: "pipe" });
    let stdout = "",
      stderr = "",
      killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, options.timeout ?? 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on("error", () => {});
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1, killed });
    });
    child.stdin.end(input);
  });
}
