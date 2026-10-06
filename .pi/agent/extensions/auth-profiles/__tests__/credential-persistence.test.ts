import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CredentialStore, createModels, type OAuthCredential } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { installCredentialLoginBoundary } from "../credential-login";
import { createProfileCredentialStore } from "../index";
import { authPathFor } from "../profile-store";
import { guardOpenAiCodexCredential } from "../providers/openai-codex";

const providerId = "openai-codex";
async function readAccess(store: CredentialStore): Promise<string | undefined> {
  const credential = await store.read(providerId);
  return credential?.type === "oauth" ? credential.access : undefined;
}
const interaction = { prompt: async () => "unused", notify: () => {} };
const token = (access: string, expires = Date.now() + 3_600_000): OAuthCredential => ({
  type: "oauth",
  accountId: "synthetic-account",
  access,
  refresh: `synthetic-refresh-${access}`,
  expires,
});
const storageUrl = new URL(
  "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js",
  import.meta.url,
).href;

async function fixture(
  run: (stores: {
    selected: CredentialStore;
    observer: CredentialStore;
    shared: CredentialStore;
  }) => Promise<void>,
) {
  // Only temporary synthetic stores are opened, never the configured agent directory.
  const directory = mkdtempSync(join(tmpdir(), "pi-auth-persistence-"));
  try {
    const { AuthStorage } = (await import(storageUrl)) as {
      AuthStorage: { create(path: string): CredentialStore };
    };
    const path = authPathFor("kk", directory);
    const selected = AuthStorage.create(path);
    await selected.modify(providerId, async () => token("before-login"));
    const observer = AuthStorage.create(path);
    const shared = AuthStorage.create(authPathFor("default", directory));
    await shared.modify(providerId, async () => token("shared"));
    await run({ selected, observer, shared });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function provider(refresh: (credential: OAuthCredential) => Promise<OAuthCredential>) {
  return {
    id: providerId,
    name: "Synthetic Codex",
    getModels: () => [],
    auth: {
      oauth: {
        name: "Synthetic OAuth",
        login: async () => token("after-login"),
        refresh,
        toAuth: async (credential: OAuthCredential) => ({ apiKey: credential.access }),
      },
    },
    stream: () => {
      throw new Error("Network forbidden in this fixture");
    },
    streamSimple: () => {
      throw new Error("Network forbidden in this fixture");
    },
  };
}

async function runtimeFor(selected: CredentialStore, shared: CredentialStore) {
  const guarded = guardOpenAiCodexCredential(selected, "synthetic-account", true);
  const runtime = await ModelRuntime.create({
    credentials: createProfileCredentialStore(guarded, shared, providerId),
    modelsPath: null,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(
    provider(async () => {
      throw new Error("Fresh login must not refresh");
    }),
  );
  return { runtime, dispose: installCredentialLoginBoundary(runtime) };
}

test("same-account login replaces warmed file snapshots and runtime auth without touching default", async () => {
  await fixture(async ({ selected, observer, shared }) => {
    const { runtime, dispose } = await runtimeFor(selected, shared);
    try {
      expect((await runtime.getAuth(providerId))?.auth.apiKey).toBe("before-login");
      expect(await readAccess(observer)).toBe("before-login");
      await runtime.login(providerId, "oauth", interaction);
      expect((await runtime.getAuth(providerId))?.auth.apiKey).toBe("after-login");
      expect(await readAccess(observer)).toBe("after-login");
      expect(await readAccess(shared)).toBe("shared");
    } finally {
      dispose();
    }
  });
});

test("refresh already holding the file lock cannot persist after a completed login", async () => {
  await fixture(async ({ selected, observer, shared }) => {
    await selected.modify(providerId, async () => token("expired", 0));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const models = createModels({
      credentials: guardOpenAiCodexCredential(observer, "synthetic-account"),
    });
    models.setProvider(
      provider(async () => {
        entered();
        await gate;
        return token("refreshed-old-login");
      }),
    );
    const { runtime, dispose } = await runtimeFor(selected, shared);
    try {
      const refresh = models.getAuth(providerId);
      await started;
      const login = runtime.login(providerId, "oauth", interaction);
      release();
      await Promise.all([refresh, login]);
      expect(await readAccess(observer)).toBe("after-login");
      expect((await runtime.getAuth(providerId))?.auth.apiKey).toBe("after-login");
    } finally {
      release();
      dispose();
    }
  });
});

test("a refresh queued using a stale read rechecks the fresh login under the file lock", async () => {
  await fixture(async ({ selected, observer, shared }) => {
    await selected.modify(providerId, async () => token("expired", 0));
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayedStore: CredentialStore = {
      read: observer.read.bind(observer),
      list: observer.list.bind(observer),
      delete: observer.delete.bind(observer),
      async modify(id, update, options) {
        entered();
        await gate;
        return observer.modify(id, update, options);
      },
    };
    let refreshCalls = 0;
    const models = createModels({
      credentials: guardOpenAiCodexCredential(delayedStore, "synthetic-account"),
    });
    models.setProvider(
      provider(async () => {
        refreshCalls++;
        return token("stale-refresh");
      }),
    );
    const { runtime, dispose } = await runtimeFor(selected, shared);
    const pending = models.getAuth(providerId);
    try {
      await started;
      await runtime.login(providerId, "oauth", interaction);
      release();
      expect((await pending)?.auth.apiKey).toBe("after-login");
      expect(refreshCalls).toBe(0);
      expect(await readAccess(observer)).toBe("after-login");
    } finally {
      release();
      await pending;
      dispose();
    }
  });
});
