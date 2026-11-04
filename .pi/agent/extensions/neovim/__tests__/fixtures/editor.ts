import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isMatching, P } from "ts-pattern";

export async function startEditor(noPrompt = false, failFirstOpen = false, binding?: unknown) {
  const ipcRuntime =
    process.env.PI_ASK_TEST_RUNTIME ?? "/run/current-system/sw/share/pi/ipc-runtime";
  const root = realpathSync(mkdtempSync(join("/tmp", "pi-ask-")));
  const home = join(root, "home");
  mkdirSync(home, { mode: 0o700 });
  const runtime = join(root, "run");
  mkdirSync(runtime, { mode: 0o700 });
  const child = spawn(
    "nvim",
    [
      "--headless",
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
        HOME: home,
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
  let stopBroker: (() => Promise<void>) | undefined;
  const close = async () => {
    await stopBroker?.();
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
    const capability = JSON.parse(
      readFileSync(join(ipcRuntime, "scripts/ipc/capabilities.json"), "utf8"),
    ).capabilities["neovim-ask"];
    const broker = spawn(
      Bun.which("node") ?? "node",
      [
        join(ipcRuntime, "scripts/ipc/helper.mts"),
        JSON.stringify({
          capability,
          home,
          launch: {
            upstream: ready.socket,
            context: { cwd: ready.cwd, launchId: ready.launchId, home, uid: process.getuid?.() },
          },
        }),
      ],
      { env: {}, stdio: ["pipe", "pipe", "pipe"] },
    );
    const brokerExited = new Promise<void>((resolve) => broker.once("exit", () => resolve()));
    const brokerOutput = createInterface({ input: broker.stdout });
    broker.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    stopBroker = async () => {
      broker.stdin.end();
      await brokerExited;
      brokerOutput.close();
    };
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Broker startup timed out: ${stderr}`)),
        5000,
      );
      broker.once("error", reject);
      broker.once("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Broker exited: ${stderr}`));
      });
      brokerOutput.once("line", (line) => {
        clearTimeout(timer);
        const value: unknown = JSON.parse(line);
        if (!isMatching({ endpoint: P.string }, value))
          reject(new Error("Invalid broker readiness"));
        else resolve(value.endpoint);
      });
    });
    return { ...ready, socket: endpoint, close, exited, messages, stderr: () => stderr };
  } catch (error) {
    await close();
    throw error;
  }
}
