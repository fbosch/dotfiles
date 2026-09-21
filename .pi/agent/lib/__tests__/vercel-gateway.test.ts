import { describe, expect, test } from "bun:test";
import { requestVercelGateway } from "../vercel-gateway";

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
    expect(result).toEqual({ ok: true });
  });

  test("does not request or send when Gateway auth is unavailable", async () => {
    for (const apiKey of [undefined, "", "   "] as const) {
      let authCalls = 0;
      let fetchCalls = 0;
      const result = await requestVercelGateway(
        {
          getProviderAuth: async () => {
            authCalls += 1;
            return apiKey === undefined ? undefined : { auth: { apiKey } };
          },
        },
        {},
        {
          fetch: async () => {
            fetchCalls += 1;
            return new Response("unexpected");
          },
        },
      );

      expect(result).toBeUndefined();
      expect(authCalls).toBe(1);
      expect(fetchCalls).toBe(0);
    }
  });

  test("treats non-JSON, non-OK, and oversized responses as unavailable", async () => {
    const responses = [
      new Response("not-json", { status: 200 }),
      new Response("service unavailable", { status: 503 }),
      new Response("x".repeat(256_001), { status: 200 }),
    ];

    for (const response of responses) {
      await expect(
        requestVercelGateway(
          { getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }) },
          {},
          { fetch: async () => response },
        ),
      ).resolves.toBeUndefined();
    }
  });

  test("stops at the cancellation and timeout boundaries", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    let cancelledAuthCalls = 0;
    await expect(
      requestVercelGateway(
        {
          getProviderAuth: async () => {
            cancelledAuthCalls += 1;
            return { auth: { apiKey: "gateway-test-key" } };
          },
        },
        {},
        { signal: cancelled.signal, fetch: async () => new Response("unexpected") },
      ),
    ).resolves.toBeUndefined();
    expect(cancelledAuthCalls).toBe(0);

    await expect(
      requestVercelGateway(
        { getProviderAuth: async () => ({ auth: { apiKey: "gateway-test-key" } }) },
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
      ),
    ).resolves.toBeUndefined();
  });
});
