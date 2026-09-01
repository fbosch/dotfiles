import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import direnvSessionEnvironment from "../index";

type SessionStartHandler = (event: never, context: ExtensionContext) => Promise<void> | void;

interface PiHarness {
  pi: ExtensionAPI;
  getHandler(): SessionStartHandler;
  registeredTools: Array<{ name: string }>;
}

function createPiHarness(exported: { stdout: string; stderr: string; code: number }): PiHarness {
  let handler: SessionStartHandler | undefined;
  const registeredTools: Array<{ name: string }> = [];
  const pi = {
    on(event: string, candidate: SessionStartHandler) {
      if (event === "session_start") handler = candidate;
    },
    exec: async () => ({ ...exported, killed: false }),
    registerTool(tool: { name: string }) {
      registeredTools.push(tool);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    registeredTools,
    getHandler() {
      if (handler === undefined) throw new Error("session_start handler was not registered");
      return handler;
    },
  };
}

function context(cwd: string, notifications: string[]): ExtensionContext {
  return {
    cwd,
    isProjectTrusted: () => true,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
  } as unknown as ExtensionContext;
}

test("overrides bash after loading an allowed repository environment", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-extension-"));
  try {
    await mkdir(join(project, ".git"));
    await writeFile(join(project, ".envrc"), "");
    const harness = createPiHarness({
      stdout: JSON.stringify({ PROJECT_TOOL: "/repo/bin/tool" }),
      stderr: "",
      code: 0,
    });
    const notifications: string[] = [];

    direnvSessionEnvironment(harness.pi);
    await harness.getHandler()({} as never, context(project, notifications));

    expect(harness.registeredTools.map((tool) => tool.name)).toEqual(["bash"]);
    expect(notifications).toEqual([]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("warns and keeps the built-in bash tool when the envrc is blocked", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-extension-"));
  try {
    await mkdir(join(project, ".git"));
    await writeFile(join(project, ".envrc"), "");
    const harness = createPiHarness({
      stdout: "",
      stderr: "direnv: error .envrc is blocked",
      code: 1,
    });
    const notifications: string[] = [];

    direnvSessionEnvironment(harness.pi);
    await harness.getHandler()({} as never, context(project, notifications));

    expect(harness.registeredTools).toEqual([]);
    expect(notifications).toEqual(["direnv: .envrc is blocked. Run `direnv allow` to enable it."]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
