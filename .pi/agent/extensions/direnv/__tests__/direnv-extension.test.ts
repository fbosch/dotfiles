import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../../startup-header/contracts";
import direnvSessionEnvironment from "../index";

type LifecycleHandler = (event: never, context: ExtensionContext) => Promise<void> | void;

interface RegisteredTool {
  name: string;
  execute(
    id: string,
    params: { command: string; timeout?: number },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: ExtensionToolContext,
  ): Promise<unknown>;
}

interface PiHarness {
  pi: ExtensionAPI;
  events: ReturnType<typeof createEventBus>;
  getHandler(event?: string): LifecycleHandler;
  registeredTools: RegisteredTool[];
  getSettingsCalls(): number;
}

function createPiHarness(
  exported: { stdout: string; stderr: string; code: number },
  piCommaPrefix?: string,
  settings: Pick<ReturnType<ExtensionAPI["getSettings"]>, "shellPath" | "shellCommandPrefix"> = {},
): PiHarness {
  const handlers = new Map<string, LifecycleHandler>();
  const currentExported = exported;
  let getSettingsCalls = 0;
  const registeredTools: RegisteredTool[] = [];
  const events = createEventBus();
  const pi = {
    on(event: string, candidate: LifecycleHandler) {
      handlers.set(event, candidate);
    },
    exec: async () => ({ ...currentExported, killed: false }),
    getSettings() {
      getSettingsCalls += 1;
      return settings;
    },
    events: {
      on: events.on.bind(events),
      emit(event: string, value: unknown) {
        if (piCommaPrefix !== undefined && typeof value === "object" && value !== null) {
          (value as { prefix?: string }).prefix = piCommaPrefix;
        }
        events.emit(event, value);
      },
    },
    registerTool(tool: RegisteredTool) {
      registeredTools.push(tool);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    events,
    registeredTools,
    getSettingsCalls() {
      return getSettingsCalls;
    },
    getHandler(event = "session_start") {
      const handler = handlers.get(event);
      if (handler === undefined) throw new Error(`${event} handler was not registered`);
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

function captureEnvironment(...names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(environment: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function runChild(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["-e", script], (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

test("publishes project variables to custom tools and child processes while preserving Bash setup", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-extension-"));
  const shellPath = Bun.which("bash");
  if (shellPath === null) throw new Error("Bash was not found for the integration test");
  const originalEnvironment = captureEnvironment(
    "PROJECT_TOOL",
    "WOW_CASC_LIBRARY",
    "PATH",
    "REMOVED_VALUE",
    "PI_DIRENV_UNRELATED",
  );
  try {
    process.env.PROJECT_TOOL = "/ambient/tool";
    process.env.WOW_CASC_LIBRARY = "/ambient/casc.so";
    process.env.PATH = "/ambient/bin";
    process.env.REMOVED_VALUE = "inherited";
    process.env.PI_DIRENV_UNRELATED = "leave-alone";
    await mkdir(join(project, ".git"));
    await writeFile(join(project, ".envrc"), "");
    const prefixMarker = join(project, "prefix-marker");
    const settingsMarker = join(project, "settings-marker");
    const environmentMarker = join(project, "environment-marker");
    const harness = createPiHarness(
      {
        stdout: JSON.stringify({
          PROJECT_TOOL: "/repo/bin/tool",
          WOW_CASC_LIBRARY: "/repo/lib/libcasc.so",
          PATH: "/repo/bin",
          REMOVED_VALUE: null,
        }),
        stderr: "",
        code: 0,
      },
      `printf pi-comma > ${JSON.stringify(prefixMarker)}`,
      {
        shellCommandPrefix: `printf settings > ${JSON.stringify(settingsMarker)}`,
        shellPath,
      },
    );
    const notifications: string[] = [];

    direnvSessionEnvironment(harness.pi);
    await harness.getHandler()({} as never, context(project, notifications));

    expect(harness.registeredTools.map((tool) => tool.name)).toEqual(["bash"]);
    const bashTool = harness.registeredTools[0];
    if (bashTool === undefined) throw new Error("Bash tool was not registered");
    const toolContext = {
      cwd: project,
      model: { provider: "fixture", id: "fixture-model" },
      sessionManager: {
        getSessionId: () => "fixture-session",
        getSessionFile: () => undefined,
      },
      thinkingLevel: "low",
    } as unknown as ExtensionToolContext;

    const atlasTool = { execute: async () => process.env.WOW_CASC_LIBRARY };
    expect(await atlasTool.execute()).toBe("/repo/lib/libcasc.so");
    expect(process.env.REMOVED_VALUE).toBeUndefined();
    expect(process.env.PI_DIRENV_UNRELATED).toBe("leave-alone");
    const childEnvironment = await runChild(
      "process.stdout.write(JSON.stringify({ casc: process.env.WOW_CASC_LIBRARY, path: process.env.PATH, removed: process.env.REMOVED_VALUE ?? null }))",
    );
    expect(JSON.parse(childEnvironment)).toEqual({
      casc: "/repo/lib/libcasc.so",
      path: "/repo/bin",
      removed: null,
    });

    await bashTool.execute(
      "direnv-composition",
      {
        command: `printf '%s|%s|%s' "$PROJECT_TOOL" "$PI_SESSION_ID" "\${REMOVED_VALUE-unset}" > ${JSON.stringify(environmentMarker)}`,
        timeout: 1,
      },
      undefined,
      undefined,
      toolContext,
    );
    expect(await readFile(settingsMarker, "utf8")).toBe("settings");
    expect(await readFile(prefixMarker, "utf8")).toBe("pi-comma");
    expect(await readFile(environmentMarker, "utf8")).toBe(
      "/repo/bin/tool|fixture-session|unset",
    );
    expect(harness.getSettingsCalls()).toBe(1);
    expect(notifications).toEqual([]);

    await harness.getHandler("session_shutdown")(
      { type: "session_shutdown", reason: "quit" } as never,
      context(project, notifications),
    );
    expect(process.env.PROJECT_TOOL).toBe("/ambient/tool");
    expect(process.env.WOW_CASC_LIBRARY).toBe("/ambient/casc.so");
    expect(process.env.PATH).toBe("/ambient/bin");
    expect(process.env.REMOVED_VALUE).toBe("inherited");
    expect(process.env.PI_DIRENV_UNRELATED).toBe("leave-alone");
  } finally {
    restoreEnvironment(originalEnvironment);
    await rm(project, { recursive: true, force: true });
  }
});

test("warns, preserves ambient values, and keeps built-in Bash when the envrc is blocked", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-extension-"));
  const originalEnvironment = captureEnvironment("PI_DIRENV_BLOCKED_TEST");
  try {
    process.env.PI_DIRENV_BLOCKED_TEST = "ambient";
    await mkdir(join(project, ".git"));
    await writeFile(join(project, ".envrc"), "");
    const harness = createPiHarness({
      stdout: JSON.stringify({ PI_DIRENV_BLOCKED_TEST: "must-not-load" }),
      stderr: "direnv: error .envrc is blocked",
      code: 1,
    });
    const notifications: string[] = [];
    const snapshots: StartupOwnerSnapshot[] = [];
    harness.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );

    direnvSessionEnvironment(harness.pi);
    harness.events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("session", "generation", "direnv"),
    );
    await harness.getHandler()({} as never, context(project, notifications));

    expect(harness.registeredTools).toEqual([]);
    expect(process.env.PI_DIRENV_BLOCKED_TEST).toBe("ambient");
    expect(snapshots.at(-1)).toMatchObject({ state: "degraded", payload: { problem: "blocked" } });
    expect(notifications).toEqual(["direnv: .envrc is blocked. Run `direnv allow` to enable it."]);
  } finally {
    restoreEnvironment(originalEnvironment);
    await rm(project, { recursive: true, force: true });
  }
});

test("cleans project variables on reload and rejects zero-exit direnv diagnostics", async () => {
  const originalEnvironment = captureEnvironment("PROJECT_TOOL", "WOW_CASC_LIBRARY");
  const firstProject = await mkdtemp(join(tmpdir(), "pi-direnv-first-project-"));
  const nextProject = await mkdtemp(join(tmpdir(), "pi-direnv-next-project-"));
  let firstHarness: PiHarness | undefined;
  let nextHarness: PiHarness | undefined;
  try {
    process.env.PROJECT_TOOL = "/ambient/tool";
    process.env.WOW_CASC_LIBRARY = "/ambient/casc.so";
    for (const project of [firstProject, nextProject]) {
      await mkdir(join(project, ".git"));
      await writeFile(join(project, ".envrc"), "");
    }

    firstHarness = createPiHarness({
      stdout: JSON.stringify({
        PROJECT_TOOL: "/first-project/bin/tool",
        WOW_CASC_LIBRARY: "/first-project/lib/libcasc.so",
      }),
      stderr: "",
      code: 0,
    });
    direnvSessionEnvironment(firstHarness.pi);
    await firstHarness.getHandler()({} as never, context(firstProject, []));
    expect(process.env.PROJECT_TOOL).toBe("/first-project/bin/tool");
    expect(process.env.WOW_CASC_LIBRARY).toBe("/first-project/lib/libcasc.so");

    await firstHarness.getHandler("session_shutdown")(
      { type: "session_shutdown", reason: "reload" } as never,
      context(firstProject, []),
    );
    expect(process.env.PROJECT_TOOL).toBe("/ambient/tool");
    expect(process.env.WOW_CASC_LIBRARY).toBe("/ambient/casc.so");

    nextHarness = createPiHarness({
      stdout: JSON.stringify({
        PROJECT_TOOL: "/failed-project/bin/tool",
        WOW_CASC_LIBRARY: "/failed-project/lib/libcasc.so",
      }),
      stderr: "devenv: error: failed to create /run/user/1000/devenv-9d3a18b",
      code: 0,
    });
    const snapshots: StartupOwnerSnapshot[] = [];
    nextHarness.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    direnvSessionEnvironment(nextHarness.pi);
    nextHarness.events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("session", "generation", "direnv"),
    );
    await nextHarness.getHandler()({} as never, context(nextProject, []));

    expect(nextHarness.registeredTools).toEqual([]);
    expect(process.env.PROJECT_TOOL).toBe("/ambient/tool");
    expect(process.env.WOW_CASC_LIBRARY).toBe("/ambient/casc.so");
    expect(snapshots.at(-1)).toMatchObject({
      state: "unavailable",
      payload: { problem: "load-failed" },
    });
    expect(snapshots.some((snapshot) => snapshot.state === "ready")).toBe(false);
  } finally {
    await firstHarness?.getHandler("session_shutdown")(
      { type: "session_shutdown", reason: "reload" } as never,
      context(firstProject, []),
    );
    await nextHarness?.getHandler("session_shutdown")(
      { type: "session_shutdown", reason: "quit" } as never,
      context(nextProject, []),
    );
    restoreEnvironment(originalEnvironment);
    await Promise.all([
      rm(firstProject, { recursive: true, force: true }),
      rm(nextProject, { recursive: true, force: true }),
    ]);
  }
});

test("publishes only existing direnv load results and does not evaluate for a header request", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-publisher-"));
  try {
    await mkdir(join(project, ".git"));
    await writeFile(join(project, ".envrc"), "");
    const harness = createPiHarness({
      code: 0,
      stderr: "",
      stdout: JSON.stringify({ PATH: "/repo/bin" }),
    });
    const snapshots: StartupOwnerSnapshot[] = [];
    harness.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    direnvSessionEnvironment(harness.pi);
    harness.events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("session", "generation", "direnv"),
    );
    expect(snapshots.at(-1)).toMatchObject({ state: "unavailable" });
    expect(harness.registeredTools).toEqual([]);
    await harness.getHandler()({} as never, context(project, []));
    expect(snapshots.at(-1)).toMatchObject({ state: "ready" });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("publishes missing direnv configuration as unavailable without exporting it", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-direnv-publisher-"));
  try {
    await mkdir(join(project, ".git"));
    const harness = createPiHarness({ code: 0, stderr: "", stdout: "{}" });
    const snapshots: StartupOwnerSnapshot[] = [];
    harness.events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) =>
      snapshots.push(value as StartupOwnerSnapshot),
    );
    direnvSessionEnvironment(harness.pi);
    harness.events.emit(
      "dotfiles:pi-startup-header/request/v1",
      createStartupOwnerRequest("session", "generation", "direnv"),
    );
    await harness.getHandler()({} as never, context(project, []));
    expect(snapshots.at(-1)).toMatchObject({
      state: "unavailable",
      payload: { problem: "missing" },
    });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
