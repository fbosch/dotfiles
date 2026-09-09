import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  isPermissionsStrictStateEvent,
  PERMISSIONS_STRICT_STATE_CHANNEL,
  PERMISSIONS_STRICT_STATUS_KEY,
  PERMISSIONS_STRICT_STATUS_TEXT,
  registerPermissionsMode,
} from "../permissions-mode";

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type LifecycleHandler = (event: unknown, ctx: ExtensionContext) => void;
type EventHandler = (value: unknown) => void;
type Entry = { type: "custom"; customType: string; data: unknown };
type Verdict = { kind: "allow" | "defer" };
type Authorizer = (details: unknown) => Promise<Verdict>;

interface Harness {
  commandName: string;
  entries: Entry[];
  emitted: Array<{ name: string; value: unknown }>;
  handler: CommandHandler;
  start(ctx: ExtensionContext): void;
  shutdown(): void;
  ready(sessionId: string): void;
}

function context(
  sessionId: string,
  entries: Entry[],
  statuses: Array<[string, string | undefined]> = [],
  notifications: Array<[string, string]> = [],
): ExtensionContext {
  return {
    ui: {
      notify: (message: string, level: string) => notifications.push([message, level]),
      setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
      theme: { fg: (color: string, value: string) => `${color}:${value}` },
    },
    sessionManager: {
      getHeader: () => ({ id: sessionId }),
      getEntries: () => entries,
    },
  } as unknown as ExtensionContext;
}

