import { spawn } from "node:child_process";

const FORCE_KILL_GRACE_MS = 250;
const KILL_SETTLEMENT_MS = 50;
const MAX_STDERR_CHARACTERS = 4_000;

export type FormatterExecutionResult =
  | { readonly kind: "success" }
  | {
      readonly kind: "exit_error";
      readonly exitCode: number | null;
      readonly signal: NodeJS.Signals | null;
      readonly stderr: string;
    }
  | { readonly kind: "spawn_error"; readonly message: string }
  | { readonly kind: "timeout"; readonly stderr: string; readonly timeoutMs: number }
  | { readonly kind: "cancelled"; readonly stderr: string };

interface RunFormatterCommandOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export function runFormatterCommand(
  command: string,
  args: readonly string[],
  options: RunFormatterCommandOptions,
): Promise<FormatterExecutionResult> {
  if (options.signal?.aborted) return Promise.resolve({ kind: "cancelled", stderr: "" });

  return new Promise((complete) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (cause) {
      complete({
        kind: "spawn_error",
        message: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    let exited = false;
    let finished = false;
    let stderr = "";
    let stopReason: "cancelled" | "timeout" | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let settlementTimer: ReturnType<typeof setTimeout> | undefined;

    const stderrTail = () => stderr.trim().slice(-MAX_STDERR_CHARACTERS);
    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
      if (settlementTimer !== undefined) clearTimeout(settlementTimer);
      options.signal?.removeEventListener("abort", cancel);
      child.stderr?.destroy();
    };
    const finish = (result: FormatterExecutionResult) => {
      if (finished) return;
      finished = true;
      cleanup();
      complete(result);
    };
    const finishStopped = () => {
      if (stopReason === "timeout") {
        finish({ kind: "timeout", stderr: stderrTail(), timeoutMs: options.timeoutMs });
        return;
      }
      finish({ kind: "cancelled", stderr: stderrTail() });
    };
    const signalProcessTree = (signal: NodeJS.Signals) => {
      if (process.platform === "win32" || child.pid === undefined) {
        child.kill(signal);
        return;
      }
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The process group has already exited.
      }
    };
    const stop = (reason: "cancelled" | "timeout") => {
      if (stopReason !== undefined || exited) return;
      stopReason = reason;
      signalProcessTree("SIGTERM");
      forceKillTimer = setTimeout(() => {
        signalProcessTree("SIGKILL");
        settlementTimer = setTimeout(finishStopped, KILL_SETTLEMENT_MS);
      }, FORCE_KILL_GRACE_MS);
    };
    const cancel = () => stop("cancelled");
    const timeoutTimer = setTimeout(() => stop("timeout"), options.timeoutMs);

    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-MAX_STDERR_CHARACTERS);
    });
    child.on("error", (cause) => {
      finish({ kind: "spawn_error", message: cause.message });
    });
    child.on("exit", (exitCode, signal) => {
      exited = true;
      if (stopReason !== undefined) {
        return;
      }
      if (exitCode === 0) {
        finish({ kind: "success" });
        return;
      }
      finish({ kind: "exit_error", exitCode, signal, stderr: stderrTail() });
    });
  });
}
