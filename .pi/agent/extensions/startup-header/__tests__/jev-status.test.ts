import { describe, expect, test } from "bun:test";
import { resolveJevStartupStatus, VERCEL_GATEWAY_PROVIDER_ID } from "../jev-status";

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
    expect(calls).toEqual([VERCEL_GATEWAY_PROVIDER_ID]);
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
