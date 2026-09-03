import type {
  AuthOperationOptions,
  AuthResult,
  Credential,
  CredentialInfo,
  CredentialStore,
} from "@earendil-works/pi-ai";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { authPathFor, normalizeName } from "./profile-store";

const CODEX_PROVIDER = "openai-codex";
const REFRESH_TIMEOUT_MS = 20_000;
// shortcut: AuthStorage is not publicly exported, so use Pi's pinned implementation
// until coding-agent exposes a supported file-backed CredentialStore constructor.
const AUTH_STORAGE_MODULE_URL = new URL(
  "../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js",
  import.meta.url,
).href;

type AuthRuntime = {
  getAuth(
    providerId: string,
    options?: AuthOperationOptions & { minOAuthValidityMs?: number },
  ): Promise<AuthResult | undefined>;
};

type RefresherDependencies = {
  createCredentialStore?: (path: string) => Promise<CredentialStore>;
  createRuntime?: (credentials: CredentialStore) => Promise<AuthRuntime>;
  now?: () => number;
};

export type RefreshedProfileCredential = {
  access: string;
  accountId: string;
  expires: number;
};

export type ProfileCredentialRefreshRequest = {
  expectedAccountId: string;
  profileLabel: string;
};

export type ProfileCredentialRefresher = (
  request: ProfileCredentialRefreshRequest,
) => Promise<RefreshedProfileCredential>;

export type ProfileCredentialReader = (profileLabel: string) => Promise<Credential | undefined>;

export type ProfileCredentialStoreFactory = (profileLabel: string) => Promise<CredentialStore>;

type AuthStorageModule = {
  AuthStorage: { create(path?: string): CredentialStore };
};

function accountIdFor(credential: Credential | undefined): string | undefined {
  if (credential?.type !== "oauth") return undefined;
  return typeof credential.accountId === "string" ? credential.accountId : undefined;
}

function assertExpectedAccount(
  credential: Credential | undefined,
  expectedAccountId: string,
): asserts credential is Credential & { type: "oauth"; accountId: string } {
  if (accountIdFor(credential) !== expectedAccountId) {
    throw new Error("OpenAI Codex credential changed accounts during refresh.");
  }
}

function refreshedCredential(
  credential: Credential | undefined,
  expectedAccountId: string,
): RefreshedProfileCredential {
  assertExpectedAccount(credential, expectedAccountId);
  if (credential.access.length === 0 || !Number.isFinite(credential.expires)) {
    throw new Error("OpenAI Codex refresh returned an invalid credential.");
  }
  return {
    access: credential.access,
    accountId: expectedAccountId,
    expires: credential.expires,
  };
}

export function guardCredentialAccount(
  store: CredentialStore,
  expectedAccountId: string,
): CredentialStore {
  return {
    async read(providerId, options) {
      const credential = await store.read(providerId, options);
      if (providerId === CODEX_PROVIDER) assertExpectedAccount(credential, expectedAccountId);
      return credential;
    },
    list(options): Promise<readonly CredentialInfo[]> {
      return store.list(options);
    },
    modify(providerId, modify, options) {
      if (providerId !== CODEX_PROVIDER) return store.modify(providerId, modify, options);
      return store.modify(
        providerId,
        async (current) => {
          assertExpectedAccount(current, expectedAccountId);
          const next = await modify(current);
          if (next !== undefined) assertExpectedAccount(next, expectedAccountId);
          return next;
        },
        options,
      );
    },
    delete(providerId, options): Promise<void> {
      return store.delete(providerId, options);
    },
  };
}

async function createCredentialStore(path: string): Promise<CredentialStore> {
  const module = (await import(AUTH_STORAGE_MODULE_URL)) as AuthStorageModule;
  return module.AuthStorage.create(path);
}

async function createRuntime(credentials: CredentialStore): Promise<AuthRuntime> {
  return ModelRuntime.create({
    credentials,
    modelsPath: null,
    refreshOnCreate: false,
  });
}

export function createProfileCredentialReader(
  agentDir = getAgentDir(),
  loadStore: (path: string) => Promise<CredentialStore> = createCredentialStore,
): ProfileCredentialReader {
  return async (profileLabel) => {
    const profile = normalizeName(profileLabel);
    const store = await loadStore(authPathFor(profile, agentDir));
    return store.read(CODEX_PROVIDER);
  };
}

export function createProfileCredentialStoreFactory(
  agentDir = getAgentDir(),
  loadStore: (path: string) => Promise<CredentialStore> = createCredentialStore,
): ProfileCredentialStoreFactory {
  return async (profileLabel) => {
    const profile = normalizeName(profileLabel);
    const store = await loadStore(authPathFor(profile, agentDir));
    const credential = await store.read(CODEX_PROVIDER);
    if (credential?.type !== "oauth") return store;

    const accountId = accountIdFor(credential);
    if (accountId === undefined) {
      throw new Error(`Profile ${profile} has an invalid OpenAI Codex account identity.`);
    }
    return guardCredentialAccount(store, accountId);
  };
}

export function createProfileCredentialRefresher(
  agentDir = getAgentDir(),
  dependencies: RefresherDependencies = {},
): ProfileCredentialRefresher {
  const loadStore = dependencies.createCredentialStore ?? createCredentialStore;
  const loadRuntime = dependencies.createRuntime ?? createRuntime;
  const now = dependencies.now ?? Date.now;

  return async ({ expectedAccountId, profileLabel }) => {
    const profile = normalizeName(profileLabel);
    const store = guardCredentialAccount(
      await loadStore(authPathFor(profile, agentDir)),
      expectedAccountId,
    );
    const runtime = await loadRuntime(store);
    const auth = await runtime.getAuth(CODEX_PROVIDER, {
      minOAuthValidityMs: 1,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    if (auth === undefined) {
      throw new Error(`Profile ${profile} has no usable OpenAI Codex OAuth credential.`);
    }

    const refreshed = refreshedCredential(await store.read(CODEX_PROVIDER), expectedAccountId);
    if (refreshed.expires <= now()) {
      throw new Error(`Profile ${profile} OpenAI Codex credential remained expired after refresh.`);
    }
    return refreshed;
  };
}
