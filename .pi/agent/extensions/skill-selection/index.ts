import {
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  parseSkillBlock,
  SettingsManager,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  requestVercelGateway,
  type VercelGatewayFailure,
  type VercelGatewayFetch,
  type VercelGatewayStage,
} from "../../lib/vercel-gateway";
import { isRecord } from "../shared/is-record";
import { disabledSkillNames } from "../skill-tweaks";

const DEFAULT_THRESHOLD = 0.72;
const DEFAULT_TIMEOUT_MS = 600;
const DEFAULT_MAX_RECOMMENDATIONS = 3;
const MAX_TIMEOUT_MS = 2_000;
const MAX_RECOMMENDATIONS = 5;
const MAX_CATALOG_SKILLS = 96;
const MAX_REQUEST_CHARS = 12_000;
const MAX_DESCRIPTION_CHARS = 400;
const SKILL_RECOMMENDATIONS_START = "<skill_recommendations>";
const SKILL_RECOMMENDATIONS_END = "</skill_recommendations>";
const NO_MATCH_QUESTION = "none_relevant";

export interface SkillSelectionConfig {
  readonly enabled: boolean;
  readonly threshold: number;
  readonly timeoutMs: number;
  readonly maxRecommendations: number;
}

export const DEFAULT_SKILL_SELECTION_CONFIG: SkillSelectionConfig = {
  enabled: false,
  // Experimental starting point, not a calibrated production threshold.
  threshold: DEFAULT_THRESHOLD,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxRecommendations: DEFAULT_MAX_RECOMMENDATIONS,
};

export interface SkillCandidate {
  readonly name: string;
  readonly description: string;
}

export interface SkillRecommendation {
  readonly name: string;
  readonly score: number;
}

export interface SkillSelectionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface SkillSelectionResult {
  readonly recommendations: readonly SkillRecommendation[];
  readonly scores: ReadonlyMap<string, number>;
  readonly usage?: SkillSelectionUsage;
}

export type SkillSelectionFailure =
  | {
      readonly kind: "gateway-failure";
      readonly stage: VercelGatewayStage;
      readonly reason: VercelGatewayFailure["reason"];
      readonly httpStatus?: number;
    }
  | {
      readonly kind: "invalid-evaluation-response";
      readonly stage: "evaluation";
      readonly reason: "invalid-evaluation-response";
    };

export type SkillSelectionAttempt =
  | { readonly ok: true; readonly value: SkillSelectionResult }
  | { readonly ok: false; readonly failure: SkillSelectionFailure };

export interface SkillSelectionRequestOptions {
  readonly modelRegistry: Pick<ExtensionContext["modelRegistry"], "getProviderAuth">;
  readonly fetch?: VercelGatewayFetch;
  readonly signal?: AbortSignal;
}

type SkillSelectionSection = Record<string, unknown> | null | undefined;

function settingSection(settings: unknown): SkillSelectionSection {
  if (isRecord(settings) === false) return undefined;
  const section = settings.skillSelection;
  if (section === undefined || isRecord(section)) return section;
  return null;
}

function invalidConfig(): SkillSelectionConfig {
  return { ...DEFAULT_SKILL_SELECTION_CONFIG, enabled: false };
}

function readConfigSection(
  section: SkillSelectionSection,
  current: SkillSelectionConfig,
): SkillSelectionConfig {
  if (section === undefined) return current;
  if (section === null) return invalidConfig();
  const unknownFields = Object.keys(section).filter(
    (field) => !["enabled", "threshold", "timeoutMs", "maxRecommendations"].includes(field),
  );
  if (unknownFields.length > 0) return invalidConfig();

  const enabled = section.enabled ?? current.enabled;
  const threshold = section.threshold ?? current.threshold;
  const timeoutMs = section.timeoutMs ?? current.timeoutMs;
  const maxRecommendations = section.maxRecommendations ?? current.maxRecommendations;

  if (
    typeof enabled !== "boolean" ||
    typeof threshold !== "number" ||
    Number.isFinite(threshold) === false ||
    threshold < 0 ||
    threshold > 1 ||
    typeof timeoutMs !== "number" ||
    Number.isInteger(timeoutMs) === false ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS ||
    typeof maxRecommendations !== "number" ||
    Number.isInteger(maxRecommendations) === false ||
    maxRecommendations < 1 ||
    maxRecommendations > MAX_RECOMMENDATIONS
  ) {
    return invalidConfig();
  }

  return { enabled, threshold, timeoutMs, maxRecommendations };
}

