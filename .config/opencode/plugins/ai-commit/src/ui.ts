import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { stderr } from "node:process";
import { cancel, isCancel, log, select, spinner, text } from "@clack/prompts";

type StyleColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 208;

export function style(text: string, color?: StyleColor): void {
  if (color === 1) {
    log.error(text);
    return;
  }

  if (color === 2) {
    log.success(text);
    return;
  }

  if (color === 3) {
    log.warn(text);
    return;
  }

  log.message(text);
}

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (stderr.isTTY === false) {
    return fn();
  }

  const s = spinner();
  s.start(label);

  try {
    const value = await fn();
    s.stop("Done");
    return value;
  } catch (error) {
    s.stop("Failed");
    throw error;
  }
}

export async function choose(header: string, options: string[]): Promise<string | null> {
  if (options.length === 0) {
    return null;
  }

  const choice = await select({
    message: header,
    options: options.map((option) => ({ value: option, label: option })),
    initialValue: options[0],
  });

  if (isCancel(choice)) {
    cancel("Commit cancelled");
    return null;
  }

  return choice;
}

export async function input(value: string, prompt = "Commit message:"): Promise<string | null> {
  const answer = await text({
    message: prompt,
    initialValue: value,
  });

  if (isCancel(answer)) {
    cancel("Commit cancelled");
    return null;
  }

  if (answer.trim().length === 0) {
    return value;
  }

  return answer.trim();
}

export function copyCommitCommandToClipboard(message: string): void {
  const cmd = `git commit -m "${message.replaceAll('"', '\\"')}"`;
  const os = platform();

  if (os === "darwin") {
    const result = spawnSync("pbcopy", { input: cmd, encoding: "utf8" });
    if ((result.status ?? 1) === 0) {
      return;
    }
  }

  const wl = spawnSync("sh", ["-c", "command -v wl-copy >/dev/null 2>&1"], {
    stdio: "ignore",
  });
  if ((wl.status ?? 1) === 0) {
    spawnSync("wl-copy", { input: cmd, encoding: "utf8" });
    return;
  }

  const xclip = spawnSync("sh", ["-c", "command -v xclip >/dev/null 2>&1"], {
    stdio: "ignore",
  });
  if ((xclip.status ?? 1) === 0) {
    spawnSync("xclip", ["-selection", "clipboard"], { input: cmd, encoding: "utf8" });
  }
}
