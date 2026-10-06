import { expect, test } from "bun:test";
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

type SessionStartHandler = (event: never, context: ExtensionContext) => Promise<void> | void;

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
  getHandler(): SessionStartHandler;
  registeredTools: RegisteredTool[];
  getSettingsCalls(): number;
}

function createPiHarness(
  exported: { stdout: string; stderr: string; code: number },
  piCommaPrefix?: string,
  settings: Pick<ReturnType<ExtensionAPI["getSettings"]>, "shellPath" | "shellCommandPrefix"> = {},
): PiHarness {
  let handler: SessionStartHandler | undefined;
  let getSettingsCalls = 0;
  const registeredTools: RegisteredTool[] = [];
  const events = createEventBus();
  const pi = {
    on(event: string, candidate: SessionStartHandler) {
      if (event === "session_start") handler = candidate;
    },
    exec: async () => ({ ...exported, killed: false }),
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
    const prefixMarker = join(project, "prefix-marker");
    const settingsMarker = join(project, "settings-marker");
    const environmentMarker = join(project, "environment-marker");
    const harness = createPiHarness(
      {
        stdout: JSON.stringify({ PROJECT_TOOL: "/repo/bin/tool" }),
        stderr: "",
        code: 0,
      },
      `printf pi-comma > ${JSON.stringify(prefixMarker)}`,
      {
        shellCommandPrefix: `printf settings > ${JSON.stringify(settingsMarker)}`,
        shellPath: "/bin/bash",
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
    await bashTool.execute(
      "direnv-composition",
      {
        command: `printf '%s|%s' "$PROJECT_TOOL" "$PI_SESSION_ID" > ${JSON.stringify(environmentMarker)}`,
        timeout: 1,
      },
      undefined,
      undefined,
      toolContext,
    );
    expect(await readFile(settingsMarker, "utf8")).toBe("settings");
    expect(await readFile(prefixMarker, "utf8")).toBe("pi-comma");
    expect(await readFile(environmentMarker, "utf8")).toBe("/repo/bin/tool|fixture-session");
    expect(harness.getSettingsCalls()).toBe(1);
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
    expect(snapshots.at(-1)).toMatchObject({ state: "degraded", payload: { problem: "blocked" } });
    expect(notifications).toEqual(["direnv: .envrc is blocked. Run `direnv allow` to enable it."]);
  } finally {
    await rm(project, { recursive: true, force: true });
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