export function resolveSkillSelectionConfig(
  globalSettings: unknown,
  projectSettings: unknown,
): SkillSelectionConfig {
  const global = readConfigSection(settingSection(globalSettings), DEFAULT_SKILL_SELECTION_CONFIG);
  return readConfigSection(settingSection(projectSettings), global);
}

function configuredSkillSelection(
  context: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
): SkillSelectionConfig {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return resolveSkillSelectionConfig(settings.getGlobalSettings(), settings.getProjectSettings());
}

function compactDescription(description: string): string {
  const compacted = description.replace(/\s+/g, " ").trim();
  if (compacted.length <= MAX_DESCRIPTION_CHARS) return compacted;
  return `${compacted.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeCandidates(candidates: readonly SkillCandidate[]): SkillCandidate[] {
  const normalized = [...candidates].sort((left, right) => compareNames(left.name, right.name));
  return normalized.some((candidate, index) => candidate.name === normalized[index - 1]?.name)
    ? []
    : normalized;
}

export function eligibleSkillCandidates(
  skills: readonly Skill[] | undefined,
  disabledNames: ReadonlySet<string>,
): SkillCandidate[] {
  if (skills === undefined) return [];

  return normalizeCandidates(
    skills
      .filter((skill) => skill.disableModelInvocation === false && !disabledNames.has(skill.name))
      .map((skill) => ({ name: skill.name, description: compactDescription(skill.description) })),
  );
}

function relevanceQuestion(candidate: SkillCandidate): Record<string, unknown> {
  return {
    type: "noul",
    instructions: `Is the user's request materially relevant to the skill named ${candidate.name}? ${candidate.description}`,
    criteria: {
      yes: "The skill's documented workflow would help complete the request.",
      no: "The skill is not needed for this request, even if its topic is mentioned incidentally.",
    },
  };
}

function createQuestions(candidates: readonly SkillCandidate[]): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      candidates.map((candidate, index) => [`skill_${index}`, relevanceQuestion(candidate)]),
    ),
    [NO_MATCH_QUESTION]: {
      type: "noul",
      instructions: "Are none of the listed skills materially relevant to the user's request?",
      criteria: {
        yes: "No listed skill's documented workflow would help complete the request.",
        no: "At least one listed skill's documented workflow would help complete the request.",
      },
    },
  };
}

export function createSkillSelectionRequest(
  prompt: string,
  candidates: readonly SkillCandidate[],
): Record<string, unknown> | undefined {
  const request = prompt.trim();
  const normalizedCandidates = normalizeCandidates(candidates);
  if (request.length === 0 || request.length > MAX_REQUEST_CHARS) return undefined;
  if (normalizedCandidates.length === 0 || normalizedCandidates.length > MAX_CATALOG_SKILLS) {
    return undefined;
  }

  return {
    state: {
      request,
      skills: normalizedCandidates.map((candidate, index) => ({
        id: `skill_${index}`,
        name: candidate.name,
        description: candidate.description,
      })),
    },
    questions: createQuestions(normalizedCandidates),
  };
}

function usageFromResponse(value: Record<string, unknown>): SkillSelectionUsage | null | undefined {
  const usage = value.usage;
  if (usage === undefined) return undefined;
  if (!isRecord(usage)) return null;

  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (
    (inputTokens !== undefined &&
      (typeof inputTokens !== "number" ||
        Number.isInteger(inputTokens) === false ||
        inputTokens < 0)) ||
    (outputTokens !== undefined &&
      (typeof outputTokens !== "number" ||
        Number.isInteger(outputTokens) === false ||
        outputTokens < 0))
  ) {
    return null;
  }

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
}

