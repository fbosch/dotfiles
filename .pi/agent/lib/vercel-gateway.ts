import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

const VERCEL_GATEWAY_PROVIDER_ID = "vercel-ai-gateway";
const VERCEL_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const VERCEL_GATEWAY_MODEL = "typesafe-ai/jev";
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_RESPONSE_CHARS = 256_000;

type VercelGatewayRegistry = Pick<ModelRegistry, "getProviderAuth">;
export type VercelGatewayFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface VercelGatewayRequestOptions {
  fetch?: VercelGatewayFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function requestVercelGateway<TRequest extends object>(
  registry: VercelGatewayRegistry,
  request: TRequest,
  options: VercelGatewayRequestOptions = {},
): Promise<unknown | undefined> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const requestSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  if (requestSignal.aborted) return undefined;

  try {
    const auth = await registry.getProviderAuth(VERCEL_GATEWAY_PROVIDER_ID);
    if (requestSignal.aborted) return undefined;

    const apiKey = auth?.auth.apiKey;
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) return undefined;

    const response = await (options.fetch ?? globalThis.fetch)(VERCEL_GATEWAY_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Keep Gateway routing private; callers supply only evaluator-specific state.
      body: JSON.stringify({ ...request, model: VERCEL_GATEWAY_MODEL }),
      signal: requestSignal,
    });
    if (!response.ok) return undefined;

    const text = await response.text();
    if (requestSignal.aborted || text.length > MAX_RESPONSE_CHARS) return undefined;

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}
