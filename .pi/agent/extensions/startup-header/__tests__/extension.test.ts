import { describe, expect, test } from "bun:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
} from "../contracts";
import startupHeader from "../index";

interface HeaderComponent {
  render(width: number): string[];
  handleMouse?(event: TuiMouseEvent): { handled?: boolean } | undefined;
}

type Handler = (event: unknown, context: ExtensionContext) => void;

const dependencies = {
  inspectWorkspace: async () => undefined,
  inspectRepositoryFiles: async () => ({ files: [], truncated: false }),
  loadArt: () => undefined,
  inspectCandidates: async () => ({
    lsp: { state: "unavailable" as const, candidates: [], overflow: [] },
  }),
};

function createHarness() {
  const handlers = new Map<string, Handler[]>();
  const busHandlers = new Map<string, Set<(value: unknown) => void>>();
  const emitted: { event: string; value: unknown }[] = [];
  const operations: string[] = [];
  const uiMutations = { header: 0, footer: 0, editor: 0, status: 0 };
  let headerFactory:
    | ((tui: { requestRender(): void }, theme: Theme) => HeaderComponent)
    | undefined;
  let headerComponent: HeaderComponent | undefined;
  let shortcutHandler: ((context: ExtensionContext) => Promise<void> | void) | undefined;
  let commandHandler:
    | ((args: string, context: ExtensionCommandContext) => Promise<void>)
    | undefined;
  let commandTask: Promise<void> | undefined;
  let reloadCount = 0;
  const notifications: string[] = [];
  let renderRequests = 0;
  const context = {
    mode: "tui" as const,
    reload: async () => {
      reloadCount += 1;
    },
    cwd: "/tmp/project",
    sessionManager: {
      getSessionId: () => "session-a",
      getEntries: () => [],
    },
    ui: {
      setHeader(factory: typeof headerFactory) {
        uiMutations.header += 1;
        headerFactory = factory;
      },
      confirm: async () => true,
      notify(message: string) {
        notifications.push(message);
      },
      setFooter() {
        uiMutations.footer += 1;
      },
      setEditorComponent() {
        uiMutations.editor += 1;
      },
      setStatus() {
        uiMutations.status += 1;
      },
    },
  } as unknown as ExtensionCommandContext;
  const pi = {
    events: {
      on(event: string, listener: (value: unknown) => void) {
        operations.push(`on:${event}`);
        const listeners = busHandlers.get(event) ?? new Set();
        listeners.add(listener);
        busHandlers.set(event, listeners);
        return () => listeners.delete(listener);
      },
      emit(event: string, value: unknown) {
        operations.push(`emit:${event}`);
        emitted.push({ event, value });
        for (const listener of busHandlers.get(event) ?? []) listener(value);
      },
    },
    on(event: string, handler: Handler) {
      const registered = handlers.get(event) ?? [];
      registered.push(handler);
      handlers.set(event, registered);
    },
    registerShortcut(
      _shortcut: string,
      options: { handler: (context: ExtensionContext) => Promise<void> | void },
    ) {
      shortcutHandler = options.handler;
    },
    registerCommand(
      _name: string,
      options: { handler: (args: string, context: ExtensionCommandContext) => Promise<void> },
    ) {
      commandHandler = options.handler;
    },
    sendUserMessage(content: string, options?: { expandPromptTemplates?: boolean }) {
      if (content !== "/startup-header-update-all" || options?.expandPromptTemplates !== true)
        return;
      commandTask = commandHandler?.("", context);
    },
  } as unknown as ExtensionAPI;
  const emit = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler({ type: event }, context);
  };
  const render = (width = 120, theme = { fg: (_color: string, text: string) => text } as Theme) => {
    headerComponent = headerFactory?.({ requestRender: () => renderRequests++ }, theme);
    return headerComponent?.render(width) ?? [];
  };

  return {
    pi,
    emitted,
    operations,
    uiMutations,
    emit,
    render,
    clickHeader(event: TuiMouseEvent) {
      return headerComponent?.handleMouse?.(event);
    },
    shortcutHandler: () => shortcutHandler,
    triggerShortcut: () => shortcutHandler?.(context),
    waitForCommand: async () => {
      if (commandTask === undefined) throw new Error("Update-all command was not dispatched");
      await commandTask;
    },
    get reloadCount() {
      return reloadCount;
    },
    notifications,
    get renderRequests() {
      return renderRequests;
    },
  };
}

