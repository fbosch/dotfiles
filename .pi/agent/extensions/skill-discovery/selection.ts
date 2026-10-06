import type { ClassifierAnswer, ClassifierContext, Usage } from "@earendil-works/pi-ai";
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
  type ClassifierFailure,
  type ClassifierFetch,
  type ClassifierRegistry,
  requestClassifier,
} from "../../lib/classifier";
import { fullSkillCatalog } from "../shared/skill-prompt";
import { disabledSkillNames } from "../skill-tweaks";
import {
  configuredSkillSelection,
  DEFAULT_SKILL_SELECTION_CONFIG,
  type SkillSelectionConfig,
} from "./selection-config";

export type { SkillSelectionConfig } from "./selection-config";
export { DEFAULT_SKILL_SELECTION_CONFIG, resolveSkillSelectionConfig } from "./selection-config";

const MAX_CATALOG_SKILLS = 96;
const MAX_REQUEST_CHARS = 12_000;
const MAX_DESCRIPTION_CHARS = 400;
const SKILL_RECOMMENDATIONS_START = "<skill_recommendations>";
const SKILL_RECOMMENDATIONS_SECTION = "skill_recommendations";
const NO_MATCH_QUESTION = "none_relevant";

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
      readonly kind: "classifier-failure";
      readonly provider?: ClassifierFailure["provider"];
      readonly stage: ClassifierFailure["stage"];
      readonly reason: ClassifierFailure["reason"];
      readonly httpStatus?: number;
      readonly retryAfterMs?: number;
      readonly usage?: Usage;
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
  readonly modelRegistry: ClassifierRegistry;
  readonly fetch?: ClassifierFetch;
  readonly signal?: AbortSignal;
  readonly onFetchAttempt?: () => void;
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

function relevanceQuestion(candidate: SkillCandidate): ClassifierContext["questions"][string] {
  return {
    type: "bool",
    instructions: `Is the user's request materially relevant to the skill named ${candidate.name}? ${candidate.description}`,
    criteria: {
      true: "The skill's documented workflow would help complete the request.",
      false:
        "The skill is not needed for this request, even if its topic is mentioned incidentally.",
    },
  };
}

function createQuestions(
  candidates: readonly SkillCandidate[],
): Record<string, ClassifierContext["questions"][string]> {
  return {
    ...Object.fromEntries(
      candidates.map((candidate, index) => [`skill_${index}`, relevanceQuestion(candidate)]),
    ),
    [NO_MATCH_QUESTION]: {
      type: "bool",
      instructions: "Are none of the listed skills materially relevant to the user's request?",
      criteria: {
        true: "No listed skill's documented workflow would help complete the request.",
        false: "At least one listed skill's documented workflow would help complete the request.",
      },
    },
  };
}

export function createSkillSelectionRequest(
  prompt: string,
  candidates: readonly SkillCandidate[],
): ClassifierContext | undefined {
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

function usageFromClassifier(usage: Usage | undefined): SkillSelectionUsage | undefined {
  if (usage === undefined) return undefined;
  return { inputTokens: usage.input, outputTokens: usage.output };
}

export function parseSkillSelectionResponse(
  answers: Record<string, ClassifierAnswer>,
  candidates: readonly SkillCandidate[],
  config: Pick<
    SkillSelectionConfig,
    "threshold" | "maxRecommendations"
  > = DEFAULT_SKILL_SELECTION_CONFIG,
): SkillSelectionResult | undefined {
  const expectedIds = [
    ...candidates.map((_candidate, index) => `skill_${index}`),
    NO_MATCH_QUESTION,
  ];
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
    if (answer?.type !== "bool") return undefined;
    const score = answer.probability;
    if (typeof score !== "number" || Number.isFinite(score) === false || score < 0 || score > 1) {
      return undefined;
    }
    scores.set(candidate.name, score);
  }

  const noMatchAnswer = answers[NO_MATCH_QUESTION];
  if (noMatchAnswer?.type !== "bool") return undefined;
  const noMatchScore = noMatchAnswer.probability;
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

  return { recommendations, scores };
}

