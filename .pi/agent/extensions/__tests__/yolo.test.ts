import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isYoloModeEnabled, registerYoloCommand } from "../yolo";

type YoloCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;
type SessionShutdownHandler = () => void;

type PersistedEntry = {
  type: "custom";
  customType: string;
  data: unknown;
};

function createContext(
  sessionId: string,
  entries: PersistedEntry[],
  statuses: Array<[string, string | undefined]>,
  notifications: Array<[string, string]>,
): ExtensionContext {
  return {
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      theme: {
        fg: (color: string, value: string) => `${color}:${value}`,
      },
    },
    sessionManager: {
      getHeader: () => ({ id: sessionId }),
      getEntries: () => entries,
    },
  } as unknown as ExtensionContext;
}

function captureCommand(): {
  handler: YoloCommandHandler;
  commandName: string;
  sessionStart: SessionStartHandler | undefined;
  sessionShutdown: SessionShutdownHandler | undefined;
  permissionsReady: ((value: unknown) => void) | undefined;
  entries: PersistedEntry[];
} {
  let handler: YoloCommandHandler | undefined;
  let commandName = "";
  let sessionStart: SessionStartHandler | undefined;
  let sessionShutdown: SessionShutdownHandler | undefined;
  let permissionsReady: ((value: unknown) => void) | undefined;
  const entries: PersistedEntry[] = [];
  const pi = {
    registerCommand(name: string, command: { handler: YoloCommandHandler }) {
      commandName = name;
      handler = command.handler;
    },
    on(name: string, candidate: SessionStartHandler) {
      if (name === "session_start") sessionStart = candidate;
      if (name === "session_shutdown") sessionShutdown = candidate as SessionShutdownHandler;
    },
    events: {
      on(name: string, candidate: (value: unknown) => void) {
        if (name === "permissions:ready") permissionsReady = candidate;
      },
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI;

  registerYoloCommand(pi);
  if (handler === undefined) throw new Error("YOLO command was not registered");
  return { handler, commandName, sessionStart, sessionShutdown, permissionsReady, entries };
}

describe("YOLO mode", () => {
  test("persists each toggle in the current session", async () => {
    const { handler, commandName, entries } = captureCommand();
    const statuses: Array<[string, string | undefined]> = [];
    const notifications: Array<[string, string]> = [];
    const context = createContext("session-1", entries, statuses, notifications);

    await handler("", context as ExtensionCommandContext);
    await handler("", context as ExtensionCommandContext);

    expect(commandName).toBe("yolo");
    expect(entries).toEqual([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: true },
      },
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: false },
      },
    ]);
    expect(statuses).toEqual([
      ["pi-permission-system", "error:󱚝 yolo"],
      ["pi-permission-system", undefined],
    ]);
    expect(notifications.map(([message]) => message)).toEqual([
      "Session YOLO mode enabled. Ask-state permission checks and MCP tool approvals are auto-approved. Explicit denies still block.",
      "Session YOLO mode disabled. Ask-state permission checks and MCP tool approvals prompt when required.",
    ]);
  });

  test("restores the latest state for the active session only", () => {
    const entries: PersistedEntry[] = [
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "other-session", enabled: true },
      },
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: true },
      },
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: false },
      },
    ];
    const { sessionStart } = captureCommand();
    if (sessionStart === undefined)
      throw new Error("YOLO session-start handler was not registered");

    const statuses: Array<[string, string | undefined]> = [];
    const context = createContext("session-1", entries, statuses, []);
    sessionStart({}, context);

    expect(isYoloModeEnabled(context)).toBeFalse();
    expect(statuses).toEqual([["pi-permission-system", undefined]]);
  });

  test("registers the session state with the permission authorizer", async () => {
    const entries: PersistedEntry[] = [
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: true },
      },
    ];
    const { sessionStart, sessionShutdown, permissionsReady } = captureCommand();
    if (sessionStart === undefined || permissionsReady === undefined) {
      throw new Error("YOLO lifecycle handlers were not registered");
    }

    const serviceModule = (await import(
      new URL(
        "../../npm/node_modules/@gotgenes/pi-permission-system/src/service.ts",
        import.meta.url,
      ).href
    )) as {
      publishPermissionsService(
        sessionId: string,
        service: {
          registerAuthorizer(
            name: string,
            authorize: (...args: never[]) => Promise<{ kind: "allow" | "defer" }>,
          ): () => void;
        },
      ): void;
    };
    let registeredName = "";
    let authorize: ((...args: never[]) => Promise<{ kind: "allow" | "defer" }>) | undefined;
    let disposed = false;
    serviceModule.publishPermissionsService("session-1", {
      registerAuthorizer(name, handler) {
        registeredName = name;
        authorize = handler;
        return () => {
          disposed = true;
        };
      },
    });

    const context = createContext("session-1", entries, [], []);
    sessionStart({}, context);
    permissionsReady({ sessionId: "session-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registeredName).toBe("session-yolo");
    if (authorize === undefined) throw new Error("YOLO authorizer was not registered");
    expect(await authorize()).toEqual({ kind: "allow" });

    sessionShutdown?.();
    expect(disposed).toBeTrue();
  });

  test("reports the new state without reloading the UI", async () => {
    const { handler, entries } = captureCommand();
    const statuses: Array<[string, string | undefined]> = [];
    const context = createContext("session-1", entries, statuses, []);
    let reloads = 0;
    (context as ExtensionCommandContext).reload = async () => {
      reloads += 1;
    };

    await handler("", context as ExtensionCommandContext);

    expect(isYoloModeEnabled(context)).toBeTrue();
    expect(reloads).toBe(0);
  });

  test("ignores malformed session state", () => {
    const entries: PersistedEntry[] = [
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "session-1", enabled: "true" },
      },
    ];
    const context = createContext("session-1", entries, [], []);

    expect(isYoloModeEnabled(context)).toBeFalse();
  });
});
