import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  isYoloEffectiveStateEvent,
  registerYoloCommand,
  YOLO_EFFECTIVE_STATE_CHANNEL,
  YOLO_STATUS_TEXT,
} from "../yolo";

type YoloCommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type SessionStartHandler = (event: unknown, ctx: ExtensionContext) => void;
type SessionShutdownHandler = () => void;
type EventHandler = (value: unknown) => void;
type PersistedEntry = { type: "custom"; customType: string; data: unknown };
type EmittedEvent = { name: string; value: unknown };
type AuthorizerVerdict = { kind: "allow" | "defer" };
type Authorizer = (...args: never[]) => Promise<AuthorizerVerdict>;

interface YoloHarness {
  commandName: string;
  entries: PersistedEntry[];
  emitted: EmittedEvent[];
  handler: YoloCommandHandler;
  sessionStart: SessionStartHandler;
  sessionShutdown: SessionShutdownHandler;
  permissionsReady(value: unknown): void;
}

interface PublishedPermissionService {
  registrations(): number;
  registeredName(): string;
  disposed(): boolean;
  verdict(): Promise<AuthorizerVerdict>;
}

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

function createHarness(initialEntries: PersistedEntry[] = []): YoloHarness {
  let handler: YoloCommandHandler | undefined;
  let commandName = "";
  let sessionStart: SessionStartHandler | undefined;
  let sessionShutdown: SessionShutdownHandler | undefined;
  let permissionsReady: EventHandler | undefined;
  const entries = [...initialEntries];
  const emitted: EmittedEvent[] = [];
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
      on(name: string, candidate: EventHandler) {
        if (name === "permissions:ready") permissionsReady = candidate;
        return () => {
          if (permissionsReady === candidate) permissionsReady = undefined;
        };
      },
      emit(name: string, value: unknown) {
        emitted.push({ name, value });
      },
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as ExtensionAPI;

  registerYoloCommand(pi);
  if (handler === undefined || sessionStart === undefined || sessionShutdown === undefined) {
    throw new Error("YOLO lifecycle was not registered");
  }

  return {
    get commandName() {
      return commandName;
    },
    entries,
    emitted,
    handler,
    sessionStart,
    sessionShutdown,
    permissionsReady(value) {
      if (permissionsReady === undefined)
        throw new Error("Permission readiness was not registered");
      permissionsReady(value);
    },
  };
}

async function publishPermissionService(sessionId: string): Promise<PublishedPermissionService> {
  const serviceModule = (await import(
    new URL("../../npm/node_modules/@gotgenes/pi-permission-system/src/service.ts", import.meta.url)
      .href
  )) as {
    publishPermissionsService(
      sessionId: string,
      service: {
        registerAuthorizer(name: string, authorize: Authorizer): () => void;
      },
    ): void;
  };
  let authorize: Authorizer | undefined;
  let registeredName = "";
  let registrationCount = 0;
  let isDisposed = false;
  serviceModule.publishPermissionsService(sessionId, {
    registerAuthorizer(name, candidate) {
      registrationCount += 1;
      registeredName = name;
      authorize = candidate;
      return () => {
        isDisposed = true;
      };
    },
  });

  return {
    registrations: () => registrationCount,
    registeredName: () => registeredName,
    disposed: () => isDisposed,
    async verdict() {
      if (authorize === undefined) throw new Error("YOLO authorizer was not registered");
      return authorize();
    },
  };
}

function effectiveStates(harness: YoloHarness, sessionId: string): boolean[] {
  return harness.emitted.flatMap(({ name, value }) => {
    if (
      name !== YOLO_EFFECTIVE_STATE_CHANNEL ||
      !isYoloEffectiveStateEvent(value) ||
      value.sessionId !== sessionId
    ) {
      return [];
    }
    return [value.effectiveEnabled];
  });
}

