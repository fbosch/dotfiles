import type { AuthOperationOptions } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Providers saved per profile that fall back to the default auth.json when the
 * profile has no credential of its own. The adapter provider stays isolated.
 */
export const PROFILE_FALLBACK_PROVIDERS: ReadonlySet<string> = new Set(["anthropic"]);

/** OAuth providers whose explicit /login must be saved to the active profile. */
export const PROFILE_LOGIN_PROVIDERS: ReadonlySet<string> = new Set([
  "openai-codex",
  ...PROFILE_FALLBACK_PROVIDERS,
]);

const loginSignals = new WeakSet<AbortSignal>();

export function consumeCredentialLogin(options: AuthOperationOptions | undefined): boolean {
  const signal = options?.signal;
  if (signal === undefined || !loginSignals.has(signal)) return false;
  loginSignals.delete(signal);
  return true;
}

export function installCredentialLoginBoundary(
  runtime: Pick<ModelRuntime, "login">,
  providers: ReadonlySet<string> = PROFILE_LOGIN_PROVIDERS,
): () => void {
  const original = runtime.login;
  const wrapped: ModelRuntime["login"] = async (providerId, type, interaction, options) => {
    if (!providers.has(providerId) || type !== "oauth") {
      return original.call(runtime, providerId, type, interaction, options);
    }
    // Pi forwards this exact signal to the login write. A one-use capability
    // cannot leak into concurrent refresh or post-login state synchronization.
    const signal =
      interaction.signal === undefined
        ? new AbortController().signal
        : AbortSignal.any([interaction.signal]);
    loginSignals.add(signal);
    try {
      return await original.call(runtime, providerId, type, { ...interaction, signal }, options);
    } finally {
      loginSignals.delete(signal);
    }
  };
  runtime.login = wrapped;
  return () => {
    if (runtime.login === wrapped) runtime.login = original;
  };
}