function createHarness(initialEntries: Entry[] = []): Harness {
  let commandName = "";
  let handler: CommandHandler | undefined;
  let sessionStart: LifecycleHandler | undefined;
  let sessionShutdown: (() => void) | undefined;
  let permissionsReady: EventHandler | undefined;
  const entries = [...initialEntries];
  const emitted: Array<{ name: string; value: unknown }> = [];
  const pi = {
    registerCommand(name: string, command: { handler: CommandHandler }) {
      commandName = name;
      handler = command.handler;
    },
    on(name: string, candidate: LifecycleHandler) {
      if (name === "session_start") sessionStart = candidate;
      if (name === "session_shutdown") sessionShutdown = candidate as () => void;
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

  registerPermissionsMode(pi);
  if (handler === undefined || sessionStart === undefined || sessionShutdown === undefined) {
    throw new Error("Permissions mode lifecycle was not registered");
  }

  return {
    get commandName() {
      return commandName;
    },
    entries,
    emitted,
    handler,
    start: (ctx) => sessionStart?.({}, ctx),
    shutdown: () => sessionShutdown?.(),
    ready(sessionId) {
      if (permissionsReady === undefined)
        throw new Error("Permission readiness was not registered");
      permissionsReady({ sessionId });
    },
  };
}

async function publishPermissionService(sessionId: string): Promise<{
  verdict(details: unknown): Promise<Verdict>;
  disposed(): boolean;
}> {
  const serviceModule = (await import(
    new URL("../../npm/node_modules/@gotgenes/pi-permission-system/src/service.ts", import.meta.url)
      .href
  )) as {
    publishPermissionsService(
      sessionId: string,
      service: { registerAuthorizer(name: string, authorize: Authorizer): () => void },
    ): void;
  };
  let authorize: Authorizer | undefined;
  let disposed = false;
  serviceModule.publishPermissionsService(sessionId, {
    registerAuthorizer(_name, candidate) {
      authorize = candidate;
      return () => {
        disposed = true;
      };
    },
  });

  return {
    async verdict(details) {
      if (authorize === undefined) throw new Error("Permission authorizer was not registered");
      return authorize(details);
    },
    disposed: () => disposed,
  };
}

async function settleRegistration(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function strictStates(harness: Harness, sessionId: string): boolean[] {
  return harness.emitted.flatMap(({ name, value }) => {
    if (
      name !== PERMISSIONS_STRICT_STATE_CHANNEL ||
      !isPermissionsStrictStateEvent(value) ||
      value.sessionId !== sessionId
    ) {
      return [];
    }
    return [value.strictEnabled];
  });
}

describe("permissions mode", () => {
  test("normal mode prompts only for Codex-dangerous or unclassifiable Bash", async () => {
    const sessionId = "permissions-normal";
    const harness = createHarness();
    const permissions = await publishPermissionService(sessionId);
    harness.start(context(sessionId, harness.entries));
    harness.ready(sessionId);
    await settleRegistration();

    for (const details of [
      { surface: "bash", command: "git reset --hard" },
      { surface: "bash", command: "python -c 'print(1)'" },
      { surface: "path_write", value: "/tmp/example" },
      { surface: "mcp__github" },
      { surface: "worktrunk" },
      { surface: "synthetic-tool" },
    ]) {
      expect(await permissions.verdict(details)).toEqual({ kind: "allow" });
    }

    for (const details of [
      { surface: "bash", command: "rm -rf /tmp/example" },
      { surface: "bash", command: "bash -lc 'sudo rm --force /tmp/example'" },
      { surface: "bash", command: "if then" },
      { surface: "bash" },
      {},
    ]) {
      expect(await permissions.verdict(details)).toEqual({ kind: "defer" });
    }
  });

  test("strict mode defers every permission request until normal mode is restored", async () => {
    const sessionId = "permissions-strict";
    const statuses: Array<[string, string | undefined]> = [];
    const notifications: Array<[string, string]> = [];
    const harness = createHarness();
    const permissions = await publishPermissionService(sessionId);
    const ctx = context(sessionId, harness.entries, statuses, notifications);
    harness.start(ctx);
    harness.ready(sessionId);
    await settleRegistration();

    await harness.handler("strict", ctx as ExtensionCommandContext);
    expect(await permissions.verdict({ surface: "synthetic-tool" })).toEqual({ kind: "defer" });
    expect(statuses.at(-1)).toEqual([
      PERMISSIONS_STRICT_STATUS_KEY,
      `warning:${PERMISSIONS_STRICT_STATUS_TEXT}`,
    ]);

    await harness.handler("normal", ctx as ExtensionCommandContext);
    expect(await permissions.verdict({ surface: "synthetic-tool" })).toEqual({ kind: "allow" });
    expect(statuses.at(-1)).toEqual([PERMISSIONS_STRICT_STATUS_KEY, undefined]);
    expect(notifications.map(([message]) => message)).toEqual([
      "Strict permissions enabled. Every permission request requires confirmation.",
      "Normal permissions enabled. Only dangerous or unclassifiable commands require confirmation.",
    ]);
    expect(strictStates(harness, sessionId)).toEqual([false, true, false]);
  });

  test("restores strict mode only for its owning session", async () => {
    const entries: Entry[] = [
      {
        type: "custom",
        customType: "permissions-mode",
        data: { sessionId: "strict-owner", strictEnabled: true },
      },
    ];
    const ownerHarness = createHarness(entries);
    const ownerPermissions = await publishPermissionService("strict-owner");
    ownerHarness.start(context("strict-owner", ownerHarness.entries));
    ownerHarness.ready("strict-owner");
    await settleRegistration();
    expect(await ownerPermissions.verdict({ surface: "synthetic-tool" })).toEqual({
      kind: "defer",
    });

    const otherHarness = createHarness(entries);
    const otherPermissions = await publishPermissionService("other-session");
    otherHarness.start(context("other-session", otherHarness.entries));
    otherHarness.ready("other-session");
    await settleRegistration();
    expect(await otherPermissions.verdict({ surface: "synthetic-tool" })).toEqual({
      kind: "allow",
    });
  });

  test("registers /permissions and validates its mode argument", async () => {
    const notifications: Array<[string, string]> = [];
    const harness = createHarness();
    const ctx = context("permissions-command", harness.entries, [], notifications);
    harness.start(ctx);

    await harness.handler("", ctx as ExtensionCommandContext);
    await harness.handler("yolo", ctx as ExtensionCommandContext);

    expect(harness.commandName).toBe("permissions");
    expect(notifications).toEqual([
      ["Usage: /permissions strict|normal", "warning"],
      ["Usage: /permissions strict|normal", "warning"],
    ]);
  });

  test("disposes the authorizer and fails closed after shutdown", async () => {
    const sessionId = "permissions-shutdown";
    const harness = createHarness();
    const permissions = await publishPermissionService(sessionId);
    harness.start(context(sessionId, harness.entries));
    harness.ready(sessionId);
    await settleRegistration();

    harness.shutdown();

    expect(permissions.disposed()).toBeTrue();
    expect(await permissions.verdict({ surface: "synthetic-tool" })).toEqual({ kind: "defer" });
  });
});