async function settleRegistration(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session YOLO mode", () => {
  test("rejects enablement before permission registration", async () => {
    const harness = createHarness();
    const statuses: Array<[string, string | undefined]> = [];
    const notifications: Array<[string, string]> = [];
    const context = createContext("yolo-not-ready", harness.entries, statuses, notifications);
    harness.sessionStart({}, context);

    await harness.handler("", context as ExtensionCommandContext);

    expect(harness.commandName).toBe("yolo");
    expect(harness.entries).toEqual([]);
    expect(effectiveStates(harness, "yolo-not-ready")).toEqual([false]);
    expect(statuses).toEqual([["pi-permission-system", undefined]]);
    expect(notifications).toEqual([
      ["Cannot enable session YOLO before permission-system is ready.", "error"],
    ]);
  });

  test("restores intent after registration and persists accepted toggles", async () => {
    const sessionId = "yolo-restored";
    const harness = createHarness([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: true },
      },
    ]);
    const permissions = await publishPermissionService(sessionId);
    const statuses: Array<[string, string | undefined]> = [];
    const notifications: Array<[string, string]> = [];
    const context = createContext(sessionId, harness.entries, statuses, notifications);
    harness.sessionStart({}, context);

    expect(effectiveStates(harness, sessionId)).toEqual([false]);
    harness.permissionsReady({ sessionId });
    await settleRegistration();

    expect(permissions.registrations()).toBe(1);
    expect(permissions.registeredName()).toBe("session-yolo");
    expect(await permissions.verdict()).toEqual({ kind: "allow" });
    expect(effectiveStates(harness, sessionId)).toEqual([false, false, true]);

    await harness.handler("", context as ExtensionCommandContext);
    expect(await permissions.verdict()).toEqual({ kind: "defer" });
    await harness.handler("", context as ExtensionCommandContext);
    expect(await permissions.verdict()).toEqual({ kind: "allow" });

    expect(harness.entries.slice(-2)).toEqual([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: false },
      },
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: true },
      },
    ]);
    expect(statuses).toEqual([
      ["pi-permission-system", undefined],
      ["pi-permission-system", undefined],
      ["pi-permission-system", `error:${YOLO_STATUS_TEXT}`],
      ["pi-permission-system", undefined],
      ["pi-permission-system", `error:${YOLO_STATUS_TEXT}`],
    ]);
    expect(notifications.map(([message]) => message)).toEqual([
      "Session YOLO mode disabled. Permission checks and MCP tool approvals prompt when required.",
      "Session YOLO mode enabled. Ordinary ask-state permission checks and MCP tool approvals are auto-approved. Path-sensitive asks and explicit denies still block.",
    ]);
  });

  test("does not inherit requested state from another session", async () => {
    const harness = createHarness([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId: "parent-session", enabled: true },
      },
    ]);
    const permissions = await publishPermissionService("derived-session");
    const context = createContext("derived-session", harness.entries, [], []);
    harness.sessionStart({}, context);
    harness.permissionsReady({ sessionId: "derived-session" });
    await settleRegistration();

    expect(await permissions.verdict()).toEqual({ kind: "defer" });
    expect(effectiveStates(harness, "derived-session")).toEqual([false, false, false]);
  });

  test("fails closed after registration failure and retries on a later readiness event", async () => {
    const sessionId = "yolo-retry";
    const harness = createHarness();
    const notifications: Array<[string, string]> = [];
    const context = createContext(sessionId, harness.entries, [], notifications);
    harness.sessionStart({}, context);
    harness.permissionsReady({ sessionId });
    await settleRegistration();

    await harness.handler("", context as ExtensionCommandContext);
    expect(harness.entries).toEqual([]);
    expect(notifications[0]?.[0]).toContain("Could not register session YOLO authorization");
    expect(notifications[1]).toEqual([
      "Cannot enable session YOLO because permission-system registration failed.",
      "error",
    ]);

    const permissions = await publishPermissionService(sessionId);
    harness.permissionsReady({ sessionId });
    await settleRegistration();
    await harness.handler("", context as ExtensionCommandContext);

    expect(permissions.registrations()).toBe(1);
    expect(await permissions.verdict()).toEqual({ kind: "allow" });
    expect(harness.entries.at(-1)?.data).toEqual({ sessionId, enabled: true });
  });

  test("allows restored intent to be disabled while registration is unavailable", async () => {
    const sessionId = "yolo-disable-pending";
    const harness = createHarness([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: true },
      },
    ]);
    const context = createContext(sessionId, harness.entries, [], []);
    harness.sessionStart({}, context);

    await harness.handler("", context as ExtensionCommandContext);

    expect(harness.entries.at(-1)?.data).toEqual({ sessionId, enabled: false });
    expect(effectiveStates(harness, sessionId)).toEqual([false, false]);
  });

  test("ignores malformed readiness and persisted state", async () => {
    const sessionId = "yolo-malformed";
    const harness = createHarness([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: "true" },
      },
    ]);
    const context = createContext(sessionId, harness.entries, [], []);
    harness.sessionStart({}, context);

    harness.permissionsReady({ sessionId: "" });
    harness.permissionsReady({ sessionId: "other-session" });
    await harness.handler("", context as ExtensionCommandContext);

    expect(harness.entries).toHaveLength(1);
    expect(effectiveStates(harness, sessionId)).toEqual([false]);
  });

  test("revokes effective state and disposes the authorizer on shutdown", async () => {
    const sessionId = "yolo-shutdown";
    const harness = createHarness([
      {
        type: "custom",
        customType: "yolo-mode",
        data: { sessionId, enabled: true },
      },
    ]);
    const permissions = await publishPermissionService(sessionId);
    const context = createContext(sessionId, harness.entries, [], []);
    harness.sessionStart({}, context);
    harness.permissionsReady({ sessionId });
    await settleRegistration();

    harness.sessionShutdown();

    expect(effectiveStates(harness, sessionId).at(-1)).toBeFalse();
    expect(await permissions.verdict()).toEqual({ kind: "defer" });
    expect(permissions.disposed()).toBeTrue();
  });

  test("keeps global YOLO config disabled and links only the session authorizer", async () => {
    const config = JSON.parse(
      await readFile(new URL("../pi-permission-system/config.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect("yoloMode" in config).toBeFalse();
    expect(config.authorizerChain).toEqual(["session-yolo"]);
  });
});
