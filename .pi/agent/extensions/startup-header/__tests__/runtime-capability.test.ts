import { expect, test } from "bun:test";
import { readStartupRuntimeSnapshot } from "../runtime-capability";

const envelope = {
  sessionId: "session",
  generationId: "generation",
  ownerId: "pi-runtime",
  ownerRevision: 1,
};

test("isolates malformed optional runtime sections", () => {
  const validResources = {
    status: "ready",
    value: {
      extensions: { enabled: 3, project: 1, loadFailed: 0 },
      skills: { available: 4, project: 1 },
    },
  };
  const validContext = {
    status: "ready",
    value: {
      contextWindowTokens: 100,
      autoCompactReserveTokens: 6,
      estimatedTokens: 20,
      categories: [{ id: "system-prompt", tokens: 20 }],
    },
  };

  expect(
    readStartupRuntimeSnapshot({
      ...envelope,
      resources: validResources,
      context: { status: "ready", value: { autoCompactReserveTokens: 101 } },
    }),
  ).toMatchObject({ resources: validResources, context: { status: "unavailable" } });
  expect(
    readStartupRuntimeSnapshot({
      ...envelope,
      resources: { status: "ready", value: { prompt: "CANARY_RAW_PROMPT" } },
      context: validContext,
    }),
  ).toMatchObject({ resources: { status: "unavailable" }, context: validContext });
});
