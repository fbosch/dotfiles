import { describe, expect, test } from "bun:test";
import {
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  createModels,
  type OAuthCredential,
} from "@earendil-works/pi-ai";
import { installCredentialLoginBoundary } from "../credential-login";
import { createProfileCredentialStore } from "../index";

const PROVIDER = "anthropic";

class MemoryCredentialStore implements CredentialStore {
  constructor(readonly credentials = new Map<string, Credential>()) {}

  async read(providerId: string) {
    return this.credentials.get(providerId);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.credentials].map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }));
  }

  async modify(
    providerId: string,
    update: (current: Credential | undefined) => Promise<Credential | undefined>,
  ) {
    const next = await update(this.credentials.get(providerId));
    if (next !== undefined) this.credentials.set(providerId, next);
    return this.credentials.get(providerId);
  }

  async delete(providerId: string) {
    this.credentials.delete(providerId);
  }
}

const oauth = (access: string, expires = Date.now() + 3_600_000): OAuthCredential => ({
  type: "oauth",
  access,
  refresh: `refresh-${access}`,
  expires,
});

const accessOf = (credential: Credential | undefined) =>
  credential?.type === "oauth" ? credential.access : undefined;

function fixture(selectedAccess?: string, sharedAccess?: string) {
  const selected = new MemoryCredentialStore(
    new Map(selectedAccess === undefined ? [] : [[PROVIDER, oauth(selectedAccess)]]),
  );
  const shared = new MemoryCredentialStore(
    new Map(sharedAccess === undefined ? [] : [[PROVIDER, oauth(sharedAccess)]]),
  );
  const store = createProfileCredentialStore(selected, shared, "openai-codex");
  const models = createModels({ credentials: store });
  models.setProvider({
    id: PROVIDER,
    name: "Synthetic Anthropic",
    getModels: () => [],
    auth: {
      oauth: {
        name: "Synthetic OAuth",
        login: async () => oauth("after-login"),
        refresh: async () => oauth("refreshed"),
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
  const runtime = { login: models.login.bind(models) };
  const dispose = installCredentialLoginBoundary(runtime);
  return { selected, shared, store, models, runtime, dispose };
}

const interaction = { prompt: async () => "unused", notify: () => {} };

describe("anthropic profile credentials", () => {
  test("a profile without its own credential uses the default one", async () => {
    const { store, models } = fixture(undefined, "shared");
    expect(accessOf(await store.read(PROVIDER))).toBe("shared");
    expect((await models.getAuth(PROVIDER))?.auth.apiKey).toBe("shared");
  });

  test("a profile credential overrides the default one", async () => {
    const { models } = fixture("profile", "shared");
    expect((await models.getAuth(PROVIDER))?.auth.apiKey).toBe("profile");
  });

  test("/login saves to the profile and leaves the default credential untouched", async () => {
    const { runtime, models, selected, shared, dispose } = fixture(undefined, "shared");
    try {
      await runtime.login(PROVIDER, "oauth", interaction);
      expect(accessOf(await selected.read(PROVIDER))).toBe("after-login");
      expect(accessOf(await shared.read(PROVIDER))).toBe("shared");
      expect((await models.getAuth(PROVIDER))?.auth.apiKey).toBe("after-login");
    } finally {
      dispose();
    }
  });

  test("refreshing a fallback credential writes back to the default file", async () => {
    const { selected, shared, models } = fixture();
    shared.credentials.set(PROVIDER, oauth("expired", 0));
    expect((await models.getAuth(PROVIDER))?.auth.apiKey).toBe("refreshed");
    expect(accessOf(await shared.read(PROVIDER))).toBe("refreshed");
    expect(await selected.read(PROVIDER)).toBeUndefined();
  });

  test("refreshing a profile credential stays in the profile", async () => {
    const { selected, shared, models } = fixture(undefined, "shared");
    selected.credentials.set(PROVIDER, oauth("expired", 0));
    expect((await models.getAuth(PROVIDER))?.auth.apiKey).toBe("refreshed");
    expect(accessOf(await selected.read(PROVIDER))).toBe("refreshed");
    expect(accessOf(await shared.read(PROVIDER))).toBe("shared");
  });

  test("logout removes the profile credential first, then the default one", async () => {
    const { store, selected, shared } = fixture("profile", "shared");
    await store.delete(PROVIDER);
    expect(await selected.read(PROVIDER)).toBeUndefined();
    expect(accessOf(await store.read(PROVIDER))).toBe("shared");
    await store.delete(PROVIDER);
    expect(await shared.read(PROVIDER)).toBeUndefined();
  });
});

describe("anthropic fallback along the profile order", () => {
  const withProvider = (access?: string) =>
    new MemoryCredentialStore(new Map(access === undefined ? [] : [[PROVIDER, oauth(access)]]));

  test("uses the first alternate profile in order before the default file", async () => {
    const kk = withProvider();
    const ct = withProvider("ct");
    const later = withProvider("later");
    const shared = withProvider("shared");
    const store = createProfileCredentialStore(kk, shared, "openai-codex", {
      fallbacks: [ct, later],
    });
    expect(accessOf(await store.read(PROVIDER))).toBe("ct");
    expect((await store.list()).filter(({ providerId }) => providerId === PROVIDER)).toHaveLength(
      1,
    );
  });

  test("refresh writes back to the alternate profile that owns the credential", async () => {
    const kk = withProvider();
    const ct = withProvider("ct");
    const shared = withProvider();
    const store = createProfileCredentialStore(kk, shared, "openai-codex", { fallbacks: [ct] });
    await store.modify(PROVIDER, async () => oauth("refreshed"));
    expect(accessOf(await ct.read(PROVIDER))).toBe("refreshed");
    expect(await kk.read(PROVIDER)).toBeUndefined();
    expect(await shared.read(PROVIDER)).toBeUndefined();
  });

  test("an unreadable alternate profile is skipped", async () => {
    const broken: CredentialStore = {
      read: async () => {
        throw new Error("Invalid auth.json");
      },
      list: async () => {
        throw new Error("Invalid auth.json");
      },
      modify: async () => undefined,
      delete: async () => {},
    };
    const store = createProfileCredentialStore(
      withProvider(),
      withProvider("shared"),
      "openai-codex",
      {
        fallbacks: [broken],
      },
    );
    expect(accessOf(await store.read(PROVIDER))).toBe("shared");
    expect((await store.list()).map(({ providerId }) => providerId)).toEqual([PROVIDER]);
  });

  test("the Codex credential never falls back to another profile", async () => {
    const codex = { type: "api_key", key: "ct-codex" } as const;
    const ct = new MemoryCredentialStore(new Map([["openai-codex", codex]]));
    const store = createProfileCredentialStore(withProvider(), withProvider(), "openai-codex", {
      fallbacks: [ct],
    });
    expect(await store.read("openai-codex")).toBeUndefined();
  });
});
