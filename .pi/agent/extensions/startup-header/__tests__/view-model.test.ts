import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderStartupHeader } from "../view-model";

const theme = { fg: (_color: string, text: string) => text } as Theme;

test("renders startup timing without context visualization", () => {
  expect(renderStartupHeader(theme, 160, 42.5)).toEqual(["pi", "Startup: 42.5ms"]);
});

test("renders update status", () => {
  const snapshot = {
    type: "reply" as const,
    schemaVersion: 1 as const,
    sessionId: "session",
    generationId: "generation",
    ownerId: "updates" as const,
    ownerRevision: 1,
    state: "ready" as const,
    payload: { coverage: "complete", available: 2 },
  };
  expect(renderStartupHeader(theme, 160, undefined, undefined, snapshot)).toContain(
    "Updates: 2 updates available",
  );
});
