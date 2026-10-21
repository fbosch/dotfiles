import { describe, expect, test } from "bun:test";
import { resolveClassifierStartupStatus } from "../classifier-status";

const disabledSettings = {
  classifier: {
    toolDiscovery: { enabled: false },
    skillSelection: { enabled: false },
  },
};

describe("startup header Classifier status", () => {
  test("master disable hides Classifier before auth inspection", () => {
    const registry = {
      getProviderAuthStatus: () => {
        throw new Error("must not inspect auth");
      },
    };
    expect(
      resolveClassifierStartupStatus(
        { classifier: { enabled: false } },
        { classifier: { enabled: true } },
        registry,
      ),
    ).toBeUndefined();
    expect(
      resolveClassifierStartupStatus({}, { classifier: { enabled: false } }, registry),
    ).toBeUndefined();
    expect(
      resolveClassifierStartupStatus({ classifier: { enabled: "no" } }, undefined, registry),
    ).toEqual({ state: "unavailable" });
  });

  test("hides Classifier when every feature is disabled", () => {
    let authChecks = 0;
    const status = resolveClassifierStartupStatus(disabledSettings, undefined, {
      getProviderAuthStatus: () => {
        authChecks += 1;
        return { configured: true };
      },
    });

    expect(status).toBeUndefined();
    expect(authChecks).toBe(0);
  });

  test("reports configured and enabled without resolving auth or making a request", () => {
    const calls: string[] = [];
    const status = resolveClassifierStartupStatus(
      { classifier: { skillSelection: { enabled: true } } },
      undefined,
      {
        getProviderAuthStatus: (providerId: string) => {
          calls.push(providerId);
          return { configured: true };
        },
        getProviderAuth: () => {
          throw new Error("auth resolution must not run");
        },
      },
    );

    expect(status).toEqual({ state: "ready" });
    expect(calls).toEqual(["openrouter", "vercel-ai-gateway"]);
  });

  test("checks configured text-route providers rather than image-route credentials", () => {
    const calls: string[] = [];
    const status = resolveClassifierStartupStatus(
      {
        classifier: {
          providers: [{ provider: "custom-text", model: "classifier-v2" }],
          imageProviders: [{ provider: "openai", model: "gpt-6-luna" }],
        },
      },
      undefined,
      {
        getProviderAuthStatus(providerId: string) {
          calls.push(providerId);
          return { configured: providerId === "custom-text" };
        },
      },
    );
    expect(status).toEqual({ state: "ready" });
    expect(calls).toEqual(["custom-text"]);
  });

  test("degrades an enabled feature when Gateway credentials are missing", () => {
    expect(
      resolveClassifierStartupStatus(
        { classifier: { toolDiscovery: { enabled: true } } },
        undefined,
        {
          getProviderAuthStatus: () => ({ configured: false }),
        },
      ),
    ).toEqual({ state: "degraded" });
  });

  test("reports unknown when the public auth status API is unavailable", () => {
    expect(resolveClassifierStartupStatus({}, undefined, {})).toEqual({ state: "unavailable" });
  });
});
