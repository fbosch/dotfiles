import type {
  Model,
  OpenAICodexResponsesOptions,
  Provider,
  ProviderRequestOptions,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const FAST_SUFFIX = "-fast";
const FAST_SERVICE_TIER = "priority";
const FAST_MODEL_IDS: ReadonlySet<string> = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]);

type CodexApi = "openai-codex-responses";
type CodexProvider = Provider<CodexApi>;
type PayloadTransform = NonNullable<ProviderRequestOptions["onPayload"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function getBaseModelId(modelId: string): string | undefined {
  if (modelId.endsWith(FAST_SUFFIX) === false) return undefined;

  const baseModelId = modelId.slice(0, -FAST_SUFFIX.length);
  return FAST_MODEL_IDS.has(baseModelId) ? baseModelId : undefined;
}

export function applyFastServiceTier(
  payload: unknown,
  baseModelId: string,
): Record<string, unknown> {
  if (isRecord(payload) === false) {
    throw new Error("OpenAI Codex fast mode requires an object request payload");
  }

  return {
    ...payload,
    model: baseModelId,
    service_tier: FAST_SERVICE_TIER,
  };
}

export function createFastPayloadTransform(
  baseModelId: string,
  transform?: PayloadTransform,
): PayloadTransform {
  return async (payload, model) => {
    const fastPayload = applyFastServiceTier(payload, baseModelId);
    const transformed = await transform?.(fastPayload, model);
    return applyFastServiceTier(transformed ?? fastPayload, baseModelId);
  };
}

function createFastAlias(model: Model<CodexApi>): Model<CodexApi> {
  return {
    ...model,
    id: `${model.id}${FAST_SUFFIX}`,
    name: `${model.name} (Fast)`,
  };
}

function resolveNativeModel(
  provider: CodexProvider,
  model: Model<CodexApi>,
): { model: Model<CodexApi>; fast: boolean } {
  const baseModelId = getBaseModelId(model.id);
  if (baseModelId === undefined) return { model, fast: false };

  const baseModel = provider.getModels().find((candidate) => candidate.id === baseModelId);
  if (baseModel === undefined) {
    throw new Error(`OpenAI Codex fast model has no base model: ${model.id}`);
  }

  return { model: baseModel, fast: true };
}

export function createOpenAIFastProvider(provider: CodexProvider): CodexProvider {
  const fastProvider: CodexProvider = {
    id: provider.id,
    name: provider.name,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(provider.headers === undefined ? {} : { headers: provider.headers }),
    auth: provider.auth,
    getModels() {
      const models = provider.getModels();
      const fastModels = models
        .filter((model) => FAST_MODEL_IDS.has(model.id))
        .map(createFastAlias);
      return [...models, ...fastModels];
    },
    stream(model, context, options) {
      const resolved = resolveNativeModel(provider, model as Model<CodexApi>);
      const codexOptions = options as OpenAICodexResponsesOptions | undefined;
      if (resolved.fast === false) {
        return provider.stream(resolved.model, context, codexOptions);
      }

      return provider.stream(resolved.model, context, {
        ...codexOptions,
        serviceTier: FAST_SERVICE_TIER,
      });
    },
    streamSimple(model, context, options) {
      const resolved = resolveNativeModel(provider, model as Model<CodexApi>);
      if (resolved.fast === false) return provider.streamSimple(resolved.model, context, options);

      return provider.streamSimple(resolved.model, context, {
        ...options,
        onPayload: createFastPayloadTransform(resolved.model.id, options?.onPayload),
      });
    },
  };

  return fastProvider;
}

export default function openaiFast(pi: ExtensionAPI): void {
  pi.registerProvider(createOpenAIFastProvider(openaiCodexProvider()));
}
