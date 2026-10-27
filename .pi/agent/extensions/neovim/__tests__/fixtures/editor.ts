import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isMatching, P } from "ts-pattern";

export async function startEditor(noPrompt = false, failFirstOpen = false, binding?: unknown) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-ask-")));
  const runtime = join(root, "run");
  mkdirSync(runtime, { mode: 0o700 });
  const child = spawn(
    "nvim",
    [
      "--headless",
      "--listen",
      join(root, "nvim.sock"),
      "-u",
      "NONE",
      "-i",
      "NONE",
      "-l",
      new URL("./pi-ask.lua", import.meta.url).pathname,
    ],
    {
      env: {
        ...process.env,
        XDG_RUNTIME_DIR: runtime,
        PI_ASK_FIXTURE_ROOT: root,
        PI_ASK_FIXTURE_CONFIG: resolve(import.meta.dir, "../../../../../../.config/nvim"),
        PI_ASK_FIXTURE_NO_PROMPT: noPrompt ? "1" : "0",
        ...(binding === undefined ? {} : { PI_ASK_FIXTURE_BINDING: JSON.stringify(binding) }),
        PI_ASK_FIXTURE_FAIL_FIRST_OPEN: failFirstOpen ? "1" : "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const output = createInterface({ input: child.stdout });
  const messages: unknown[] = [];
  output.on("line", (line) => {
    messages.push(JSON.parse(line));
  });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    output.close();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const ready: unknown = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Neovim fixture did not start: ${stderr}`)),
        5000,
      );
      output.once("line", (line) => {
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Neovim fixture exited: ${stderr}`));
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    if (!isMatching({ cwd: P.string, launchId: P.string, socket: P.string }, ready))
      throw new Error("Invalid fixture identity");
    return { ...ready, close, exited, messages, stderr: () => stderr };
  } catch (error) {
    await close();
    throw error;
  }
}
