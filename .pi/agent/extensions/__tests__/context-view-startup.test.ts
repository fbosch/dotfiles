import { expect, test } from "bun:test";
import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import contextViewStartupPublisher from "../context-view-startup";
import {
  createStartupOwnerRequest,
  STARTUP_OWNER_REQUEST_EVENT,
  STARTUP_OWNER_SNAPSHOT_EVENT,
  type StartupOwnerSnapshot,
} from "../startup-header/contracts";

test("publishes public context usage through the existing owner protocol", () => {
  const events = createEventBus();
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const snapshots: StartupOwnerSnapshot[] = [];
  let usage: unknown;
  const context = {
    mode: "tui" as const,
    model: { contextWindow: 200_000 },
    getContextUsage: () => usage,
  } as unknown as ExtensionContext;
  const pi = {
    events,
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  events.on(STARTUP_OWNER_SNAPSHOT_EVENT, (value) => snapshots.push(value as StartupOwnerSnapshot));

  contextViewStartupPublisher(pi);
  events.emit(
    STARTUP_OWNER_REQUEST_EVENT,
    createStartupOwnerRequest("session", "generation", "context"),
  );
  expect(snapshots.at(-1)).toMatchObject({ state: "unavailable" });

  handlers.get("session_start")?.({ type: "session_start" }, context);
  expect(snapshots.at(-1)).toMatchObject({
    state: "ready",
    payload: { tokens: null, contextWindow: 200_000, percent: null },
  });

  usage = { tokens: 100, contextWindow: 200_000, percent: 0.05 };
  handlers.get("agent_end")?.({ type: "agent_end" }, context);
  expect(snapshots.at(-1)).toMatchObject({ state: "ready", payload: { tokens: 100 } });
  expect(JSON.stringify(snapshots)).not.toMatch(/prompt text|tool schema|file content/i);

  usage = { tokens: null, contextWindow: 200_000, percent: null };
  handlers.get("session_compact")?.({ type: "session_compact" }, context);
  expect(snapshots.at(-1)).toMatchObject({ state: "ready", payload: { tokens: null } });

  handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);
  expect(snapshots.at(-1)).toMatchObject({ state: "disposed" });
});