export function parseSkillSelectionResponseDetailed(
  answers: Record<string, ClassifierAnswer>,
  candidates: readonly SkillCandidate[],
  config: Pick<
    SkillSelectionConfig,
    "threshold" | "maxRecommendations"
  > = DEFAULT_SKILL_SELECTION_CONFIG,
): SkillSelectionAttempt {
  const result = parseSkillSelectionResponse(answers, candidates, config);
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

export async function selectSkillsWithClassifierDetailed(
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

  const classifier = await requestClassifier(options.modelRegistry, request, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onFetchAttempt === undefined ? {} : { onFetchAttempt: options.onFetchAttempt }),
    timeoutMs: config.timeoutMs,
  });
  if (!classifier.ok) {
    return {
      ok: false,
      failure: {
        kind: "classifier-failure",
        ...(classifier.provider === undefined ? {} : { provider: classifier.provider }),
        stage: classifier.stage,
        reason: classifier.reason,
        ...(classifier.httpStatus === undefined ? {} : { httpStatus: classifier.httpStatus }),
        ...(classifier.retryAfterMs === undefined ? {} : { retryAfterMs: classifier.retryAfterMs }),
        ...(classifier.usage === undefined ? {} : { usage: classifier.usage }),
      },
    };
  }

  const result = parseSkillSelectionResponse(
    classifier.value.answers,
    normalizedCandidates,
    config,
  );
  if (result === undefined) {
    return {
      ok: false,
      failure: {
        kind: "invalid-evaluation-response",
        stage: "evaluation",
        reason: "invalid-evaluation-response",
      },
    };
  }
  const usage = usageFromClassifier(classifier.usage);
  return { ok: true, value: usage === undefined ? result : { ...result, usage } };
}

export async function selectSkillsWithClassifier(
  prompt: string,
  candidates: readonly SkillCandidate[],
  config: Pick<SkillSelectionConfig, "threshold" | "maxRecommendations" | "timeoutMs">,
  options: SkillSelectionRequestOptions,
): Promise<SkillSelectionResult | undefined> {
  const attempt = await selectSkillsWithClassifierDetailed(prompt, candidates, config, options);
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
  skills: readonly Skill[],
): string {
  if (recommendations.length === 0) return "";

  const paths = new Map(skills.map((skill) => [skill.name, skill.filePath]));
  const lines = recommendations.map(({ name }) => {
    const path = paths.get(name);
    if (path === undefined) throw new Error(`Recommendation has no discovered skill path: ${name}`);
    return `  <skill name="${escapeXml(name)}" location="${escapeXml(path)}" />`;
  });
  return [
    "These are advisory recommendations, not skill loads or new mandatory rules.",
    ...lines,
    "Read the listed SKILL.md before following a skill. Keep the complete skill catalog and all existing instructions authoritative.",
  ].join("\n");
}

