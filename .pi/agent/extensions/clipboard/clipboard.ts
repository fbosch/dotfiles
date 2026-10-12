import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";

const COMMAND_TIMEOUT_MS = 5_000;
const MAX_CLIPBOARD_BYTES = 10 * 1024 * 1024;

type ClipboardCommand = {
  command: string;
  args: string[];
};

type ClipboardBackend = {
  name: string;
  read: ClipboardCommand;
  write: ClipboardCommand;
};

type CommandOptions = {
  input?: string;
  signal?: AbortSignal;
};

export type ClipboardCommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions,
) => Promise<string>;

type ClipboardDependencies = {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  isExecutable?: (command: string) => boolean;
  runCommand?: ClipboardCommandRunner;
  signal?: AbortSignal;
};

function executableInPath(command: string, pathValue: string | undefined): boolean {
  return (pathValue ?? "")
    .split(delimiter)
    .filter((directory) => directory.length > 0)
    .some((directory) => {
      try {
        accessSync(join(directory, command), fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

export function selectClipboardBackend(
  dependencies: Pick<ClipboardDependencies, "platform" | "env" | "isExecutable"> = {},
): ClipboardBackend {
  const platform = dependencies.platform ?? process.platform;
  const env = dependencies.env ?? process.env;
  const isExecutable =
    dependencies.isExecutable ?? ((command: string) => executableInPath(command, env.PATH));

  if (platform === "darwin") {
    if (isExecutable("pbcopy") && isExecutable("pbpaste")) {
      return {
        name: "macOS",
        read: { command: "pbpaste", args: [] },
        write: { command: "pbcopy", args: [] },
      };
    }
  } else if (["linux", "freebsd", "netbsd", "openbsd", "dragonfly"].includes(platform)) {
    const waylandSession =
      env.XDG_SESSION_TYPE === "wayland" || env.WAYLAND_DISPLAY !== undefined;
    const x11Session = env.XDG_SESSION_TYPE === "x11" || env.DISPLAY !== undefined;

    if (waylandSession && isExecutable("wl-copy") && isExecutable("wl-paste")) {
      return {
        name: "Wayland",
        read: { command: "wl-paste", args: ["--no-newline", "--type", "text"] },
        write: { command: "wl-copy", args: ["--type", "text/plain"] },
      };
    }

    if (x11Session && isExecutable("xclip")) {
      return {
        name: "X11 (xclip)",
        read: { command: "xclip", args: ["-selection", "clipboard", "-o"] },
        write: { command: "xclip", args: ["-selection", "clipboard"] },
      };
    }

    if (x11Session && isExecutable("xsel")) {
      return {
        name: "X11 (xsel)",
        read: { command: "xsel", args: ["--clipboard", "--output"] },
        write: { command: "xsel", args: ["--clipboard", "--input"] },
      };
    }
  }

  throw new Error(
    `No supported clipboard backend for ${platform}. macOS requires pbcopy/pbpaste; Linux and BSD require wl-clipboard on Wayland or xclip/xsel on X11.`,
  );
}

function runClipboardCommand(
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const writing = options.input !== undefined;
    const child = spawn(command, args, {
      stdio: [writing ? "pipe" : "ignore", writing ? "ignore" : "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (error: Error | undefined, value = "") => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(value);
      else reject(error);
    };

    const abort = () => {
      child.kill("SIGKILL");
      finish(new Error("Clipboard operation cancelled."));
    };

    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`Clipboard command ${command} timed out.`));
    }, COMMAND_TIMEOUT_MS);

    child.once("error", (error) => {
      finish(new Error(`Could not start clipboard command ${command}: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error(`Clipboard command ${command} exited with status ${code ?? "unknown"}.`));
        return;
      }

      finish(undefined, Buffer.concat(chunks, outputBytes).toString("utf8"));
    });

    if (!writing) {
      child.stdout?.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_CLIPBOARD_BYTES) {
          child.kill("SIGKILL");
          finish(new Error(`Clipboard text exceeds the ${MAX_CLIPBOARD_BYTES}-byte limit.`));
          return;
        }
        chunks.push(chunk);
      });
      child.stdout?.once("error", (error) => finish(error));
    } else {
      child.stdin?.once("error", (error) => finish(error));
    }

    if (options.signal?.aborted === true) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    if (writing) child.stdin?.end(options.input, "utf8");
  });
}

export async function readClipboardText(
  dependencies: ClipboardDependencies = {},
): Promise<string> {
  const backend = selectClipboardBackend(dependencies);
  const runCommand = dependencies.runCommand ?? runClipboardCommand;
  return runCommand(backend.read.command, backend.read.args, {
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
}

export async function writeClipboardText(
  text: string,
  dependencies: ClipboardDependencies = {},
): Promise<void> {
  const backend = selectClipboardBackend(dependencies);
  const runCommand = dependencies.runCommand ?? runClipboardCommand;
  await runCommand(backend.write.command, backend.write.args, {
    input: text,
    ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
  });
}
