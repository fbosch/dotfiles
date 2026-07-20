import { describe, expect, test } from "bun:test"
import { createCodexOAuthFetch, prepareResponsesLiteRequest } from "./adapter"

describe("Responses Lite compatibility", () => {
  test("rewrites all GPT-5.6 Lite models and preserves their mapped sessions", () => {
    const sessionIDs = new Map<string, string>()
    const first = transform("gpt-5.6-terra", sessionIDs, fullRequest)
    const { headers, body } = responseParts(first)
    const sessionID = headers.get("session-id")

    assertTransformedRequest(headers, body, sessionID)

    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      expect(responseParts(transform(model, sessionIDs)).headers.get("session-id")).toBe(sessionID)
    }
  })

  test("leaves non-Lite and already adapted requests unchanged", () => {
    const sessionIDs = new Map<string, string>()
    const legacy = prepareResponsesLiteRequest(
      [
        "https://chatgpt.com/backend-api/codex/responses",
        { headers: { "session-id": "ses_legacy" }, body: JSON.stringify({ model: "gpt-5.5", input: [] }) },
      ],
      sessionIDs,
    )
    const adapted = prepareResponsesLiteRequest(
      [
        "https://chatgpt.com/backend-api/codex/responses",
        {
          headers: { "session-id": "ses_lite", "x-openai-internal-codex-responses-lite": "true" },
          body: JSON.stringify({ model: "gpt-5.6-luna", input: [] }),
        },
      ],
      sessionIDs,
    )

    expect(legacy).toBeUndefined()
    expect(adapted).toBeUndefined()
    expect(sessionIDs.size).toBe(0)
  })

  test("replaces the sentinel function with one native tool-search descriptor", () => {
    const { body } = responseParts(transform("gpt-5.6-terra", new Map(), {
      input: [],
      tools: [
        { type: "function", name: "tool_search", description: "Internal", parameters: {} },
        { type: "function", name: "noop" },
        { type: "tool_search" },
      ],
    }))

    expect(body.input).toEqual([
      {
        type: "additional_tools",
        role: "developer",
        tools: [{ type: "tool_search" }, { type: "function", name: "noop" }],
      },
    ])
  })

  test("rewrites the sentinel for non-Lite Responses requests", () => {
    const result = prepareResponsesLiteRequest(
      [
        "https://chatgpt.com/backend-api/codex/responses",
        {
          headers: { "session-id": "ses_test", "content-length": "123" },
          body: JSON.stringify({
            model: "gpt-5.4-mini-fast",
            input: [],
            tools: [{ type: "function", name: "tool_search", description: "Internal", parameters: {} }],
          }),
        },
      ],
      new Map(),
    )
    if (!result) throw new Error("Expected native tool-search rewrite")

    const { headers, body } = responseParts(result)
    expect(headers.get("content-length")).toBeNull()
    expect(body).toEqual({
      model: "gpt-5.4-mini-fast",
      input: [],
      tools: [{ type: "tool_search" }],
    })
  })

  test("overrides the OAuth fetch boundary", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = []
    const providerFetch = createCodexOAuthFetch({
      getAuth: async () => ({
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: Date.now() + 60_000,
        accountId: "account-id",
      }),
      setAuth: async () => {},
      sessionIDs: new Map(),
      httpFetch: async (input, init) => {
        requests.push({
          url: String(input),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        })
        return new Response()
      },
    })

    await providerFetch("https://api.openai.com/v1/responses", {
      headers: { "session-id": "ses_test" },
      body: JSON.stringify({ model: "gpt-5.6-luna", input: [], stream: true }),
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer access-token")
    expect(requests[0]?.headers.get("chatgpt-account-id")).toBe("account-id")
    expect(requests[0]?.headers.get("x-openai-internal-codex-responses-lite")).toBe("true")
  })
})

const fullRequest = {
  input: [
    {
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,test", detail: "high" }],
    },
  ],
  instructions: "Be concise.",
  tools: [{ type: "function", name: "noop" }],
  parallel_tool_calls: true,
  reasoning: { effort: "high" },
  stream: true,
}

function transform(model: string, sessionIDs: Map<string, string>, request: object = { input: [], stream: true }) {
  const result = prepareResponsesLiteRequest(
    [
      "https://chatgpt.com/backend-api/codex/responses",
      { headers: { "session-id": "ses_test" }, body: JSON.stringify({ model, ...request }) },
    ],
    sessionIDs,
  )
  if (!result) throw new Error("Expected Lite request transformation")
  return result
}

function responseParts(result: ReturnType<typeof transform>) {
  return {
    headers: new Headers(result[1]?.headers),
    body: JSON.parse(String(result[1]?.body)),
  }
}

function assertTransformedRequest(headers: Headers, body: Record<string, unknown>, sessionID: string | null) {
  expect(sessionID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(headers.get("x-session-affinity")).toBe(sessionID)
  expect(headers.get("version")).toBe("0.144.0")
  expect(headers.get("x-openai-internal-codex-responses-lite")).toBe("true")
  expect(body).toEqual({
    model: "gpt-5.6-terra",
    input: [
      { type: "additional_tools", role: "developer", tools: [{ type: "function", name: "noop" }] },
      { type: "message", role: "developer", content: [{ type: "input_text", text: "Be concise." }] },
      { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,test" }] },
    ],
    tool_choice: "auto",
    parallel_tool_calls: false,
    prompt_cache_key: sessionID,
    reasoning: { effort: "high", context: "all_turns" },
    stream: true,
  })
}
