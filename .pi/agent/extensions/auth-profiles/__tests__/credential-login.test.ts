import { describe, expect, test } from "bun:test";
import {
  type Credential,
  type CredentialStore,
  createModels,
  type MutableModels,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { installCredentialLoginBoundary } from "../credential-login";
import { createProfileCredentialStore } from "../index";
import { createOpenAiCodexProfileAdapter } from "../providers/openai-codex";

const credential = (accountId: string): OAuthCredential => ({
  type: "oauth",
  access: "synthetic-access",
  refresh: "synthetic-refresh",
  expires: Date.now() + 3_600_000,
  accountId,
});

class MemoryStore implements CredentialStore {
  constructor(public value: Credential | undefined) {}
  async read() {
    return this.value;
  }
  async list() {
    return [];
  }
  async modify(
    _provider: string,
    update: (value: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    const next = await update(this.value);
    if (next !== undefined) this.value = next;
    return this.value;
  }
  async delete() {
    this.value = undefined;
  }
}

function registerProvider(models: MutableModels, login: () => Promise<OAuthCredential>) {
  models.setProvider({
    id: "openai-codex",
    name: "Synthetic Codex",
    getModels: () => [],
    auth: {
      oauth: {
        name: "Synthetic OAuth",
        login,
        refresh: async () => credential("unexpected-account"),
        toAuth: async (value) => ({ apiKey: value.access }),
      },
    },
    stream: () => {
      throw new Error("No network in this fixture");
    },
    streamSimple: () => {
      throw new Error("No network in this fixture");
    },
  });
}

async function fixture(login = async () => credential("new-account")) {
  const selected = new MemoryStore(credential("old-account"));
  const shared = new MemoryStore(credential("shared-account"));
  const adapter = createOpenAiCodexProfileAdapter("/synthetic-agent", {
    createCredentialStore: async () => selected,
  });
  const guarded = await adapter.createCredentialStore("kk");
  const store = createProfileCredentialStore(guarded, shared, "openai-codex");
  const models = createModels({ credentials: store });
  registerProvider(models, login);
  const runtime = { login: models.login.bind(models) };
  const dispose = installCredentialLoginBoundary(runtime);
  return { selected, shared, guarded, store, models, runtime, dispose };
}

const interaction = { prompt: async () => "unused", notify: () => {} };

describe("profile credential login boundary", () => {
  test("explicit Pi login replaces the selected account without logout and re-pins refresh", async () => {
    const { runtime, models, selected, shared } = await fixture();
    await runtime.login("openai-codex", "oauth", interaction);
    expect(selected.value).toMatchObject({ accountId: "new-account" });
    expect(shared.value).toMatchObject({ accountId: "shared-account" });
    selected.value = { ...credential("new-account"), expires: 0 };
    await expect(models.getAuth("openai-codex")).rejects.toThrow(
      "credential changed accounts during refresh",
    );
    expect(selected.value.accountId).toBe("new-account");
  });
});

test("concurrent refresh during a pending login remains account-pinned", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { runtime, models, selected } = await fixture(async () => {
    started();
    await gate;
    return credential("new-account");
  });
  selected.value = { ...credential("old-account"), expires: 0 };
  const login = runtime.login("openai-codex", "oauth", interaction);
  await entered;
  await expect(models.getAuth("openai-codex")).rejects.toThrow("credential changed accounts");
  expect(selected.value).toMatchObject({ accountId: "old-account" });
  release();
  await login;
  expect(selected.value).toMatchObject({ accountId: "new-account" });
});

test("failed and cancelled login preserve the old credential and close the boundary", async () => {
  const { runtime, models, selected } = await fixture(async () => {
    throw new Error("synthetic login failure");
  });
  const original = selected.value;
  await expect(runtime.login("openai-codex", "oauth", interaction)).rejects.toThrow(
    "synthetic login failure",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    runtime.login("openai-codex", "oauth", { ...interaction, signal: controller.signal }),
  ).rejects.toThrow();
  expect(selected.value).toEqual(original);
  selected.value = { ...credential("old-account"), expires: 0 };
  await expect(models.getAuth("openai-codex")).rejects.toThrow("credential changed accounts");
});

test("post-login synchronization cannot reuse the account replacement permission", async () => {
  const { models, store, selected } = await fixture();
  const runtime = {
    login: async (...args: Parameters<typeof models.login>) => {
      const result = await models.login(...args);
      await expect(
        store.modify(args[0], async () => credential("unexpected-account"), {
          ...(args[2].signal === undefined ? {} : { signal: args[2].signal }),
        }),
      ).rejects.toThrow("credential changed accounts");
      return result;
    },
  };
  const original = runtime.login;
  const dispose = installCredentialLoginBoundary(runtime);
  await runtime.login("openai-codex", "oauth", interaction);
  expect(selected.value).toMatchObject({ accountId: "new-account" });
  dispose();
  expect(runtime.login).toBe(original);
});

test("installed ModelRuntime login and synchronization use the explicit boundary", async () => {
  const { store, models, selected, shared } = await fixture();
  const runtime = await ModelRuntime.create({
    credentials: store,
    modelsPath: null,
    refreshOnCreate: false,
  });
  const provider = models.getProvider("openai-codex");
  if (provider === undefined) throw new Error("Missing synthetic provider");
  runtime.registerNativeProvider(provider);
  const dispose = installCredentialLoginBoundary(runtime);
  try {
    await runtime.login("openai-codex", "oauth", interaction);
    expect(selected.value).toMatchObject({ accountId: "new-account" });
    expect(shared.value).toMatchObject({ accountId: "shared-account" });
    selected.value = { ...credential("new-account"), expires: 0 };
    await expect(runtime.getAuth("openai-codex")).rejects.toThrow("credential changed accounts");
  } finally {
    dispose();
  }
});