export function parseSkillSelectionResponse(
  value: unknown,
  candidates: readonly SkillCandidate[],
  config: Pick<
    SkillSelectionConfig,
    "threshold" | "maxRecommendations"
  > = DEFAULT_SKILL_SELECTION_CONFIG,
): SkillSelectionResult | undefined {
  if (!isRecord(value) || !isRecord(value.answers)) return undefined;

  const expectedIds = [
    ...candidates.map((_candidate, index) => `skill_${index}`),
    NO_MATCH_QUESTION,
  ];
  const answers = value.answers;
  const answerIds = Object.keys(answers);
  if (
    answerIds.length !== expectedIds.length ||
    answerIds.some((id) => expectedIds.includes(id) === false)
  ) {
    return undefined;
  }

  const scores = new Map<string, number>();
  for (const [index, candidate] of candidates.entries()) {
    const answer = answers[`skill_${index}`];
    if (!isRecord(answer) || answer.type !== "noul") return undefined;
    const score = answer.noul;
    if (typeof score !== "number" || Number.isFinite(score) === false || score < 0 || score > 1) {
      return undefined;
    }
    scores.set(candidate.name, score);
  }

  const noMatchAnswer = answers[NO_MATCH_QUESTION];
  if (!isRecord(noMatchAnswer) || noMatchAnswer.type !== "noul") return undefined;
  const noMatchScore = noMatchAnswer.noul;
  if (
    typeof noMatchScore !== "number" ||
    Number.isFinite(noMatchScore) === false ||
    noMatchScore < 0 ||
    noMatchScore > 1
  ) {
    return undefined;
  }

  const recommendations =
    noMatchScore >= config.threshold
      ? []
      : candidates
          .map((candidate) => ({ name: candidate.name, score: scores.get(candidate.name) ?? 0 }))
          .filter(({ score }) => score >= config.threshold)
          .sort((left, right) => right.score - left.score || compareNames(left.name, right.name))
          .slice(0, config.maxRecommendations);

  const usage = usageFromResponse(value);
  if (usage === null) return undefined;
  return usage === undefined ? { recommendations, scores } : { recommendations, scores, usage };
}

export function parseSkillSelectionResponseDetailed(
  value: unknown,
  candidates: readonly SkillCandidate[],
  config: Pick<
    SkillSelectionConfig,
    "threshold" | "maxRecommendations"
  > = DEFAULT_SKILL_SELECTION_CONFIG,
): SkillSelectionAttempt {
  const result = parseSkillSelectionResponse(value, candidates, config);
  return result === undefined
    ? {
        ok: false,
        failure: {
          kind: "invalid-evaluation-response",
          stage: "evaluation",
          reason: "invalid-evaluation-response",
        },
      }
    : { ok: true, value: result };
}

export async function selectSkillsWithJevDetailed(
  prompt: string,
  candidates: readonly SkillCandidate[],
  config: Pick<SkillSelectionConfig, "threshold" | "maxRecommendations" | "timeoutMs">,
  options: SkillSelectionRequestOptions,
): Promise<SkillSelectionAttempt> {
  const normalizedCandidates = normalizeCandidates(candidates);
  const request = createSkillSelectionRequest(prompt, normalizedCandidates);
  if (request === undefined) {
    return {
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    };
  }

  const gateway = await requestVercelGateway(options.modelRegistry, request, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    timeoutMs: config.timeoutMs,
  });
  if (!gateway.ok) {
    return {
      ok: false,
      failure: {
        kind: "gateway-failure",
        stage: gateway.stage,
        reason: gateway.reason,
        ...(gateway.httpStatus === undefined ? {} : { httpStatus: gateway.httpStatus }),
      },
    };
  }

  return parseSkillSelectionResponseDetailed(gateway.value, normalizedCandidates, config);
}

