import type { ClassifierContext, Usage } from "@earendil-works/pi-ai";
import { match } from "ts-pattern";
import {
  type ClassifierOptions,
  type ClassifierRegistry,
  type ClassifierRequestResult,
  requestClassifier,
} from "./classifier";

export const MAX_DISCOVERY_CLASSIFIER_CANDIDATES = 24;
const MAX_DESCRIPTION_CHARS = 180;
const MAX_QUERY_CHARS = 500;
const NO_MATCH = "no_match";

export interface DiscoveryCandidate {
  name: string;
  description: string;
}
export interface DiscoveryMatch {
  name: string;
  score: number;
}
export interface DiscoveryRankingResult {
  matches: DiscoveryMatch[];
  rankingSource: "classifier" | "lexical";
  usage?: Usage;
}
export interface DiscoveryRankingOptions extends ClassifierOptions {
  modelRegistry: ClassifierRegistry;
  enabled?: boolean;
  onUsage?: (usage: Usage) => void;
  request?: (
    registry: ClassifierRegistry,
    input: ClassifierContext,
    options: ClassifierOptions,
  ) => Promise<ClassifierRequestResult>;
}
export type ClassifierDiscoveryAttempt =
  | { ok: true; result: DiscoveryRankingResult }
  | { ok: false; usage?: Usage };

export function compactDiscoveryDescription(description: string): string {
  const summary = (description.split(/\r?\n/u, 1)[0] ?? "").replace(/\s+/gu, " ").trim();
  return summary.length <= MAX_DESCRIPTION_CHARS
    ? summary
    : `${summary.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`;
}

function candidatePool(
  candidates: readonly DiscoveryCandidate[],
  lexicalMatches: readonly DiscoveryMatch[],
): DiscoveryCandidate[] {
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  if (byName.size !== candidates.length) throw new Error("Duplicate discovery candidate names");
  const selected = new Map<string, DiscoveryCandidate>();
  for (const item of lexicalMatches) {
    const candidate = byName.get(item.name);
    if (candidate === undefined)
      throw new Error("Lexical match is outside the discovery candidate set");
    selected.set(candidate.name, candidate);
    if (selected.size === MAX_DISCOVERY_CLASSIFIER_CANDIDATES) break;
  }
  for (const candidate of [...candidates].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (selected.size === MAX_DISCOVERY_CLASSIFIER_CANDIDATES) break;
    selected.set(candidate.name, candidate);
  }
  return [...selected.values()];
}

function classifierInput(
  candidates: readonly DiscoveryCandidate[],
  query: string,
): ClassifierContext {
  const entries = candidates.map((candidate, index) => ({
    id: `candidate_${index}`,
    name: candidate.name,
    description: compactDiscoveryDescription(candidate.description),
  }));
  const criteria = Object.fromEntries(
    entries.map((candidate) => [candidate.id, `${candidate.name}: ${candidate.description}`]),
  );
  criteria[NO_MATCH] = "No candidate provides the capability requested by the query.";
  return {
    state: { query: query.slice(0, MAX_QUERY_CHARS), candidates: entries },
    questions: {
      best_tool: {
        type: "choice",
        instructions:
          "Which candidate tool best matches the requested capability? Choose no_match when none is a useful match.",
        criteria,
      },
    },
  };
}

export async function rankDiscoveryWithClassifier(
  candidates: readonly DiscoveryCandidate[],
  lexicalMatches: readonly DiscoveryMatch[],
  query: string,
  limit: number,
  options: DiscoveryRankingOptions,
): Promise<ClassifierDiscoveryAttempt> {
  options.signal?.throwIfAborted();
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Discovery limit must be a positive integer");
  const pool = candidatePool(candidates, lexicalMatches);
  if (pool.length === 0) return { ok: true, result: { matches: [], rankingSource: "lexical" } };
  const {
    modelRegistry,
    enabled: _enabled,
    request = requestClassifier,
    onUsage,
    ...requestOptions
  } = options;
  const response = await request(modelRegistry, classifierInput(pool, query), requestOptions);
  // Inference has already incurred this usage even if cancellation rejects its matches.
  if (response.usage !== undefined) onUsage?.(response.usage);
  options.signal?.throwIfAborted();
  const usage = response.usage === undefined ? {} : { usage: response.usage };
  if (!response.ok) return { ok: false, ...usage };
  return match(response.value.answers.best_tool)
    .returnType<ClassifierDiscoveryAttempt>()
    .with({ type: "choice" }, (answer) => {
      if (answer.choice === NO_MATCH) {
        return { ok: true, result: { matches: [], rankingSource: "classifier", ...usage } };
      }
      const index = pool.findIndex(
        (_candidate, position) => answer.choice === `candidate_${position}`,
      );
      const selected = pool[index];
      const probability = answer.probabilities[answer.choice];
      if (
        selected === undefined ||
        probability === undefined ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        return { ok: false, ...usage };
      }
      return {
        ok: true,
        result: {
          matches: [{ name: selected.name, score: probability }],
          rankingSource: "classifier",
          ...usage,
        },
      };
    })
    .otherwise(() => ({ ok: false, ...usage }));
}

export async function rankDiscovery(
  candidates: readonly DiscoveryCandidate[],
  lexicalMatches: readonly DiscoveryMatch[],
  query: string,
  limit: number,
  options: DiscoveryRankingOptions,
): Promise<DiscoveryRankingResult> {
  options.signal?.throwIfAborted();
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("Discovery limit must be a positive integer");
  const eligible = new Set(candidates.map((candidate) => candidate.name));
  if (eligible.size !== candidates.length) throw new Error("Duplicate discovery candidate names");
  const seen = new Set<string>();
  for (const item of lexicalMatches) {
    if (
      !eligible.has(item.name) ||
      seen.has(item.name) ||
      !Number.isFinite(item.score) ||
      item.score < 0
    ) {
      throw new Error("Invalid lexical discovery match");
    }
    seen.add(item.name);
  }
  const lexical = lexicalMatches.slice(0, limit);
  if (options.enabled === false || query.trim().length === 0 || candidates.length === 0) {
    return { matches: lexical, rankingSource: "lexical" };
  }
  const result = await rankDiscoveryWithClassifier(
    candidates,
    lexicalMatches,
    query,
    limit,
    options,
  );
  return result.ok
    ? result.result
    : {
        matches: lexical,
        rankingSource: "lexical",
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      };
}
