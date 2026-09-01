import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const EXA_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_URL = "https://search.parallel.ai/mcp";
const SEARCH_TIMEOUT_MS = 25_000;
const MAX_SEARCH_RESPONSE_SIZE = 1024 * 1024;

export type WebSearchProvider = "exa" | "parallel";
export type WebSearchType = "auto" | "fast" | "deep";
export type LiveCrawlMode = "fallback" | "preferred";

export interface WebSearchParams {
  query: string;
  numResults?: number;
  livecrawl?: LiveCrawlMode;
  type?: WebSearchType;
  contextMaxCharacters?: number;
}

interface WebSearchDetails {
  provider: WebSearchProvider;
  query: string;
}

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface SearchOptions {
  provider: WebSearchProvider;
  sessionId: string;
  modelName?: string;
  signal?: AbortSignal;
  fetchFn?: FetchFunction;
}

const WebSearchParamsSchema = {
  "~kind": "Object" as const,
  type: "object" as const,
  required: ["query"] as const,
  properties: {
    query: {
      "~kind": "String" as const,
      type: "string" as const,
      minLength: 1,
      maxLength: 10_000,
      description: "Web search query.",
    },
    numResults: {
      "~kind": "Number" as const,
      "~optional": true as const,
      type: "number" as const,
      minimum: 1,
      maximum: 100,
      description: "Number of results to return (default: 8).",
    },
    livecrawl: {
      "~kind": "Union" as const,
      "~optional": true as const,
      anyOf: [
        { "~kind": "Literal" as const, const: "fallback" as const, type: "string" as const },
        { "~kind": "Literal" as const, const: "preferred" as const, type: "string" as const },
      ],
      description: "Use live crawling as a fallback or prefer it over cached content.",
    },
    type: {
      "~kind": "Union" as const,
      "~optional": true as const,
      anyOf: [
        { "~kind": "Literal" as const, const: "auto" as const, type: "string" as const },
        { "~kind": "Literal" as const, const: "fast" as const, type: "string" as const },
        { "~kind": "Literal" as const, const: "deep" as const, type: "string" as const },
      ],
      description: "Search depth: auto, fast, or deep.",
    },
    contextMaxCharacters: {
      "~kind": "Number" as const,
      "~optional": true as const,
      type: "number" as const,
      minimum: 1,
      maximum: 100_000,
      description: "Maximum result context characters (default: 10000).",
    },
  },
};

function stableParity(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function selectWebSearchProvider(
  sessionId: string,
  override = process.env.PI_WEBSEARCH_PROVIDER ?? process.env.OPENCODE_WEBSEARCH_PROVIDER,
): WebSearchProvider {
  if (override === "exa" || override === "parallel") return override;
  if (override !== undefined && override.length > 0) {
    throw new Error(`Invalid web search provider: ${override}`);
  }
  return stableParity(sessionId) % 2 === 0 ? "exa" : "parallel";
}

export function selectProviderForSearch(
  params: WebSearchParams,
  sessionId: string,
): WebSearchProvider {
  if (
    params.numResults !== undefined ||
    params.livecrawl !== undefined ||
    params.type !== undefined ||
    params.contextMaxCharacters !== undefined
  ) {
    return "exa";
  }
  return selectWebSearchProvider(sessionId);
}

function parseMcpPayload(value: unknown, expectedId = 1): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const envelope = value as {
    jsonrpc?: unknown;
    id?: unknown;
    error?: { message?: unknown };
    result?: { content?: unknown; isError?: unknown };
  };
  if (envelope.jsonrpc !== undefined && envelope.jsonrpc !== "2.0") return undefined;
  if (envelope.id !== undefined && envelope.id !== expectedId) return undefined;
  if (envelope.error !== undefined) {
    const message = envelope.error.message;
    throw new Error(
      typeof message === "string" ? message : "Web search provider returned an error",
    );
  }

  if (!Array.isArray(envelope.result?.content)) return undefined;
  const texts: string[] = [];
  for (const item of envelope.result.content) {
    if (typeof item !== "object" || item === null) continue;
    const content = item as { type?: unknown; text?: unknown };
    if (content.type !== undefined && content.type !== "text") continue;
    if (typeof content.text === "string" && content.text.length > 0) texts.push(content.text);
  }
  if (texts.length === 0) return undefined;
  const text = texts.join("\n\n");
  if (envelope.result.isError === true) throw new Error(text);
  return text;
}

