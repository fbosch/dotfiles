import { join } from "node:path";
import {
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { selectProfile } from "../../extensions/auth-profiles/profile-selector";
import { authPathFor } from "../../extensions/auth-profiles/profile-store";
import { projectIsTrusted } from "../../extensions/auth-profiles/project-trust";
import { resolveFastModelRequest } from "../../extensions/openai-fast";
import {
  type CommitMessageModelConfig,
  resolveCommitMessageModelConfig,
  type ThinkingLevel,
} from "./config";
import { COMMIT_SYSTEM_PROMPT, type CompleteCommitPrompt } from "./generate";

const DEFAULT_TIMEOUT_MS = 60_000;
const MINIMUM_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_TOKENS = 256;

export interface PiCommitModel {
  complete: CompleteCommitPrompt;
  modelRef: string;
  profile: string;
  thinkingLevel?: ThinkingLevel;
}

function commandTimeoutMs(): number {
  const raw = process.env.AI_COMMIT_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < MINIMUM_TIMEOUT_MS ? DEFAULT_TIMEOUT_MS : parsed;
}

async function createConfiguredRuntime(cwd: string): Promise<{
  runtime: ModelRuntime;
  settings: SettingsManager;
  profile: string;
}> {
  const agentDir = getAgentDir();
  const trusted = projectIsTrusted(cwd, agentDir);
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
  const { profile } = await selectProfile(
    {
      cwd,
      isProjectTrusted: () => trusted,
    },
    { agentDir },
  );
  const runtime = await ModelRuntime.create({
    authPath: authPathFor(profile, agentDir),
    modelsPath: join(agentDir, "models.json"),
  });
  return { runtime, settings, profile };
}

function commitMessageModelConfig(settings: SettingsManager): CommitMessageModelConfig | null {
  return resolveCommitMessageModelConfig(
    settings.getGlobalSettings(),
    settings.isProjectTrusted() ? settings.getProjectSettings() : undefined,
  );
}

function selectAvailableDefault<T extends { provider: string; id: string }>(
  settings: SettingsManager,
  availableModels: readonly T[],
): T | undefined {
  const defaultProvider = settings.getDefaultProvider();
  const defaultModel = settings.getDefaultModel();
  if (defaultProvider === undefined || defaultModel === undefined) return availableModels[0];
  return (
    availableModels.find(
      (model) => model.provider === defaultProvider && model.id === defaultModel,
    ) ?? availableModels[0]
  );
}

async function resolveModelSelection(cwd: string, requestedModelRef: string | null) {
  const { runtime, settings, profile } = await createConfiguredRuntime(cwd);
  const availableModels = await runtime.getAvailable();
  const config = commitMessageModelConfig(settings);
  const modelReference = requestedModelRef ?? config?.model;
  let selectedModel = selectAvailableDefault(settings, availableModels);

  if (modelReference !== undefined) {
    const resolved = resolveCliModel({ cliModel: modelReference, modelRuntime: runtime });
    if (resolved.error !== undefined) throw new Error(resolved.error);
    selectedModel = resolved.model;
  }

  if (selectedModel === undefined) throw new Error("No authenticated Pi model is available");
  return {
    runtime,
    profile,
    selectedModel,
    thinkingLevel: requestedModelRef === null ? config?.thinkingLevel : undefined,
  };
}

export async function getPiCommitModelOptions(
  cwd: string,
  requestedModelRef: string | null,
): Promise<{ selectedModelRef: string | null; availableModelRefs: string[] }> {
  const { runtime, settings } = await createConfiguredRuntime(cwd);
  const availableModels = await runtime.getAvailable();
  const modelReference = requestedModelRef ?? commitMessageModelConfig(settings)?.model;
  const selectedModel =
    modelReference === undefined
      ? selectAvailableDefault(settings, availableModels)
      : resolveCliModel({ cliModel: modelReference, modelRuntime: runtime }).model;

  return {
    selectedModelRef:
      selectedModel === undefined ? null : `${selectedModel.provider}/${selectedModel.id}`,
    availableModelRefs: [
      ...new Set(availableModels.map((model) => `${model.provider}/${model.id}`)),
    ],
  };
}

export async function createPiCommitModel(
  cwd: string,
  requestedModelRef: string | null,
): Promise<PiCommitModel> {
  const { runtime, profile, selectedModel, thinkingLevel } = await resolveModelSelection(
    cwd,
    requestedModelRef,
  );
  const fastRequest =
    selectedModel.provider === "openai-codex"
      ? resolveFastModelRequest(selectedModel.id)
      : undefined;
  const requestModel =
    fastRequest === undefined ? selectedModel : { ...selectedModel, id: fastRequest.modelId };
  const timeoutMs = commandTimeoutMs();

  return {
    modelRef: `${selectedModel.provider}/${selectedModel.id}`,
    profile,
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
    complete: async (prompt) => {
      const context = {
        systemPrompt: COMMIT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user" as const,
            content: [{ type: "text" as const, text: prompt }],
            timestamp: Date.now(),
          },
        ],
      };
      const options = {
        signal: AbortSignal.timeout(timeoutMs),
        cacheRetention: "none" as const,
        maxRetries: 1,
        maxTokens: MAX_RESPONSE_TOKENS,
        timeoutMs,
        sessionId: crypto.randomUUID(),
        ...(fastRequest === undefined
          ? {}
          : { samplingParams: { service_tier: fastRequest.serviceTier } }),
      };
      const response = await (async () => {
        if (thinkingLevel === undefined) {
          return runtime.complete(requestModel, context, options);
        }
        if (requestModel.api === "openai-codex-responses") {
          return runtime.complete(requestModel, context, {
            ...options,
            reasoningEffort: thinkingLevel === "off" ? "none" : thinkingLevel,
          });
        }
        if (thinkingLevel === "off") {
          return runtime.complete(requestModel, context, options);
        }
        return runtime.completeSimple(requestModel, context, {
          ...options,
          reasoning: thinkingLevel,
        });
      })();

      if (response.stopReason !== "stop") {
        const detail = response.errorMessage?.trim();
        throw new Error(
          detail === undefined || detail.length === 0
            ? `Pi commit generation stopped with ${response.stopReason}`
            : `Pi commit generation stopped with ${response.stopReason}: ${detail}`,
        );
      }

      const text = response.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (text.length === 0) throw new Error("Pi returned an empty commit response");
      return text;
    },
  };
}
