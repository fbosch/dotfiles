import { describe, expect, test } from "bun:test";
import { JEV_GATEWAY_PROVIDER_IDS } from "../../../lib/jev-gateway";
import { resolveJevStartupStatus } from "../jev-status";

const disabledSettings = {
  jev: {
    toolDiscovery: { enabled: false },
    skillSelection: { enabled: false },
    recommendAgent: { enabled: false },
  },
};

describe("startup header Jev status", () => {
  test("hides Jev when every feature is disabled", () => {
    let authChecks = 0;
    const status = resolveJevStartupStatus(disabledSettings, undefined, {
      getProviderAuthStatus: () => {
        authChecks += 1;
        return { configured: true };
      },
    });

    expect(status).toBeUndefined();
    expect(authChecks).toBe(0);
  });

  test("includes only global Jev compaction enablement", () => {
    expect(
      resolveJevStartupStatus(
        disabledSettings,
        { jev: { compaction: { enabled: true } } },
        { getProviderAuthStatus: () => ({ configured: true }) },
      ),
    ).toBeUndefined();

    expect(
      resolveJevStartupStatus({ jev: { compaction: { enabled: true } } }, undefined, {
        getProviderAuthStatus: () => ({ configured: true }),
      }),
    ).toEqual({ state: "ready" });
  });

  test("reports configured and enabled without resolving auth or making a request", () => {
    const calls: string[] = [];
    const status = resolveJevStartupStatus(
      { jev: { skillSelection: { enabled: true } } },
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
    expect(calls).toEqual([...JEV_GATEWAY_PROVIDER_IDS]);
  });

  test("degrades an enabled feature when Gateway credentials are missing", () => {
    expect(
      resolveJevStartupStatus(
        disabledSettings,
        { jev: { recommendAgent: { enabled: true } } },
        { getProviderAuthStatus: () => ({ configured: false }) },
      ),
    ).toBeUndefined();

    expect(
      resolveJevStartupStatus({ jev: { toolDiscovery: { enabled: true } } }, undefined, {
        getProviderAuthStatus: () => ({ configured: false }),
      }),
    ).toEqual({ state: "degraded" });
  });

  test("reports unknown when the public auth status API is unavailable", () => {
    expect(resolveJevStartupStatus({}, undefined, {})).toEqual({ state: "unavailable" });
  });
});
