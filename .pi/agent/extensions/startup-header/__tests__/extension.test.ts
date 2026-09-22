import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  STARTUP_OWNER_IDS,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
} from "../contracts";
import startupHeader from "../index";

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
    | ((tui: { requestRender(): void }, theme: Theme) => { render(width: number): string[] })
    | undefined;
  let renderRequests = 0;
  let usage: unknown;
  const model = { contextWindow: 200_000 };
  const context = {
    mode: "tui" as const,
    cwd: "/tmp/project",
    model,
    getContextUsage: () => usage,
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
  } as unknown as ExtensionContext;
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
  } as unknown as ExtensionAPI;
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
    setUsage(value: unknown) {
      usage = value;
    },
    setContextWindow(value: number) {
      model.contextWindow = value;
    },
    get renderRequests() {
      return renderRequests;
    },
  };
}

describe("startup header registration", () => {
  test("uses the model context window when public usage is initially unavailable", () => {
    const harness = createHarness();
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");

    expect(harness.render()).toEqual(["pi", "Context: ? / 200k"]);
    expect(harness.uiMutations).toEqual({ header: 1, footer: 0, editor: 0, status: 0 });
  });

  test("refreshes from public lifecycle events and never keeps compacted totals", () => {
    const harness = createHarness();
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");
    harness.setUsage({ tokens: 12_000, contextWindow: 200_000, percent: 6 });
    harness.emit("agent_end");
    expect(harness.render()).toContain("Context: ■■■■■■■■■■■■□□ 12k / 200k (6%)");

    harness.setUsage({ tokens: null, contextWindow: 200_000, percent: null });
    harness.emit("session_compact");
    expect(harness.render()).toContain("Context: ? / 200k");
    expect(harness.render().join("\n")).not.toContain("12k");

    harness.setUsage(undefined);
    harness.setContextWindow(128_000);
    harness.emit("model_select");
    expect(harness.render()).toContain("Context: ? / 128k");
    harness.setContextWindow(64_000);
    harness.emit("session_start");
    expect(harness.render()).toContain("Context: ? / 64k");
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

  test("stops context refreshes after session disposal", () => {
    const harness = createHarness();
    startupHeader(harness.pi, dependencies);
    harness.emit("session_start");
    harness.emit("session_shutdown");
    const before = harness.renderRequests;
    harness.setUsage({ tokens: 2_000, contextWindow: 200_000, percent: 1 });
    harness.emit("agent_end");
    expect(harness.renderRequests).toBe(before);
  });
});
