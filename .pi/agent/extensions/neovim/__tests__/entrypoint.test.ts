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
      PI_NVIM_LAUNCH_ID: "original-launch",
    };
    if (socketPath === undefined) delete environment.PI_NVIM_SOCKET;
    else environment.PI_NVIM_SOCKET = socketPath;
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
  pi.registerTool(dependencies);
}
`;

test("does not register the Neovim tool without its launch environment variable", async () => {
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
process.env.PI_NVIM_SOCKET = "/tmp/replacement.sock";
process.env.PI_NVIM_LAUNCH_ID = "replacement-launch";
let registered;
await initialize({ registerTool(value) { registered = value; } });
console.log(JSON.stringify(registered));
`,
    registrationProbe,
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    launchId: "original-launch",
    socketPath: "/tmp/original.sock",
  });
});

test("explicit socket and launch options retain precedence over the environment", async () => {
  const result = await runEntrypoint(
    "/tmp/environment.sock",
    `
import { createNeovimExtension } from "./index";
let registered;
await createNeovimExtension({ socketPath: "/tmp/explicit.sock", launchId: "explicit-launch" })({
  registerTool(value) { registered = value; }
});
console.log(JSON.stringify(registered));
`,
    registrationProbe,
  );
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toEqual({
    launchId: "explicit-launch",
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
