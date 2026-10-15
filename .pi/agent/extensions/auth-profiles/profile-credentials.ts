import type { AuthOperationOptions, CredentialStore } from "@earendil-works/pi-ai";
import { consumeCredentialLogin, PROFILE_FALLBACK_PROVIDERS } from "./credential-login";
import { DEFAULT_PROFILE } from "./profile-store";
import type { ProfileProviderAdapter } from "./provider-adapter";

/**
 * Live routing state for fallback providers, keyed by the profile label that owns a
 * credential. Implementations read the current time so expired entries stop applying
 * without rebinding the store.
 */
export type FallbackOwnerRoute = {
  /** Owner to use ahead of the profile order while the pin is valid. */
  pinned(providerId: string): string | undefined;
  /** Whether the owner's credential is skipped until its usage resets. */
  isExhausted(providerId: string, owner: string): boolean;
};

/** Store-level form of {@link FallbackOwnerRoute}, used by the composed store. */
export type FallbackStoreRoute = {
  pinned(providerId: string): CredentialStore | undefined;
  isExhausted(providerId: string, store: CredentialStore): boolean;
};

export type ProfileAuthFallbackCallbacks = {
  onInvalidOAuthRefresh?: (providerId: string, owner: string) => void;
  onOAuthFallback?: (providerId: string, from: string, to: string) => void;
};

export type ProfileCredentialStoreOptions = {
  /** Other profiles' stores, in effective profile order, consulted before `shared`. */
  fallbacks?: readonly CredentialStore[];
  fallbackProviderIds?: ReadonlySet<string>;
  route?: FallbackStoreRoute;
  /**
   * Resolve the adapter provider through `route` along the profile chain instead of
   * isolating it to the selected profile. /login still saves to the selected profile.
   */
  routeProfileProvider?: boolean;
  onInvalidOAuthRefresh?: (providerId: string, store: CredentialStore) => void;
  onOAuthFallback?: (providerId: string, from: CredentialStore, to: CredentialStore) => void;
};

/** Only a rejected Anthropic refresh token is grounds to try another account. */
function isAnthropicInvalidGrant(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (/\binvalid_grant\b/.test(current.message)) return true;
    current = current.cause;
  }
  return false;
}

/**
 * Owner lookup order shared by the live store and status observations: a valid pin
 * first, then owners that are not exhausted, then exhausted owners, so an
 * all-exhausted chain still sends requests instead of failing authentication.
 */
function ownerPreference<T>(
  chain: readonly T[],
  pinned: T | undefined,
  isExhausted: (owner: T) => boolean,
): T[] {
  const pin =
    pinned !== undefined && chain.includes(pinned) && !isExhausted(pinned) ? [pinned] : [];
  return [
    ...new Set([
      ...pin,
      ...chain.filter((owner) => !isExhausted(owner)),
      ...chain.filter((owner) => isExhausted(owner)),
    ]),
  ];
}

/**
 * Compose the active profile's store with the default auth.json.
 *
 * - The adapter provider is isolated to the selected profile unless
 *   `routeProfileProvider` routes it like a fallback provider.
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
  const route = options.route;
  const onInvalidOAuthRefresh = options.onInvalidOAuthRefresh;
  const onOAuthFallback = options.onOAuthFallback;
  const routesProfileProvider = options.routeProfileProvider === true && route !== undefined;
  const isFallbackProvider = (providerId: string) =>
    providerId === profileProviderId ? routesProfileProvider : fallbackProviderIds.has(providerId);
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
    excluded?: ReadonlySet<CredentialStore>,
  ): Promise<{
    store: CredentialStore;
    credential: Awaited<ReturnType<CredentialStore["read"]>>;
  }> => {
    // Refresh and logout follow the same route as reads, so a rotated request never
    // refreshes or deletes the exhausted owner's credential instead of the one in use.
    const order =
      route === undefined
        ? chain
        : ownerPreference(chain, route.pinned(providerId), (store) =>
            route.isExhausted(providerId, store),
          );
    for (const store of order) {
      if (excluded?.has(store)) continue;
      const credential = await readFallback(store, providerId, options);
      if (excluded?.size && credential?.type === "api_key") {
        // shortcut: an OAuth refresh callback cannot resolve an API key; move this
        // fallback above the store if mixed Anthropic auth types are configured.
        continue;
      }
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
      if (consumeCredentialLogin(options)) return selected.modify(providerId, fn, options);
      if (providerId !== "anthropic") {
        return (await owner(providerId, options)).store.modify(providerId, fn, options);
      }

      const rejected = new Set<CredentialStore>();
      let firstError: unknown;
      let firstOwner: CredentialStore | undefined;
      while (true) {
        const { store, credential } = await owner(providerId, options, rejected);
        if (credential === undefined) {
          if (firstError !== undefined) throw firstError;
          return store.modify(providerId, fn, options);
        }
        try {
          const result = await store.modify(providerId, fn, options);
          if (firstOwner !== undefined) {
            for (const rejectedStore of rejected)
              onInvalidOAuthRefresh?.(providerId, rejectedStore);
            onOAuthFallback?.(providerId, firstOwner, store);
          }
          return result;
        } catch (error) {
          if (!isAnthropicInvalidGrant(error)) throw error;
          firstError ??= error;
          firstOwner ??= store;
          rejected.add(store);
        }
      }
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

/** Profiles that can own a fallback-provider credential for `profile`, in lookup order. */
export function fallbackOwnerChain(profile: string, profileOrder: readonly string[]): string[] {
  return [...new Set([profile, ...alternateProfiles(profile, profileOrder), DEFAULT_PROFILE])];
}