function parseJsonPayload(value: string): string | undefined {
  try {
    return parseMcpPayload(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function parseMcpResponse(body: string): string {
  const direct = parseJsonPayload(body.trim());
  if (direct !== undefined) return direct;

  const events = body.replace(/\r\n/g, "\n").split("\n\n");
  for (const event of events) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    const text = parseJsonPayload(data);
    if (text !== undefined) return text;
  }

  throw new Error("Web search provider returned no readable result");
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SEARCH_RESPONSE_SIZE) {
    await response.body?.cancel();
    throw new Error("Web search response too large");
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const isEventStream =
    response.headers.get("content-type")?.includes("text/event-stream") === true;
  let body = "";
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SEARCH_RESPONSE_SIZE) {
      await reader.cancel();
      throw new Error("Web search response too large");
    }
    body += decoder.decode(value, { stream: true });

    if (response.ok && isEventStream && /\r?\n\r?\n/.test(body)) {
      try {
        const result = parseMcpResponse(body);
        await reader.cancel();
        return result;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "Web search provider returned no readable result"
        ) {
          throw error;
        }
      }
    }
  }

  body += decoder.decode();
  if (response.ok && isEventStream) return parseMcpResponse(body);
  return body;
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export async function searchWeb(params: WebSearchParams, options: SearchOptions): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch;
  const isParallel = options.provider === "parallel";
  const url = isParallel ? PARALLEL_URL : EXA_URL;
  const toolName = isParallel ? "web_search" : "web_search_exa";
  const args = isParallel
    ? {
        objective: params.query,
        search_queries: [params.query],
        session_id: options.sessionId,
        ...(options.modelName === undefined ? {} : { model_name: options.modelName }),
      }
    : {
        query: params.query,
        type: params.type ?? "auto",
        numResults: params.numResults ?? 8,
        livecrawl: params.livecrawl ?? "fallback",
        ...(params.contextMaxCharacters === undefined
          ? {}
          : { contextMaxCharacters: params.contextMaxCharacters }),
      };

  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "User-Agent": "pi-websearch",
  };
  if (isParallel && process.env.PARALLEL_API_KEY !== undefined) {
    headers.Authorization = `Bearer ${process.env.PARALLEL_API_KEY}`;
  }
  if (!isParallel && process.env.EXA_API_KEY !== undefined) {
    headers["x-api-key"] = process.env.EXA_API_KEY;
  }

  const response = await fetchFn(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
    signal: requestSignal(options.signal),
    redirect: "manual",
  });

  const body = await readBoundedResponse(response);
  if (!response.ok) {
    throw new Error(`Web search provider returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  if (response.headers.get("content-type")?.includes("text/event-stream") === true) return body;
  return parseMcpResponse(body);
}

function modelName(ctx: ExtensionContext): string | undefined {
  const id = ctx.model?.id;
  return typeof id === "string" ? id.slice(0, 100) : undefined;
}

export default function webSearchExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool<typeof WebSearchParamsSchema, WebSearchDetails>({
      name: "websearch",
      label: "Web Search",
      description: `Search the current web using Exa or Parallel. Use ${new Date().getFullYear()} when searching for recent information.`,
      promptSnippet: "Search the current web and return source-backed results",
      promptGuidelines: [
        "Use websearch for discovery, then webfetch to open authoritative result URLs.",
        `Use ${new Date().getFullYear()} in queries for recent or current information.`,
      ],
      parameters: WebSearchParamsSchema,
      executionMode: "parallel",

      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const query = params.query.trim();
        if (query.length === 0) throw new Error("Web search query must not be empty");

        const sessionId = ctx.sessionManager.getSessionId();
        const provider = selectProviderForSearch(params, sessionId);
        const currentModelName = modelName(ctx);
        const result = await searchWeb(
          { ...params, query },
          {
            provider,
            sessionId,
            ...(currentModelName === undefined ? {} : { modelName: currentModelName }),
            ...(signal === undefined ? {} : { signal }),
          },
        );

        return {
          content: [{ type: "text", text: result }],
          details: { provider, query },
        };
      },

      renderCall(args, theme) {
        return new Text(
          `${theme.fg("toolTitle", theme.bold("websearch "))}${theme.fg("accent", args.query)}`,
          0,
          0,
        );
      },

      renderResult(result, _options, theme) {
        return new Text(
          theme.fg("success", `${result.details.provider} results for ${result.details.query}`),
          0,
          0,
        );
      },
    }),
  );
}
