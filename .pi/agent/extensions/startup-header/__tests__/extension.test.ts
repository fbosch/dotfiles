import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
} from "../contracts";
import startupHeader from "../index";
import type { StartupRuntimeSnapshot, StartupSnapshotAPI } from "../runtime-types";

type Handler = (event: unknown, context: unknown) => void;
const dependencies = {
  inspectWorkspace: async () => undefined,
  inspectCandidates: async () => ({
    formatter: { state: "unavailable" as const, candidates: [], overflow: [] },
    lsp: { state: "unavailable" as const, candidates: [], overflow: [] },
  }),
};

function readySnapshot(overrides: Partial<StartupRuntimeSnapshot> = {}): StartupRuntimeSnapshot {
  return {
    sessionId: "session-a",
    generationId: "generation-a",
    ownerId: "pi-runtime",
    ownerRevision: 1,
    resources: {
      status: "ready",
      value: {
        extensions: { enabled: 18, project: 3, loadFailed: 1 },
        skills: { available: 25, project: 2 },
      },
    },
    context: { status: "unavailable" },
    ...overrides,
  };
}

function createHarness(startupSnapshot?: unknown) {
  const handlers = new Map<string, Handler[]>();
  const busHandlers = new Map<string, Set<(value: unknown) => void>>();
  const emitted: { event: string; value: unknown }[] = [];
  const operations: string[] = [];
  const uiMutations = { header: 0, footer: 0, editor: 0, status: 0 };
  let headerFactory:
    | ((tui: { requestRender(): void }, theme: Theme) => { render(width: number): string[] })
    | undefined;
  let renderRequests = 0;
  const pi = {
    startupSnapshot,
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
  } as unknown as ExtensionAPI;
  const context = {
    mode: "tui",
    sessionManager: {
      getSessionId: () => "session-a",
      getEntries: () => [],
    },
    ui: {
      setHeader(factory: typeof headerFactory) {
        uiMutations.header += 1;
        headerFactory = factory;
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
  };
  const emit = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler({ type: event }, context);
  };
  const render = (width = 120, theme = { fg: (_color: string, text: string) => text } as Theme) => {
    const component = headerFactory?.({ requestRender: () => renderRequests++ }, theme);
    return component?.render(width) ?? [];
  };

  return {
    pi,
    emitted,
    operations,
    uiMutations,
    emit,
    render,
    get renderRequests() {
      return renderRequests;
    },
  };
}

describe("startup header registration", () => {
  test("registers in TUI mode without the runtime capability", () => {
    const harness = createHarness();
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");

    expect(harness.render()).toEqual(["π Session"]);
    expect(harness.uiMutations).toEqual({ header: 1, footer: 0, editor: 0, status: 0 });
    const light = { fg: (color: string, text: string) => `<light:${color}>${text}` } as Theme;
    const dark = { fg: (color: string, text: string) => `<dark:${color}>${text}` } as Theme;
    expect(harness.render(120, light)[0]).toContain("<light:accent>");
    expect(harness.render(120, dark)[0]).toContain("<dark:accent>");
  });

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
    harness.render();
    const allRequests = harness.emitted.filter(
      ({ event }) => event === STARTUP_OWNER_REQUEST_EVENT,
    );
    const current = allRequests.at(-1)?.value as { generationId: string };
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

    harness.pi.events.emit(STARTUP_OWNER_SNAPSHOT_EVENT, {
      type: "reply",
      schemaVersion: 1,
      sessionId: "session-a",
      generationId: current.generationId,
      ownerId: "lsp",
      ownerRevision: 1,
      state: "ready",
    });
    expect(harness.renderRequests).toBe(before + 1);
  });
  test("omits unavailable data without notices for absent or incompatible capabilities", () => {
    for (const capability of [undefined, { capability: "pi.startupSnapshot", schemaVersion: 2 }]) {
      const harness = createHarness(capability);
      startupHeader(harness.pi, dependencies);
      harness.emit("session_start");

      const rendered = harness.render().join("\n");
      expect(rendered).toBe("π Session");
      expect(rendered).not.toMatch(/unavailable|warning|capability/i);
    }
  });

  test("renders compatible resource data and redraws for newer revisions", () => {
    let listener: ((value: StartupRuntimeSnapshot) => void) | undefined;
    let unsubscribed = false;
    const capability: StartupSnapshotAPI = {
      capability: "pi.startupSnapshot",
      schemaVersion: 1,
      get: () => readySnapshot(),
      subscribe: (next) => {
        listener = next;
        return () => {
          unsubscribed = true;
        };
      },
    };
    const harness = createHarness(capability);
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");

    expect(harness.render().join("\n")).toContain("18 extensions · 1 failed (3 project)");
    listener?.(readySnapshot({ ownerRevision: 2 }));
    expect(harness.renderRequests).toBe(1);
    harness.emit("session_shutdown");
    expect(unsubscribed).toBe(true);
  });
});
