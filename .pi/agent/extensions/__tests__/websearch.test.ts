import { describe, expect, test } from "bun:test";
import { parseMcpResponse, searchWeb, selectWebSearchProvider } from "../websearch";

describe("websearch", () => {
  test("honors an explicit provider override", () => {
    expect(selectWebSearchProvider("session", "exa")).toBe("exa");
    expect(selectWebSearchProvider("session", "parallel")).toBe("parallel");
  });

  test("parses JSON and server-sent event MCP responses", () => {
    const payload = { result: { content: [{ type: "text", text: "search result" }] } };
    expect(parseMcpResponse(JSON.stringify(payload))).toBe("search result");
    expect(parseMcpResponse(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)).toBe(
      "search result",
    );
  });

  test("calls Exa using the OpenCode search contract", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ result: { content: [{ type: "text", text: "result" }] } }),
      );
    };

    const result = await searchWeb(
      { query: "current topic", type: "deep", numResults: 4, livecrawl: "preferred" },
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
          type: "deep",
          numResults: 4,
          livecrawl: "preferred",
        },
      },
    });
  });

  test("calls Parallel with the session context", async () => {
    let requestBody: unknown;
    const fetchFn = async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        `data: ${JSON.stringify({ result: { content: [{ type: "text", text: "parallel" }] } })}\n`,
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
});
