import type { Usage } from "@earendil-works/pi-ai";
import { match } from "ts-pattern";
import {
  type ClassifierOptions,
  type ClassifierRegistry,
  createClassifierRequester,
  loadClassifierPreferences,
} from "../../lib/classifier";
import type { BudgetAdviceInput, BudgetAdvisor, BudgetFailureReason, BudgetUsage } from "./budget";

type BudgetClassifierRegistry = Partial<ClassifierRegistry> & {
  getProviderAuthStatus?: (provider: string) => { configured: boolean } | undefined;
};
interface BudgetAdvisorOptions extends Pick<ClassifierOptions, "fetch" | "settingsContext"> {
  readonly agentDirectory?: string;
}

function safeState(input: BudgetAdviceInput) {
  const progress = {
    completedTools: input.progress.completedTools,
    verifiedSuccesses: input.progress.verifiedSuccesses,
    failures: input.progress.failures,
    unknownOutcomes: input.progress.unknownOutcomes,
    consecutiveFailures: input.progress.consecutiveFailures,
  };
  const state = {
    taskKind: input.taskKind,
    initialTurns: input.initialTurns,
    grantedTurns: input.grantedTurns,
    hardMaxTurns: input.hardMaxTurns,
    turnsUsed: input.turnsUsed,
    automaticGrants: input.automaticGrants,
    progress,
  };
  const counts = [
    state.initialTurns,
    state.grantedTurns,
    state.hardMaxTurns,
    state.turnsUsed,
    state.automaticGrants,
    ...Object.values(progress),
  ];
  if (
    !["discovery", "implementation", "analysis", "testing", "benchmark", "other"].includes(
      state.taskKind,
    ) ||
    counts.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    state.initialTurns < 1 ||
    state.turnsUsed < 1 ||
    state.initialTurns > state.grantedTurns ||
    state.grantedTurns > state.hardMaxTurns ||
    state.turnsUsed > state.grantedTurns ||
    progress.completedTools !==
      progress.verifiedSuccesses + progress.failures + progress.unknownOutcomes ||
    progress.consecutiveFailures > progress.failures
  )
    return undefined;
  return state;
}

function diagnostic(reason: BudgetFailureReason): boolean {
  return match(reason)
    .with(
      "disabled",
      "model-unavailable",
      "caller-cancellation",
      "timeout",
      "unsupported",
      () => false,
    )
    .with(
      "invalid-config",
      "invalid-input",
      "auth-failure",
      "request-failure",
      "http-status",
      "invalid-response",
      () => true,
    )
    .exhaustive();
}

function usageSummary(
  attempts: number,
  provider: string | undefined,
  usages: readonly Usage[],
): BudgetUsage {
  const base = { providerAttempts: attempts, ...(provider === undefined ? {} : { provider }) };
  // Incomplete provider accounting is unknown, not an invented total or a zero-cost request.
  if (attempts === 0 || usages.length !== attempts) return base;
  const inputTokens = usages.reduce((sum, usage) => sum + usage.input, 0);
  const outputTokens = usages.reduce((sum, usage) => sum + usage.output, 0);
  const cost = usages.reduce((sum, usage) => sum + usage.cost.total, 0);
  return {
    ...base,
    ...(Number.isSafeInteger(inputTokens) && inputTokens >= 0 ? { inputTokens } : {}),
    ...(Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? { outputTokens } : {}),
    ...(Number.isFinite(cost) && cost >= 0 ? { cost } : {}),
  };
}

/** Setup is inert; only an eligible assignment checkpoint may inspect capability or request advice. */
export function createBudgetAdvisor(
  registry: BudgetClassifierRegistry | null | undefined,
  options: BudgetAdvisorOptions = {},
): BudgetAdvisor {
  const request = createClassifierRequester(Date.now, options.agentDirectory);
  return async (input, signal) => {
    if (signal.aborted) return { kind: "unavailable", reason: "caller-cancellation" };
    const state = safeState(input);
    if (!state) return { kind: "unavailable", reason: "invalid-input", diagnostic: true };
    if (
      registry === undefined ||
      registry === null ||
      typeof registry.findOfType !== "function" ||
      typeof registry.classify !== "function" ||
      typeof registry.getProviderAuthStatus !== "function"
    )
      return { kind: "unavailable", reason: "unsupported" };
    const classify = registry.classify.bind(registry);
    const preferences = loadClassifierPreferences(options.agentDirectory);
    if (!preferences) return { kind: "unavailable", reason: "invalid-config", diagnostic: true };
    try {
      const ready = preferences.some(
        ({ provider, model }) =>
          registry.getProviderAuthStatus?.(provider)?.configured === true &&
          registry.findOfType?.("classifier", provider, model)?.input.includes("text"),
      );
      if (!ready) return { kind: "unavailable", reason: "model-unavailable" };
    } catch {
      return { kind: "unavailable", reason: "model-unavailable", diagnostic: true };
    }
    let attempts = 0;
    let provider: string | undefined;
    const usages: Usage[] = [];
    const native: ClassifierRegistry = {
      findOfType: registry.findOfType.bind(registry),
      classify: async (model, context, requestOptions) => {
        attempts++;
        provider = model.provider;
        const result = await classify(model, context, requestOptions);
        if (result.usage !== undefined) usages.push(result.usage);
        return result;
      },
    };
    const result = await request(
      native,
      {
        state,
        questions: {
          continueBudget: {
            type: "bool",
            instructions:
              "Is one more bounded turn increment likely to produce useful, verifiable progress? Judge only these execution counters and the coarse task category. Tool success is not proof of assignment completion. Unknown outcomes are not verified successes.",
            criteria: {
              true: "Measured execution progress supports trying one small increment within the existing ceiling, without repeated failures or stalled execution.",
              false:
                "The counters do not support another increment, including repeated failures, unknown outcomes, or insufficient evidence of progress.",
            },
          },
        },
      },
      {
        signal,
        ...(options.settingsContext === undefined
          ? {}
          : { settingsContext: options.settingsContext }),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      },
    );
    const usage = usageSummary(attempts, provider, usages);
    if (!result.ok)
      return {
        kind: "unavailable",
        reason: result.reason,
        diagnostic: diagnostic(result.reason),
        usage,
      };
    const answer = result.value.answers.continueBudget;
    if (answer?.type !== "bool")
      return {
        kind: "unavailable",
        reason: "invalid-response",
        diagnostic: true,
        usage,
      };
    return { kind: "judgment", probability: answer.probability, usage };
  };
}