export async function selectSkillsWithJev(
  prompt: string,
  candidates: readonly SkillCandidate[],
  config: Pick<SkillSelectionConfig, "threshold" | "maxRecommendations" | "timeoutMs">,
  options: SkillSelectionRequestOptions,
): Promise<SkillSelectionResult | undefined> {
  const attempt = await selectSkillsWithJevDetailed(prompt, candidates, config, options);
  return attempt.ok ? attempt.value : undefined;
}

function isExplicitSkillInvocation(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed.startsWith("/skill:") || parseSkillBlock(trimmed) !== null;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

export function formatSkillRecommendations(
  recommendations: readonly SkillRecommendation[],
): string {
  if (recommendations.length === 0) return "";

  const lines = recommendations.map(
    ({ name, score }) => `  <skill name="${escapeXml(name)}" relevance="${score.toFixed(2)}" />`,
  );
  return [
    SKILL_RECOMMENDATIONS_START,
    "These are advisory hints for this request, not skill loads or new mandatory rules.",
    ...lines,
    "Keep the complete skill catalog and all existing instructions authoritative. Use your own judgment before loading any skill.",
    SKILL_RECOMMENDATIONS_END,
  ].join("\n");
}

function appendSkillRecommendations(
  systemPrompt: string,
  recommendations: readonly SkillRecommendation[],
): string {
  const block = formatSkillRecommendations(recommendations);
  return block.length === 0 ? systemPrompt : `${systemPrompt}\n\n${block}`;
}

function disabledNamesForContext(
  context: ExtensionContext,
  systemPrompt: string,
): ReadonlySet<string> {
  const settings = SettingsManager.create(context.cwd, getAgentDir(), {
    projectTrusted: context.isProjectTrusted(),
  });
  return disabledSkillNames(
    settings.getGlobalSettings(),
    settings.getProjectSettings(),
    systemPrompt,
  );
}

interface SkillSelectionExtensionDependencies {
  selectSkills?: typeof selectSkillsWithJev;
  getConfig?: (context: ExtensionContext) => SkillSelectionConfig;
  getDisabledNames?: (context: ExtensionContext, systemPrompt: string) => ReadonlySet<string>;
}

export function createSkillSelectionExtension(
  dependencies: SkillSelectionExtensionDependencies = {},
): (pi: ExtensionAPI) => void {
  const selectSkills = dependencies.selectSkills ?? selectSkillsWithJev;
  const getConfig = dependencies.getConfig ?? configuredSkillSelection;
  const getDisabledNames = dependencies.getDisabledNames ?? disabledNamesForContext;

  return (pi) => {
    pi.on("before_agent_start", async (event: BeforeAgentStartEvent, context) => {
      if (event.images !== undefined && event.images.length > 0) return;
      if (isExplicitSkillInvocation(event.prompt)) return;
      if (event.systemPrompt.includes(SKILL_RECOMMENDATIONS_START)) return;

      let config: SkillSelectionConfig;
      let disabledNames: ReadonlySet<string>;
      try {
        config = getConfig(context);
        if (!config.enabled) return;
        disabledNames = getDisabledNames(context, event.systemPrompt);
      } catch {
        return;
      }

      const candidates = eligibleSkillCandidates(event.systemPromptOptions.skills, disabledNames);
      if (candidates.length === 0 || candidates.length > MAX_CATALOG_SKILLS) return;

      try {
        const selectionOptions: SkillSelectionRequestOptions =
          context.signal === undefined
            ? { modelRegistry: context.modelRegistry }
            : { modelRegistry: context.modelRegistry, signal: context.signal };
        const result = await selectSkills(event.prompt, candidates, config, selectionOptions);
        if (context.signal?.aborted || result === undefined || result.recommendations.length === 0)
          return;

        return {
          systemPrompt: appendSkillRecommendations(event.systemPrompt, result.recommendations),
        };
      } catch {
        // Advisory selection must never change the default skill behavior when Jev is unavailable.
        return;
      }
    });
  };
}

export default createSkillSelectionExtension();
