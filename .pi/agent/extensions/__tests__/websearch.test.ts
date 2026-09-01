import { describe, expect, test } from "bun:test";
import {
  parseMcpResponse,
  searchWeb,
  selectProviderForSearch,
  selectWebSearchProvider,
} from "../websearch";

describe("websearch", () => {
  test("honors an explicit provider override", () => {
    expect(selectWebSearchProvider("session", "exa")).toBe("exa");
    expect(selectWebSearchProvider("session", "parallel")).toBe("parallel");
    expect(() => selectWebSearchProvider("session", "paralell")).toThrow(
      "Invalid web search provider",
    );
    expect(selectProviderForSearch({ query: "topic", numResults: 2 }, "session")).toBe("exa");
  });

  test("parses JSON and server-sent event MCP responses", () => {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text: "search result" }] },
    };
    expect(parseMcpResponse(JSON.stringify(payload))).toBe("search result");
    expect(parseMcpResponse(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)).toBe(
      "search result",
    );
    expect(
      parseMcpResponse(
        'data: {"jsonrpc":"2.0",\ndata: "id":1,"result":{"content":[{"type":"text","text":"split"}]}}\n\n',
      ),
    ).toBe("split");
    expect(() =>
      parseMcpResponse(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { isError: true, content: [{ type: "text", text: "failed" }] },
        }),
      ),
    ).toThrow("failed");
    expect(() =>
      parseMcpResponse(JSON.stringify({ result: { content: [{ type: "text", text: "no id" }] } })),
    ).toThrow("no readable result");
  });

  test("calls Exa using the OpenCode search contract", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "result" }] },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await searchWeb(
      { query: "current topic", numResults: 4 },
      { provider: "exa", sessionId: "session-1", fetchFn },
    );

    expect(result).toBe("result");
    expect(requestUrl).toBe("https://mcp.exa.ai/mcp");
    expect(requestBody).toMatchObject({
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: "current topic",
          numResults: 4,
        },
      },
    });
  });

  test("calls Parallel with the session context", async () => {
    let requestBody: unknown;
    const fetchFn = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "parallel" }] } })}\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };

    const result = await searchWeb(
      { query: "another topic" },
      {
        provider: "parallel",
        sessionId: "session-2",
        modelName: "test/model",
        fetchFn,
      },
    );

    expect(result).toBe("parallel");
    expect(requestBody).toMatchObject({
      params: {
        name: "web_search",
        arguments: {
          objective: "another topic",
          search_queries: ["another topic"],
          session_id: "session-2",
          model_name: "test/model",
        },
      },
    });
  });

  test("returns a complete event-stream result without waiting for EOF", async () => {
    const encoder = new TextEncoder();
    const fetchFn = async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "streamed" }] } })}\n\n`,
            ),
          );
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    };

    await expect(
      searchWeb({ query: "stream" }, { provider: "parallel", sessionId: "session", fetchFn }),
    ).resolves.toBe("streamed");
  });

  test("rejects oversized provider responses", async () => {
    const fetchFn = async () => {
      return new Response("small", { headers: { "Content-Length": String(2 * 1024 * 1024) } });
    };

    await expect(
      searchWeb({ query: "large" }, { provider: "exa", sessionId: "session", fetchFn }),
    ).rejects.toThrow("response too large");
  });

  test("processes each server-sent event once", async () => {
    const encoder = new TextEncoder();
    const fetchFn = async () => {
      let event = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (event < 8_000) {
              event += 1;
              controller.enqueue(encoder.encode("data: {}\n\n"));
              return;
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "done" }] } })}\n\n`,
              ),
            );
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };

    await expect(
      searchWeb({ query: "events" }, { provider: "parallel", sessionId: "session", fetchFn }),
    ).resolves.toBe("done");
  });

  test("rejects unsupported provider response types", async () => {
    const fetchFn = async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: { content: [{ type: "text", text: "wrong media type" }] },
        }),
        { headers: { "Content-Type": "text/html" } },
      );
    };

    await expect(
      searchWeb({ query: "media" }, { provider: "exa", sessionId: "session", fetchFn }),
    ).rejects.toThrow("Unsupported web search response type");
  });
});
