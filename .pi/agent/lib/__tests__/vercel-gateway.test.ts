import { describe, expect, test } from "bun:test";
import {
  OPENROUTER_GATEWAY_ENDPOINT,
  OPENROUTER_GATEWAY_MODEL,
  OPENROUTER_PROVIDER_ID,
  parseRetryAfter,
  requestVercelGateway,
  VERCEL_GATEWAY_ENDPOINT,
  VERCEL_GATEWAY_MODEL,
  VERCEL_GATEWAY_PROVIDER_ID,
} from "../vercel-gateway";

const auth = { getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }) };

function expectFailure(
  result: Awaited<ReturnType<typeof requestVercelGateway>>,
  expected: { reason: string; stage: string; httpStatus?: number; provider?: string },
): void {
  expect(result).toMatchObject({ ok: false, ...expected });
  expect(result).not.toHaveProperty("message");
}

describe("requestVercelGateway", () => {
  test("resolves Pi auth and sends a verified Gateway request", async () => {
    const providerIds: string[] = [];
    let requestUrl: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;

    const result = await requestVercelGateway(
      {
        getProviderAuth: async (provider: string) => {
          providerIds.push(provider);
          return { auth: { apiKey: "gateway-test-key" } };
        },
      },
      { state: { query: "find a tool" } },
      {
        fetch: async (input, init) => {
          requestUrl = input;
          requestInit = init;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
    );

    expect(providerIds).toEqual([VERCEL_GATEWAY_PROVIDER_ID]);
    expect(String(requestUrl)).toBe(VERCEL_GATEWAY_ENDPOINT);
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer gateway-test-key");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      state: { query: "find a tool" },
      model: VERCEL_GATEWAY_MODEL,
    });
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  test("categorizes missing credentials without requesting the Gateway", async () => {
    for (const apiKey of [undefined, "", "   "] as const) {
      let fetchCalls = 0;
      const result = await requestVercelGateway(
        {
          getProviderAuth: async () => (apiKey === undefined ? undefined : { auth: { apiKey } }),
        },
        {},
        {
          fetch: async () => {
            fetchCalls += 1;
            return new Response("unexpected");
          },
        },
      );

      expectFailure(result, { reason: "missing-credentials", stage: "auth" });
      expect(fetchCalls).toBe(0);
    }
  });

  test("categorizes auth resolver failures without exposing exception text", async () => {
    const result = await requestVercelGateway(
      { getProviderAuth: async () => Promise.reject(new Error("secret auth detail")) },
      {},
    );

    expectFailure(result, { reason: "auth-failure", stage: "auth" });
    expect(JSON.stringify(result)).not.toContain("secret auth detail");
  });

  test("categorizes timeout at auth, request, and body stages", async () => {
    const authTimeout = await requestVercelGateway(
      { getProviderAuth: () => new Promise(() => undefined) },
      {},
      { timeoutMs: 5, fetch: async () => new Response("unexpected") },
    );
    expectFailure(authTimeout, {
      reason: "timeout",
      stage: "auth",
      provider: OPENROUTER_PROVIDER_ID,
    });

    const requestTimeout = await requestVercelGateway(
      auth,
      {},
      {
        timeoutMs: 5,
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new Error("request timed out"));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener("abort", abort, { once: true });
          }),
      },
    );
    expectFailure(requestTimeout, {
      reason: "timeout",
      stage: "request",
      provider: OPENROUTER_PROVIDER_ID,
    });

    const bodyTimeout = await requestVercelGateway(
      auth,
      {},
      {
        timeoutMs: 5,
        fetch: async () =>
          ({
            ok: true,
            text: () => new Promise<string>(() => undefined),
          }) as Response,
      },
    );
    expectFailure(bodyTimeout, {
      reason: "timeout",
      stage: "body",
      provider: OPENROUTER_PROVIDER_ID,
    });
  });

  test("categorizes caller cancellation at auth, request, and body stages", async () => {
    const authController = new AbortController();
    authController.abort();
    let authCalls = 0;
    const authCancelled = await requestVercelGateway(
      {
        getProviderAuth: async () => {
          authCalls += 1;
          return { auth: { apiKey: "gateway-test-key" } };
        },
      },
      {},
      { signal: authController.signal, fetch: async () => new Response("unexpected") },
    );
    expectFailure(authCancelled, { reason: "caller-cancellation", stage: "auth" });
    expect(authCalls).toBe(0);

    const requestController = new AbortController();
    const requestCancelled = await requestVercelGateway(
      auth,
      {},
      {
        signal: requestController.signal,
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve) => {
            init?.signal?.addEventListener("abort", () => requestController.abort(), {
              once: true,
            });
            setTimeout(() => requestController.abort(), 1);
          }),
      },
    );
    expectFailure(requestCancelled, { reason: "caller-cancellation", stage: "request" });

    const bodyController = new AbortController();
    const bodyCancelled = await requestVercelGateway(
      auth,
      {},
      {
        signal: bodyController.signal,
        fetch: async () =>
          ({
            ok: true,
            text: () => {
              setTimeout(() => bodyController.abort(), 1);
              return new Promise<string>(() => undefined);
            },
          }) as Response,
      },
    );
    expectFailure(bodyCancelled, { reason: "caller-cancellation", stage: "body" });
  });

  test("parses safe Retry-After seconds and HTTP dates without exposing headers", async () => {
    const numeric = await requestVercelGateway(
      auth,
      {},
      { fetch: async () => new Response("busy", { status: 429, headers: { "Retry-After": "7" } }) },
    );
    expect(numeric).toMatchObject({
      ok: false,
      reason: "http-status",
      httpStatus: 429,
      retryAfterMs: 7_000,
    });

    const now = Date.parse("Wed, 21 Oct 2015 07:28:00 GMT");
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfter("Infinity", now)).toBeUndefined();
    expect(parseRetryAfter("-1", now)).toBeUndefined();
    expect(parseRetryAfter("7.5", now)).toBeUndefined();
    expect(JSON.stringify(numeric)).not.toContain("Retry-After");
  });

  test("categorizes HTTP status, invalid JSON, oversized body, and body failures safely", async () => {
    const status = await requestVercelGateway(
      auth,
      {},
      { fetch: async () => new Response("no", { status: 503 }) },
    );
    expectFailure(status, { reason: "http-status", stage: "request", httpStatus: 503 });

    const invalidJson = await requestVercelGateway(
      auth,
      {},
      { fetch: async () => new Response("not-json") },
    );
    expectFailure(invalidJson, { reason: "invalid-json", stage: "body" });

    const oversized = await requestVercelGateway(
      auth,
      {},
      { fetch: async () => new Response("x".repeat(256_001)) },
    );
    expectFailure(oversized, { reason: "oversized-body", stage: "body" });

    const bodyFailure = await requestVercelGateway(
      auth,
      {},
      {
        fetch: async () =>
          ({
            ok: true,
            text: () => Promise.reject(new Error("raw body detail")),
          }) as Response,
      },
    );
    expectFailure(bodyFailure, { reason: "body-failure", stage: "body" });
    expect(JSON.stringify(bodyFailure)).not.toContain("raw body detail");

    const requestFailure = await requestVercelGateway(
      auth,
      {},
      { fetch: async () => Promise.reject(new Error("raw request detail")) },
    );
    expectFailure(requestFailure, { reason: "request-failure", stage: "request" });
    expect(JSON.stringify(requestFailure)).not.toContain("raw request detail");
  });

  test("falls back from missing Vercel auth to OpenRouter with the verified System One shape", async () => {
    const authProviders: string[] = [];
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const typedResponse = {
      model: "typesafe/jev-1.13-20260917",
      answers: {
        route: {
          type: "choice",
          choice: "stay",
          probabilities: { stay: 1 },
          confidence: 1,
        },
      },
      usage: { input_tokens: 12, output_tokens: 0 },
    };

    const result = await requestVercelGateway(
      {
        getProviderAuth: async (provider: string) => {
          authProviders.push(provider);
          return provider === OPENROUTER_PROVIDER_ID
            ? { auth: { apiKey: "openrouter-test-key" } }
            : undefined;
        },
      },
      {
        state: { query: "stay" },
        questions: { route: { type: "choice", criteria: { stay: null } } },
      },
      {
        fetch: async (input, init) => {
          requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
          return new Response(JSON.stringify(typedResponse));
        },
      },
    );

    expect(authProviders).toEqual([VERCEL_GATEWAY_PROVIDER_ID, OPENROUTER_PROVIDER_ID]);
    expect(requests).toEqual([
      {
        url: OPENROUTER_GATEWAY_ENDPOINT,
        body: {
          state: { query: "stay" },
          questions: { route: { type: "choice", criteria: { stay: null } } },
          model: OPENROUTER_GATEWAY_MODEL,
        },
      },
    ]);
    expect(result).toEqual({ ok: true, value: typedResponse });
  });

  test("falls back after Vercel HTTP and network failures", async () => {
    for (const primaryFailure of ["http", "network"] as const) {
      const urls: string[] = [];
      let fetchCalls = 0;
      const result = await requestVercelGateway(
        { getProviderAuth: async () => ({ auth: { apiKey: "provider-key" } }) },
        { state: { query: primaryFailure } },
        {
          fetch: async (input) => {
            fetchCalls += 1;
            urls.push(String(input));
            if (fetchCalls === 1) {
              if (primaryFailure === "network") throw new Error("network detail");
              return new Response("busy", { status: 503 });
            }
            return new Response(JSON.stringify({ answers: { route: { type: "choice" } } }));
          },
        },
      );

      expect(result).toEqual({ ok: true, value: { answers: { route: { type: "choice" } } } });
      expect(urls).toEqual([VERCEL_GATEWAY_ENDPOINT, OPENROUTER_GATEWAY_ENDPOINT]);
    }
  });

  test("preserves a useful Vercel Retry-After when OpenRouter auth is unavailable", async () => {
    let fetchCalls = 0;
    const result = await requestVercelGateway(
      {
        getProviderAuth: async (provider: string) =>
          provider === VERCEL_GATEWAY_PROVIDER_ID
            ? { auth: { apiKey: "vercel-test-key" } }
            : undefined,
      },
      {},
      {
        fetch: async () => {
          fetchCalls += 1;
          return new Response("busy", { status: 429, headers: { "Retry-After": "7" } });
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      provider: VERCEL_GATEWAY_PROVIDER_ID,
      reason: "http-status",
      stage: "request",
      httpStatus: 429,
      retryAfterMs: 7_000,
    });
    expect(fetchCalls).toBe(1);
  });

  test("returns the bounded fallback failure when both providers fail", async () => {
    let fetchCalls = 0;
    const result = await requestVercelGateway(
      { getProviderAuth: async () => ({ auth: { apiKey: "provider-key" } }) },
      {},
      {
        fetch: async () => {
          fetchCalls += 1;
          return new Response("provider detail", { status: fetchCalls === 1 ? 503 : 401 });
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      provider: OPENROUTER_PROVIDER_ID,
      stage: "request",
      reason: "http-status",
      httpStatus: 401,
    });
    expect(fetchCalls).toBe(2);
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  test("falls back after Vercel auth, request, and body attempt timeouts", async () => {
    for (const stage of ["auth", "request", "body"] as const) {
      let primaryFetchCalls = 0;
      let fallbackFetchCalls = 0;
      let primaryAborted = false;
      let releasePrimaryAuth: (() => void) | undefined;

      const result = await requestVercelGateway(
        {
          getProviderAuth: async (provider: string) => {
            if (provider === VERCEL_GATEWAY_PROVIDER_ID && stage === "auth") {
              return new Promise((resolve) => {
                releasePrimaryAuth = () => resolve({ auth: { apiKey: "late-primary-key" } });
              });
            }
            return { auth: { apiKey: `${provider}-key` } };
          },
        },
        { state: { stage } },
        {
          timeoutMs: 80,
          fetch: async (input, init) => {
            if (String(input) === VERCEL_GATEWAY_ENDPOINT) {
              primaryFetchCalls += 1;
              if (stage === "request") {
                return new Promise<Response>((_resolve, reject) => {
                  const abort = () => {
                    primaryAborted = true;
                    reject(new Error("primary request aborted"));
                  };
                  if (init?.signal?.aborted) abort();
                  else init?.signal?.addEventListener("abort", abort, { once: true });
                });
              }
              return {
                ok: true,
                text: () => {
                  init?.signal?.addEventListener(
                    "abort",
                    () => {
                      primaryAborted = true;
                    },
                    { once: true },
                  );
                  return new Promise<string>(() => undefined);
                },
              } as Response;
            }

            fallbackFetchCalls += 1;
            return new Response(JSON.stringify({ answers: { route: { type: "choice" } } }));
          },
        },
      );

      expect(result).toEqual({ ok: true, value: { answers: { route: { type: "choice" } } } });
      expect(primaryFetchCalls).toBe(stage === "auth" ? 0 : 1);
      expect(fallbackFetchCalls).toBe(1);
      if (stage === "auth") {
        releasePrimaryAuth?.();
        await Promise.resolve();
        expect(primaryFetchCalls).toBe(0);
      } else {
        expect(primaryAborted).toBe(true);
      }
    }
  });

  test("does not start fallback after caller abort or an exhausted shared deadline", async () => {
    const callerController = new AbortController();
    let callerFetchCalls = 0;
    const callerCancelled = await requestVercelGateway(
      auth,
      {},
      {
        signal: callerController.signal,
        fetch: async (_input, init) => {
          callerFetchCalls += 1;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
            setTimeout(() => callerController.abort(), 1);
          });
        },
      },
    );
    expect(callerCancelled).toMatchObject({ ok: false, reason: "caller-cancellation" });
    expect(callerFetchCalls).toBe(1);

    let deadlineFetchCalls = 0;
    let fallbackAborted = false;
    const deadlineExpired = await requestVercelGateway(
      auth,
      {},
      {
        timeoutMs: 40,
        fetch: async (input, init) => {
          deadlineFetchCalls += 1;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => {
                if (String(input) === OPENROUTER_GATEWAY_ENDPOINT) fallbackAborted = true;
                reject(new Error("timed out"));
              },
              { once: true },
            );
          });
        },
      },
    );
    expect(deadlineExpired).toMatchObject({
      ok: false,
      reason: "timeout",
      provider: OPENROUTER_PROVIDER_ID,
    });
    expect(deadlineFetchCalls).toBe(2);
    expect(fallbackAborted).toBe(true);
  });
});