function disabledNamesForContext(
  context: ExtensionContext,
  systemPrompt: string,
  _skills: readonly Skill[],
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

export interface SkillSelectionStatus {
  readonly enabled: boolean;
  readonly eventCount: number;
  readonly state: "idle" | "skipped" | "evaluating" | "completed" | "failed" | "cancelled";
  readonly reason?: string;
  readonly candidateCount?: number;
  readonly elapsedMs?: number;
  readonly fetchAttempted: boolean;
  readonly failureProvider?: ClassifierFailure["provider"];
  readonly failureStage?: ClassifierFailure["stage"] | "evaluation";
  readonly httpStatus?: number;
}

interface SkillSelectionExtensionDependencies {
  selectSkillsDetailed?: typeof selectSkillsWithClassifierDetailed;
  getConfig?: (context: ExtensionContext) => SkillSelectionConfig;
  getDisabledNames?: (
    context: ExtensionContext,
    systemPrompt: string,
    skills: readonly Skill[],
  ) => ReadonlySet<string>;
  fetch?: ClassifierFetch;
  now?: () => number;
}

export function createSkillSelectionExtension(
  dependencies: SkillSelectionExtensionDependencies = {},
): (pi: ExtensionAPI) => void {
  const selectSkillsDetailed =
    dependencies.selectSkillsDetailed ?? selectSkillsWithClassifierDetailed;
  const getConfig = dependencies.getConfig ?? configuredSkillSelection;
  const getDisabledNames = dependencies.getDisabledNames ?? disabledNamesForContext;
  const now = dependencies.now ?? Date.now;
  let status: SkillSelectionStatus = {
    enabled: false,
    eventCount: 0,
    state: "idle",
    fetchAttempted: false,
  };

  return (pi) => {
    pi.registerCommand("classifier-status", {
      description: "Show the latest advisory skill-selection lifecycle status",
      handler: async (_args, context) => {
        context.ui.notify(JSON.stringify(status), "info");
      },
    });

    pi.on("before_agent_start", async (event: BeforeAgentStartEvent, context) => {
      const eventCount = status.eventCount + 1;
      const skip = (reason: string, enabled = status.enabled) => {
        status = { enabled, eventCount, state: "skipped", reason, fetchAttempted: false };
      };

      if (event.images !== undefined && event.images.length > 0) return skip("images");
      if (isExplicitSkillInvocation(event.prompt)) return skip("explicit-skill");
      if (event.systemPrompt.includes(SKILL_RECOMMENDATIONS_START)) {
        return skip("recommendation-marker");
      }

      const skills = fullSkillCatalog(pi.events, event.systemPromptOptions);
      let config: SkillSelectionConfig;
      let disabledNames: ReadonlySet<string>;
      try {
        config = getConfig(context);
        if (!config.enabled) return skip("disabled", false);
        disabledNames = getDisabledNames(context, event.systemPrompt, skills);
      } catch {
        return skip("config-error", false);
      }

      const candidates = eligibleSkillCandidates(skills, disabledNames);
      if (candidates.length === 0) return skip("no-candidates", true);
      if (candidates.length > MAX_CATALOG_SKILLS) return skip("too-many-candidates", true);

      const startedAt = now();
      let fetchAttempted = false;
      status = {
        enabled: true,
        eventCount,
        state: "evaluating",
        candidateCount: candidates.length,
        fetchAttempted,
      };
      try {
        const selectionOptions: SkillSelectionRequestOptions = {
          modelRegistry: context.modelRegistry,
          ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
          ...(context.signal === undefined ? {} : { signal: context.signal }),
          onFetchAttempt: () => {
            fetchAttempted = true;
            status = { ...status, fetchAttempted: true };
          },
        };
        const attempt = await selectSkillsDetailed(
          event.prompt,
          candidates,
          config,
          selectionOptions,
        );
        const elapsedMs = Math.max(0, now() - startedAt);
        if (context.signal?.aborted) {
          status = {
            enabled: true,
            eventCount,
            state: "cancelled",
            reason: "caller-cancellation",
            candidateCount: candidates.length,
            elapsedMs,
            fetchAttempted,
          };
          return;
        }
        if (!attempt.ok) {
          status = {
            enabled: true,
            eventCount,
            state: attempt.failure.reason === "caller-cancellation" ? "cancelled" : "failed",
            reason: attempt.failure.reason,
            candidateCount: candidates.length,
            elapsedMs,
            fetchAttempted,
            ...(attempt.failure.kind === "classifier-failure" &&
            attempt.failure.provider !== undefined
              ? { failureProvider: attempt.failure.provider }
              : {}),
            failureStage: attempt.failure.stage,
            ...(attempt.failure.kind === "classifier-failure" &&
            attempt.failure.httpStatus !== undefined
              ? { httpStatus: attempt.failure.httpStatus }
              : {}),
          };
          return;
        }

        const result = attempt.value;
        status = {
          enabled: true,
          eventCount,
          state: "completed",
          reason: result.recommendations.length === 0 ? "no-match" : "recommendations",
          candidateCount: candidates.length,
          elapsedMs,
          fetchAttempted,
        };
        if (result.recommendations.length === 0) return;
        event.systemPromptOptions.sections[SKILL_RECOMMENDATIONS_SECTION] =
          formatSkillRecommendations(result.recommendations, skills);
      } catch {
        status = {
          enabled: true,
          eventCount,
          state: "failed",
          reason: "unexpected-error",
          candidateCount: candidates.length,
          elapsedMs: Math.max(0, now() - startedAt),
          fetchAttempted,
        };
        // Advisory selection must never change the default skill behavior when Classifier is unavailable.
        return;
      }
    });
  };
}
