import { join } from "node:path";
import {
  getAgentDir,
  ModelRuntime,
  ProjectTrustStore,
  resolveCliModel,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { authPathFor, resolveProfile } from "../../extensions/auth-profiles";
import { resolveFastModelRequest } from "../../extensions/openai-fast";
import { COMMIT_SYSTEM_PROMPT, type CompleteCommitPrompt } from "./generate";

const DEFAULT_TIMEOUT_MS = 60_000;
const MINIMUM_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_TOKENS = 256;

export interface PiCommitModel {
  complete: CompleteCommitPrompt;
  modelRef: string;
  profile: string;
}

function commandTimeoutMs(): number {
  const raw = process.env.AI_COMMIT_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < MINIMUM_TIMEOUT_MS ? DEFAULT_TIMEOUT_MS : parsed;
}

function projectIsTrusted(cwd: string, agentDir: string): boolean {
  const trustDecision = new ProjectTrustStore(agentDir).get(cwd);
  if (trustDecision !== null) return trustDecision;

  const globalSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  return globalSettings.getDefaultProjectTrust() === "always";
}

export async function createPiCommitModel(
  cwd: string,
  requestedModelRef: string | null,
): Promise<PiCommitModel> {
  const agentDir = getAgentDir();
  const trusted = projectIsTrusted(cwd, agentDir);
  const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: trusted });
  const { profile } = resolveProfile(
    {
      cwd,
      isProjectTrusted: () => trusted,
    },
    agentDir,
  );
  const runtime = await ModelRuntime.create({
    authPath: authPathFor(profile, agentDir),
    modelsPath: join(agentDir, "models.json"),
  });

  const defaultProvider = settings.getDefaultProvider();
  const defaultModel = settings.getDefaultModel();
  const modelReference =
    requestedModelRef ??
    (defaultProvider !== undefined && defaultModel !== undefined
      ? `${defaultProvider}/${defaultModel}`
      : undefined);

  const resolved = resolveCliModel({
    ...(modelReference === undefined ? {} : { cliModel: modelReference }),
    modelRuntime: runtime,
  });
  let model = resolved.model;
  if (resolved.error !== undefined) throw new Error(resolved.error);

  if (model === undefined) {
    model = (await runtime.getAvailable())[0];
  }
  if (model === undefined) throw new Error("No authenticated Pi model is available");

  const selectedModel = model;
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
    complete: async (prompt) => {
      const response = await runtime.complete(
        requestModel,
        {
          systemPrompt: COMMIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }],
              timestamp: Date.now(),
            },
          ],
        },
        {
          signal: AbortSignal.timeout(timeoutMs),
          cacheRetention: "none",
          maxRetries: 1,
          maxTokens: MAX_RESPONSE_TOKENS,
          timeoutMs,
          sessionId: crypto.randomUUID(),
          ...(fastRequest === undefined
            ? {}
            : { samplingParams: { service_tier: fastRequest.serviceTier } }),
        },
      );

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
