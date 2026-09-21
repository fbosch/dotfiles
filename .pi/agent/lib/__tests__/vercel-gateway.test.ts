import { describe, expect, test } from "bun:test";
import { parseRetryAfter, requestVercelGateway } from "../vercel-gateway";

const auth = { getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }) };

function expectFailure(
  result: Awaited<ReturnType<typeof requestVercelGateway>>,
  expected: { reason: string; stage: string; httpStatus?: number },
): void {
  expect(result).toMatchObject({ ok: false, ...expected });
  expect(result).not.toHaveProperty("message");
}

describe("requestVercelGateway", () => {
  test("resolves Pi auth and sends a verified Gateway request", async () => {
    let providerId: string | undefined;
    let requestUrl: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;

    const result = await requestVercelGateway(
      {
        getProviderAuth: async (provider: string) => {
          providerId = provider;
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

    expect(providerId).toBe("vercel-ai-gateway");
    expect(String(requestUrl)).toBe("https://ai-gateway.vercel.sh/typesafe/v1/systemone");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer gateway-test-key");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      state: { query: "find a tool" },
      model: "typesafe-ai/jev",
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
    expectFailure(authTimeout, { reason: "timeout", stage: "auth" });

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
    expectFailure(requestTimeout, { reason: "timeout", stage: "request" });

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
    expectFailure(bodyTimeout, { reason: "timeout", stage: "body" });
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
});
