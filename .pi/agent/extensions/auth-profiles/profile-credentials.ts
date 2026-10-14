import type { AuthOperationOptions, CredentialStore } from "@earendil-works/pi-ai";
import { consumeCredentialLogin, PROFILE_FALLBACK_PROVIDERS } from "./credential-login";
import { DEFAULT_PROFILE } from "./profile-store";
import type { ProfileProviderAdapter } from "./provider-adapter";

export type ProfileCredentialStoreOptions = {
  /** Other profiles' stores, in effective profile order, consulted before `shared`. */
  fallbacks?: readonly CredentialStore[];
  fallbackProviderIds?: ReadonlySet<string>;
};

/**
 * Compose the active profile's store with the default auth.json.
 *
 * - The adapter provider is isolated to the selected profile.
 * - Fallback providers (Anthropic) resolve from the selected profile, then the
 *   other profiles in effective order, then the default file. /login saves to the
 *   selected profile; refresh and logout go to the file that holds the credential.
 * - Every other provider reads the selected profile first and writes to auth.json.
 */
export function createProfileCredentialStore(
  selected: CredentialStore,
  shared: CredentialStore,
  profileProviderId: string,
  options: ProfileCredentialStoreOptions = {},
): CredentialStore & { readonly path?: string } {
  const fallbackProviderIds = options.fallbackProviderIds ?? PROFILE_FALLBACK_PROVIDERS;
  const fallbacks = options.fallbacks ?? [];
  const isFallbackProvider = (providerId: string) =>
    providerId !== profileProviderId && fallbackProviderIds.has(providerId);
  const target = (providerId: string) => (providerId === profileProviderId ? selected : shared);

  // An unreadable alternate profile must not hide credentials from the rest of the chain.
  const readFallback = async (
    store: CredentialStore,
    providerId: string,
    options: AuthOperationOptions | undefined,
  ) => {
    try {
      return await store.read(providerId, options);
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (store === selected || store === shared) throw error;
      return undefined;
    }
  };

  const chain = [selected, ...fallbacks, shared];
  const owner = async (
    providerId: string,
    options: AuthOperationOptions | undefined,
  ): Promise<{
    store: CredentialStore;
    credential: Awaited<ReturnType<CredentialStore["read"]>>;
  }> => {
    for (const store of chain) {
      const credential = await readFallback(store, providerId, options);
      if (credential !== undefined) return { store, credential };
    }
    return { store: shared, credential: undefined };
  };

  const selectedPath =
    "path" in selected && typeof selected.path === "string" ? selected.path : undefined;

  return {
    // Preserve file-backed store diagnostics used by profile status and tests.
    ...(selectedPath === undefined ? {} : { path: selectedPath }),
    async read(providerId, options) {
      if (isFallbackProvider(providerId)) return (await owner(providerId, options)).credential;
      return (
        (await selected.read(providerId, options)) ??
        (providerId === profileProviderId ? undefined : await shared.read(providerId, options))
      );
    },
    async list(options) {
      const [selectedEntries, fallbackEntries, sharedEntries] = await Promise.all([
        selected.list(options),
        Promise.all(fallbacks.map((store) => store.list(options).catch(() => []))),
        shared.list(options),
      ]);
      const merged = new Map(sharedEntries.map((entry) => [entry.providerId, entry]));
      for (const entries of [...fallbackEntries].reverse()) {
        for (const entry of entries) {
          if (isFallbackProvider(entry.providerId)) merged.set(entry.providerId, entry);
        }
      }
      for (const entry of selectedEntries) merged.set(entry.providerId, entry);
      return [...merged.values()];
    },
    async modify(providerId, fn, options) {
      if (!isFallbackProvider(providerId)) {
        return target(providerId).modify(providerId, fn, options);
      }
      const store = consumeCredentialLogin(options)
        ? selected
        : (await owner(providerId, options)).store;
      return store.modify(providerId, fn, options);
    },
    async delete(providerId, options) {
      if (!isFallbackProvider(providerId)) {
        return target(providerId).delete(providerId, options);
      }
      return (await owner(providerId, options)).store.delete(providerId, options);
    },
  };
}

/** Profiles consulted after `profile` for fallback providers, before the default file. */
function alternateProfiles(profile: string, profileOrder: readonly string[]): string[] {
  return [...new Set(profileOrder)].filter(
    (candidate) => candidate !== profile && candidate !== DEFAULT_PROFILE,
  );
}

/**
 * The profile whose credential a fallback provider resolves to, matching the live store's
 * lookup order, or undefined when no profile in the chain holds one.
 */
export function fallbackCredentialOwner(
  profile: string,
  profileOrder: readonly string[],
  hasCredential: (profile: string) => boolean,
): string | undefined {
  return [profile, ...alternateProfiles(profile, profileOrder), DEFAULT_PROFILE].find(
    hasCredential,
  );
}

/** Open the live credential store for `profile`, falling back along `profileOrder`. */
export async function openProfileCredentials(
  adapter: ProfileProviderAdapter,
  profile: string,
  profileOrder: readonly string[],
): Promise<CredentialStore> {
  const selected = await adapter.createCredentialStore(profile);
  const alternates = alternateProfiles(profile, profileOrder);
  // Alternates only serve fallback providers, so a profile whose adapter
  // credential is invalid must not block binding the selected profile.
  const opened = await Promise.all(
    alternates.map((candidate) => adapter.createCredentialStore(candidate).catch(() => undefined)),
  );
  const fallbacks = opened.filter((store): store is CredentialStore => store !== undefined);
  if (profile === DEFAULT_PROFILE && fallbacks.length === 0) return selected;
  const shared =
    profile === DEFAULT_PROFILE ? selected : await adapter.createCredentialStore(DEFAULT_PROFILE);
  return createProfileCredentialStore(selected, shared, adapter.providerId, { fallbacks });
}
