import type { AgentDefinition } from "../extensions/recommend-agent/discovery";

export interface RecommendationBenchmarkCase {
  readonly name: string;
  readonly task: string;
  readonly intent: string;
  readonly context?: string;
  readonly relevant: readonly string[];
  readonly denied?: readonly string[];
  readonly explicitSkillInvocation?: boolean;
}

export const RECOMMEND_AGENT_BENCHMARK_CATALOG: readonly AgentDefinition[] = Object.freeze(
  [
    ["analyze", "Analyze existing code and explain data flow or behavior."],
    ["explore", "Explore a repository and locate relevant files or symbols."],
    ["validate", "Validate an implementation against requirements and invariants."],
    ["test", "Design or extend tests and verify behavior."],
    ["review", "Review a change for correctness, maintainability, and regressions."],
    ["debug", "Diagnose a failing or incorrect runtime behavior."],
    ["lookup", "Look up a narrow factual or API reference question."],
    ["research", "Research a topic across references and summarize findings."],
  ].map(([id, description]) => Object.freeze({ id, description, source: "global" as const })),
);

export const RECOMMEND_AGENT_BENCHMARK_CASES: readonly RecommendationBenchmarkCase[] =
  Object.freeze([
    {
      name: "analyze-explore-boundary",
      task: "Trace how configuration moves through the existing application.",
      intent: "Explain the current behavior without changing files.",
      relevant: ["analyze"],
    },
    {
      name: "explore-analyze-boundary",
      task: "Locate the modules that implement the workspace discovery flow.",
      intent: "Return the relevant symbols and files for follow-up work.",
      relevant: ["explore"],
    },
    {
      name: "validate-test-boundary",
      task: "Check whether this implementation satisfies the stated invariants.",
      intent: "Find correctness gaps without adding a test suite.",
      relevant: ["validate"],
    },
    {
      name: "test-validate-boundary",
      task: "Add focused regression coverage for the parser behavior.",
      intent: "Write and run tests for the changed behavior.",
      relevant: ["test"],
    },
    {
      name: "review-debug-boundary",
      task: "Review this patch for regressions and maintainability problems.",
      intent: "Give a code-review assessment without implementing fixes.",
      relevant: ["review"],
    },
    {
      name: "debug-review-boundary",
      task: "Diagnose why the service fails after configuration reload.",
      intent: "Identify the likely root cause and a verification step.",
      relevant: ["debug"],
    },
    {
      name: "lookup-research-boundary",
      task: "Find the exact option name and accepted values in the API reference.",
      intent: "Answer one narrow factual documentation question.",
      relevant: ["lookup"],
    },
    {
      name: "research-lookup-boundary",
      task: "Compare the documented approaches to handling this integration.",
      intent: "Synthesize findings from several relevant references.",
      relevant: ["research"],
    },
    {
      name: "primary-stay",
      task: "Rename one local variable and adjust its nearby comment.",
      intent: "Make this small mechanical edit directly.",
      relevant: ["stay"],
    },
    {
      name: "underspecified-abstain",
      task: "Make this better.",
      intent: "Choose the right next step.",
      relevant: ["abstain"],
    },
    {
      name: "multi-task-abstain",
      task: "Investigate the bug, redesign the API, update documentation, and ship the change.",
      intent: "Coordinate several different tasks at once.",
      relevant: ["abstain"],
    },
    {
      name: "explicit-bypass",
      task: "@review inspect this change for regressions.",
      intent: "The user explicitly selected the review agent.",
      relevant: [],
      explicitSkillInvocation: true,
    },
    {
      name: "denied-review-catalog",
      task: "Review the failing runtime behavior after startup for regressions.",
      intent: "Find the root cause and a safe verification step.",
      denied: ["review"],
      relevant: ["debug"],
    },
  ]);
