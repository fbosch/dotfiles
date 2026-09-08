import { describe, expect, test } from "bun:test";
import { readHeaderOwnerSnapshot } from "../header-snapshot";

function snapshot(ownerId: string, payload: unknown) {
  return {
    type: "reply",
    schemaVersion: 1,
    sessionId: "session",
    generationId: "generation",
    ownerId,
    ownerRevision: 1,
    state: "ready",
    payload,
  };
}

describe("header owner snapshot boundary", () => {
  test("reconstructs auth payloads from allowlisted display fields", () => {
    const result = readHeaderOwnerSnapshot(
      snapshot("auth", {
        activeProfile: "work",
        accessToken: "CANARY_ACCESS_TOKEN",
        profiles: [
          {
            profileLabel: "work",
            status: "reported",
            provider: "openai-codex",
            windows: [{ windowId: "primary", remaining: 40, privateId: "CANARY_PRIVATE" }],
            observedAt: 10,
            staleAt: 20,
            rawCredential: "CANARY_CREDENTIAL",
          },
        ],
      }),
    );

    expect(result?.payload).toEqual({
      activeProfile: "work",
      profiles: [
        {
          profileLabel: "work",
          status: "reported",
          provider: "openai-codex",
          windows: [{ windowId: "primary", remaining: 40 }],
          observedAt: 10,
          staleAt: 20,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

  test("strips raw integration and unsupported owner payloads", () => {
    const lsp = readHeaderOwnerSnapshot(
      snapshot("lsp", {
        observedDocuments: 2,
        rawError: "CANARY_ERROR",
        commandArgs: ["--token", "CANARY_TOKEN"],
      }),
    );
    const resources = readHeaderOwnerSnapshot(
      snapshot("resources", { prompt: "CANARY_PROMPT", schema: "CANARY_SCHEMA" }),
    );

    expect(lsp?.payload).toEqual({ observedDocuments: 2 });
    expect(resources?.payload).toBeUndefined();
    expect(JSON.stringify([lsp, resources])).not.toContain("CANARY");
  });
});
