import { describe, expect, test } from "bun:test";
import { CLASSIFIER_PROVIDER_IDS } from "../../../lib/classifier";
import { resolveClassifierStartupStatus } from "../classifier-status";

const disabledSettings = {
  classifier: {
    toolDiscovery: { enabled: false },
    skillSelection: { enabled: false },
    recommendAgent: { enabled: false },
  },
};

describe("startup header Classifier status", () => {
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
    expect(calls).toEqual([...CLASSIFIER_PROVIDER_IDS]);
  });

  test("degrades an enabled feature when Gateway credentials are missing", () => {
    expect(
      resolveClassifierStartupStatus(
        disabledSettings,
        { classifier: { recommendAgent: { enabled: true } } },
        { getProviderAuthStatus: () => ({ configured: false }) },
      ),
    ).toBeUndefined();

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
