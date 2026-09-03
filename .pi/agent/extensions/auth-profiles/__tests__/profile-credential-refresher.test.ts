import { describe, expect, test } from "bun:test";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { createOpenAiCodexProfileAdapter } from "../providers/openai-codex";

class FakeCredentialStore implements CredentialStore {
  constructor(public credential: Credential | undefined) {}

  async read(
    _providerId: string,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.credential === undefined ? undefined : structuredClone(this.credential);
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return this.credential === undefined ? [] : [{ providerId: "openai-codex", type: "oauth" }];
  }

  async modify(
    _providerId: string,
    modify: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const next = await modify(
      this.credential === undefined ? undefined : structuredClone(this.credential),
    );
    if (next !== undefined) this.credential = structuredClone(next);
    return this.credential === undefined ? undefined : structuredClone(this.credential);
  }

  async delete(_providerId: string, _options?: AuthOperationOptions): Promise<void> {
    this.credential = undefined;
  }
}

function expiredCredential(accountId = "account-work"): Credential {
  return {
    type: "oauth",
    access: "expired-access-token",
    refresh: "refresh-token",
    expires: 1_000,
    accountId,
  };
}

describe("OpenAI Codex profile adapter refresh", () => {
  test("uses Pi auth resolution and persists a refreshed credential", async () => {
    const store = new FakeCredentialStore(expiredCredential());
    const adapter = createOpenAiCodexProfileAdapter("/agent", {
      createCredentialStore: async (path) => {
        expect(path).toBe("/agent/auth-profiles/work.json");
        return store;
      },
      createRuntime: async (credentials) => ({
        async getAuth(providerId) {
          expect(providerId).toBe("openai-codex");
          await credentials.modify(providerId, async () => ({
            type: "oauth",
            access: "refreshed-access-token",
            refresh: "rotated-refresh-token",
            expires: 20_000,
            accountId: "account-work",
          }));
          return { auth: { apiKey: "refreshed-access-token" } };
        },
      }),
      now: () => 10_000,
    });

    const refreshed = await adapter.refreshCredential({
      expectedIdentity: "account-work",
      profileLabel: "work",
    });
    expect(refreshed).toEqual({
      accessToken: "refreshed-access-token",
      identity: "account-work",
      expiresAt: 20_000,
    });
    expect(store.credential).toEqual({
      type: "oauth",
      access: "refreshed-access-token",
      refresh: "rotated-refresh-token",
      expires: 20_000,
      accountId: "account-work",
    });
  });

  test("rejects an account change before it can be persisted", async () => {
    const original = expiredCredential();
    const store = new FakeCredentialStore(original);
    const adapter = createOpenAiCodexProfileAdapter("/agent", {
      createCredentialStore: async () => store,
      createRuntime: async (credentials) => ({
        async getAuth(providerId) {
          await credentials.modify(providerId, async () => ({
            type: "oauth",
            access: "different-account-token",
            refresh: "different-account-refresh-token",
            expires: 20_000,
            accountId: "account-other",
          }));
          return { auth: { apiKey: "different-account-token" } };
        },
      }),
      now: () => 10_000,
    });

    const refresh = adapter.refreshCredential({
      expectedIdentity: "account-work",
      profileLabel: "work",
    });
    expect(refresh).rejects.toThrow("credential changed accounts");
    await refresh.catch(() => undefined);
    expect(store.credential).toEqual(original);
  });

  test("preserves the expired credential when refresh fails", async () => {
    const original = expiredCredential();
    const store = new FakeCredentialStore(original);
    const adapter = createOpenAiCodexProfileAdapter("/agent", {
      createCredentialStore: async () => store,
      createRuntime: async () => ({
        async getAuth() {
          throw new Error("token endpoint unavailable");
        },
      }),
      now: () => 10_000,
    });

    const refresh = adapter.refreshCredential({
      expectedIdentity: "account-work",
      profileLabel: "work",
    });
    expect(refresh).rejects.toThrow("token endpoint unavailable");
    await refresh.catch(() => undefined);
    expect(store.credential).toEqual(original);
  });
});
