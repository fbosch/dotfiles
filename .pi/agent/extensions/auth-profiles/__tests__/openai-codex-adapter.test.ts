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

describe("OpenAI Codex profile adapter credentials", () => {
  test("allows logout followed by login while guarding the new account", async () => {
    const store = new FakeCredentialStore(expiredCredential());
    const adapter = createOpenAiCodexProfileAdapter("/agent", {
      createCredentialStore: async () => store,
    });
    const boundStore = await adapter.createCredentialStore("work");

    await boundStore.delete("openai-codex");
    await boundStore.modify("openai-codex", async (current) => {
      expect(current).toBeUndefined();
      return {
        type: "oauth",
        access: "new-account-token",
        refresh: "new-account-refresh",
        expires: 20_000,
        accountId: "account-new",
      };
    });

    const accountChange = boundStore.modify("openai-codex", async () => ({
      type: "oauth",
      access: "other-account-token",
      refresh: "other-account-refresh",
      expires: 20_000,
      accountId: "account-other",
    }));
    expect(accountChange).rejects.toThrow("credential changed accounts");
    await accountChange.catch(() => undefined);
  });

  test("orders logout after an in-flight credential update", async () => {
    const store = new FakeCredentialStore(expiredCredential());
    const adapter = createOpenAiCodexProfileAdapter("/agent", {
      createCredentialStore: async () => store,
    });
    const boundStore = await adapter.createCredentialStore("work");
    let markStarted: (() => void) | undefined;
    let releaseUpdate: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });

    const update = boundStore.modify("openai-codex", async () => {
      markStarted?.();
      await updateGate;
      return {
        type: "oauth",
        access: "updated-token",
        refresh: "updated-refresh",
        expires: 20_000,
        accountId: "account-work",
      };
    });
    await started;
    const logout = boundStore.delete("openai-codex");
    releaseUpdate?.();
    await Promise.all([update, logout]);

    expect(store.credential).toBeUndefined();
  });

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
          return { auth: { apiKey: "runtime-only-token" } };
        },
      }),
      now: () => 10_000,
    });

    const refreshed = await adapter.resolveCredential("work");
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