/**
 * The profile whose credential a fallback provider resolves to, matching the live store's
 * lookup order, or undefined when no profile in the chain holds one.
 */
export function fallbackCredentialOwner(
  profile: string,
  profileOrder: readonly string[],
  hasCredential: (profile: string) => boolean,
  routing?: { providerId: string; route: FallbackOwnerRoute },
): string | undefined {
  const chain = fallbackOwnerChain(profile, profileOrder);
  const order =
    routing === undefined
      ? chain
      : ownerPreference(chain, routing.route.pinned(routing.providerId), (owner) =>
          routing.route.isExhausted(routing.providerId, owner),
        );
  return order.find(hasCredential);
}

/** Open the live credential store for `profile`, falling back along `profileOrder`. */
export async function openProfileCredentials(
  adapter: ProfileProviderAdapter,
  profile: string,
  profileOrder: readonly string[],
  route?: FallbackOwnerRoute,
  callbacks: ProfileAuthFallbackCallbacks = {},
): Promise<CredentialStore> {
  const selected = await adapter.createCredentialStore(profile);
  const alternates = alternateProfiles(profile, profileOrder);
  // A profile whose adapter credential is invalid drops out of the routing chain
  // instead of blocking the selected profile from binding.
  const opened = await Promise.all(
    alternates.map(async (candidate) => {
      try {
        return { label: candidate, store: await adapter.createCredentialStore(candidate) };
      } catch {
        return undefined;
      }
    }),
  );
  const alternateStores = opened.filter((entry) => entry !== undefined);
  if (profile === DEFAULT_PROFILE && alternateStores.length === 0) return selected;
  const shared =
    profile === DEFAULT_PROFILE ? selected : await adapter.createCredentialStore(DEFAULT_PROFILE);
  const labelled = [
    { label: profile, store: selected },
    ...alternateStores,
    { label: DEFAULT_PROFILE, store: shared },
  ];
  const storeFor = new Map(labelled.map(({ label, store }) => [label, store]));
  const labelFor = new Map(labelled.map(({ label, store }) => [store, label]));
  return createProfileCredentialStore(selected, shared, adapter.providerId, {
    fallbacks: alternateStores.map(({ store }) => store),
    onInvalidOAuthRefresh: (providerId, store) => {
      const owner = labelFor.get(store);
      if (owner !== undefined) callbacks.onInvalidOAuthRefresh?.(providerId, owner);
    },
    onOAuthFallback: (providerId, from, to) => {
      const fromOwner = labelFor.get(from);
      const toOwner = labelFor.get(to);
      if (fromOwner !== undefined && toOwner !== undefined) {
        callbacks.onOAuthFallback?.(providerId, fromOwner, toOwner);
      }
    },
    ...(route === undefined
      ? {}
      : {
          routeProfileProvider: true,
          route: {
            pinned: (providerId) => {
              const owner = route.pinned(providerId);
              return owner === undefined ? undefined : storeFor.get(owner);
            },
            isExhausted: (providerId, store) => {
              const owner = labelFor.get(store);
              return owner !== undefined && route.isExhausted(providerId, owner);
            },
          },
        }),
  });
}
