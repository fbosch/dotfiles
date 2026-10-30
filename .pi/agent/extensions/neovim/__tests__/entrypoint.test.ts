import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runEntrypoint(
  socketPath: string | undefined,
  script: string,
  implementation?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), "pi-neovim-entrypoint-"));
  try {
    // Only copy the entrypoint: a disconnected session must not need its implementation graph.
    await copyFile(new URL("../index.ts", import.meta.url), join(directory, "index.ts"));
    if (implementation !== undefined) {
      await writeFile(join(directory, "extension.ts"), implementation);
    }
    await writeFile(join(directory, "run.ts"), script);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PI_NVIM_LAUNCH_ID: "0123456789abcdef0123456789abcdef",
    };
    if (socketPath === undefined) delete environment.PI_NVIM_ASK_SOCKET;
    else environment.PI_NVIM_ASK_SOCKET = socketPath;
    delete environment.PI_NVIM_SOCKET;
    const child = Bun.spawn([process.execPath, "run", join(directory, "run.ts")], {
      env: environment,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

const registrationProbe = `
export function initializeNeovim(pi, dependencies) {
  pi.on("session_start", () => dependencies);
}
`;

test("does not load the Pi Ask transport without its launch environment variable", async () => {
  const result = await runEntrypoint(
    undefined,
    `
import initialize from "./index";
await initialize(new Proxy({}, { get() { throw new Error("unexpected registration"); } }));
console.log("disconnected");
`,
  );
  expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "disconnected\n" });
});

test("connected startup awaits registration and keeps the captured launch identity", async () => {
  const result = await runEntrypoint(
    "/tmp/original.sock",
    `
import initialize from "./index";
process.env.PI_NVIM_ASK_SOCKET = "/tmp/replacement.sock";
process.env.PI_NVIM_LAUNCH_ID = "replacement-launch";
let registered;
await initialize({ on(_, handler) { registered = handler(); } });
console.log(JSON.stringify(registered));
`,
    registrationProbe,
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    launchId: "0123456789abcdef0123456789abcdef",
    socketPath: "/tmp/original.sock",
  });
});

test("explicit socket and launch options retain precedence over the environment", async () => {
  const result = await runEntrypoint(
    "/tmp/environment.sock",
    `
import { createNeovimExtension } from "./index";
let registered;
await createNeovimExtension({ socketPath: "/tmp/explicit.sock", launchId: "abcdef0123456789abcdef0123456789" })({
  on(_, handler) { registered = handler(); }
});
console.log(JSON.stringify(registered));
`,
    registrationProbe,
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    launchId: "abcdef0123456789abcdef0123456789",
    socketPath: "/tmp/explicit.sock",
  });
});

test("connected startup reports implementation load failures", async () => {
  const result = await runEntrypoint(
    "/tmp/original.sock",
    `import initialize from "./index"; await initialize({});`,
  );
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("extension");
});
