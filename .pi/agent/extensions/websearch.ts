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

export interface WebSearchParams {
  query: string;
  numResults?: number;
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
  const override = process.env.PI_WEBSEARCH_PROVIDER ?? process.env.OPENCODE_WEBSEARCH_PROVIDER;
  if (override !== undefined && override.length > 0) {
    const provider = selectWebSearchProvider(sessionId, override);
    if (provider === "parallel" && params.numResults !== undefined) {
      throw new Error("Parallel web search does not support numResults");
    }
    return provider;
  }
  if (params.numResults !== undefined) return "exa";
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
  if (envelope.jsonrpc !== "2.0" || envelope.id !== expectedId) return undefined;
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
    if (content.type !== "text") continue;
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

function parseSseEvent(event: string): string | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data.length === 0 ? undefined : parseJsonPayload(data);
}

export function parseMcpResponse(body: string): string {
  const direct = parseJsonPayload(body.trim());
  if (direct !== undefined) return direct;

  const events = body.replace(/\r\n/g, "\n").split("\n\n");
  for (const event of events) {
    const text = parseSseEvent(event);
    if (text !== undefined) return text;
  }

  throw new Error("Web search provider returned no readable result");
}

function eventBoundary(buffer: string): { index: number; length: number } | undefined {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return undefined;
  if (lf >= 0 && (crlf < 0 || lf < crlf)) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SEARCH_RESPONSE_SIZE) {
    await response.body?.cancel();
    throw new Error("Web search response too large");
  }
  if (response.body === null) return "";

  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const isEventStream = mediaType === "text/event-stream";
  if (response.ok && mediaType !== "application/json" && !isEventStream) {
    await response.body?.cancel();
    throw new Error(`Unsupported web search response type: ${mediaType ?? "missing"}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SEARCH_RESPONSE_SIZE) {
      await reader.cancel();
      throw new Error("Web search response too large");
    }
    buffer += decoder.decode(value, { stream: true });

    if (!response.ok || !isEventStream) continue;
    let boundary = eventBoundary(buffer);
    while (boundary !== undefined) {
      const event = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const result = parseSseEvent(event);
      if (result !== undefined) {
        await reader.cancel();
        return result;
      }
      boundary = eventBoundary(buffer);
    }
  }

  buffer += decoder.decode();
  if (response.ok && isEventStream) {
    const result = parseSseEvent(buffer);
    if (result !== undefined) return result;
    throw new Error("Web search provider returned no readable result");
  }
  return buffer;
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
        numResults: params.numResults ?? 8,
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
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === "text/event-stream") return body;
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
      executionMode: "sequential",

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
