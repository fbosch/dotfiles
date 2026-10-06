import type { AuthOperationOptions } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const loginSignals = new WeakSet<AbortSignal>();

export function consumeCredentialLogin(options: AuthOperationOptions | undefined): boolean {
  const signal = options?.signal;
  if (signal === undefined || !loginSignals.has(signal)) return false;
  loginSignals.delete(signal);
  return true;
}

export function installCredentialLoginBoundary(runtime: Pick<ModelRuntime, "login">): () => void {
  const original = runtime.login;
  const wrapped: ModelRuntime["login"] = async (providerId, type, interaction, options) => {
    if (providerId !== "openai-codex" || type !== "oauth") {
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