function publishUpdateSnapshot(
  harness: ReturnType<typeof createHarness>,
  update: { name: string; current: string; latest: string; scope: "user" | "project" },
): void {
  const value = harness.emitted
    .filter(({ event }) => event === STARTUP_OWNER_REQUEST_EVENT)
    .map(({ value }) => value)
    .find((request) => {
      if (typeof request !== "object" || request === null) return false;
      return "ownerId" in request && request.ownerId === "updates";
    });
  if (typeof value !== "object" || value === null)
    throw new Error("Update owner was not requested");
  const request = value as { sessionId: string; generationId: string };
  const now = Date.now();
  harness.pi.events.emit(STARTUP_OWNER_SNAPSHOT_EVENT, {
    type: "reply",
    schemaVersion: 1,
    sessionId: request.sessionId,
    generationId: request.generationId,
    ownerId: "updates",
    ownerRevision: 1,
    state: "ready",
    observedAt: now,
    staleAt: now + 60_000,
    expiresAt: now + 120_000,
    payload: { coverage: "complete", available: 1, updates: [update] },
  });
}

describe("startup header registration", () => {
  test("subscribes before requesting owners and rejects replies from replaced generations", () => {
    const harness = createHarness();
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");

    expect(harness.operations.indexOf(`on:${STARTUP_OWNER_SNAPSHOT_EVENT}`)).toBeLessThan(
      harness.operations.indexOf(`emit:${STARTUP_OWNER_REQUEST_EVENT}`),
    );
    const firstRequests = harness.emitted.filter(
      ({ event }) => event === STARTUP_OWNER_REQUEST_EVENT,
    );
    expect(firstRequests).toHaveLength(STARTUP_OWNER_IDS.length);
    const first = firstRequests[0]?.value as { generationId: string; sessionId: string };
    expect(first.sessionId).toBe("session-a");

    harness.emit("session_start");
    const current = harness.emitted
      .filter(({ event }) => event === STARTUP_OWNER_REQUEST_EVENT)
      .at(-1)?.value as { generationId: string };
    expect(current.generationId).not.toBe(first.generationId);

    const before = harness.renderRequests;
    harness.pi.events.emit(STARTUP_OWNER_SNAPSHOT_EVENT, {
      type: "reply",
      schemaVersion: 1,
      sessionId: "session-a",
      generationId: first.generationId,
      ownerId: "lsp",
      ownerRevision: 1,
      state: "ready",
    });
    expect(harness.renderRequests).toBe(before);
  });

  test("renders a clickable update-all action beneath the available updates", async () => {
    const harness = createHarness();
    let installed: readonly {
      name: string;
      current: string;
      latest: string;
      scope: "user" | "project";
    }[] = [];
    startupHeader(harness.pi, {
      ...dependencies,
      updateAllPackages: async (_context, updates) => {
        installed = updates;
        return { updated: updates.length, failed: [], cancelled: false };
      },
    });
    harness.emit("session_start");
    const update = {
      name: "@acme/tool",
      current: "1.0.0",
      latest: "2.0.0",
      scope: "project" as const,
    };
    publishUpdateSnapshot(harness, update);

    const lines = harness.render();
    const detailRow = lines.findIndex((line) => line.includes("@acme/tool 1.0.0 → 2.0.0"));
    const buttonRow = lines.findIndex((line) => line.includes("[ Update all ]"));
    expect(buttonRow).toBeGreaterThan(detailRow);
    expect(lines[buttonRow]).toContain("Ctrl+Alt+U");

    expect(
      harness.clickHeader({
        type: "click",
        button: "left",
        x: 2,
        y: buttonRow,
        screenX: 2,
        screenY: buttonRow,
        width: 120,
        height: lines.length,
        shift: false,
        alt: false,
        ctrl: false,
      }),
    ).toEqual({ handled: true });
    await harness.waitForCommand();

    expect(installed).toEqual([update]);
    expect(harness.notifications).toEqual([
      "Updated 1 package. Reloading Pi to activate the updates.",
    ]);
    expect(harness.reloadCount).toBe(1);
    expect(harness.render()).toContain("Reloading Pi to activate updates…");
  });

  test("registers the keyboard shortcut as an alternate update action", async () => {
    const harness = createHarness();
    let updatesRun = 0;
    startupHeader(harness.pi, {
      ...dependencies,
      updateAllPackages: async (_context, updates) => {
        updatesRun = updates.length;
        return { updated: updates.length, failed: [], cancelled: false };
      },
    });
    harness.emit("session_start");
    publishUpdateSnapshot(harness, {
      name: "package",
      current: "1.0.0",
      latest: "2.0.0",
      scope: "user",
    });

    harness.triggerShortcut();
    await harness.waitForCommand();

    expect(updatesRun).toBe(1);
    expect(harness.reloadCount).toBe(1);
  });

  test("does not reload when every update fails", async () => {
    const harness = createHarness();
    startupHeader(harness.pi, {
      ...dependencies,
      updateAllPackages: async () => ({ updated: 0, failed: ["package"], cancelled: false }),
    });
    harness.emit("session_start");
    publishUpdateSnapshot(harness, {
      name: "package",
      current: "1.0.0",
      latest: "2.0.0",
      scope: "user",
    });

    harness.triggerShortcut();
    await harness.waitForCommand();

    expect(harness.reloadCount).toBe(0);
    expect(harness.notifications).toEqual(["Could not update: package."]);
  });
});
