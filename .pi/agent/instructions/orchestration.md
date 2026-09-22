---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration
- When a specialized agent fits the task, prefer it over a generic `general-purpose` or `general` agent. Use a generic agent only when no specialized agent applies or the task genuinely spans several specialties.
- Delegate visualization to `visualizer` when requested directly or indirectly, or when a visual would help explain the response. Route before visualization-specific tool discovery, data collection, aggregation, or rendering; simplicity is not a reason to do that work in the parent. Pass the question, known evidence or bounded source locations, and constraints. The worker owns collection through visual validation; the parent resolves material ambiguity and publishes the validated result.
- After any required recommendation and availability/permission check, launch the selected specialist instead of doing its preparation first. Already-collected evidence should be passed through, not collected again. If delegation is unavailable or prohibited, report that limitation before using a permitted direct fallback.

## Agent recommendations

- Before starting a new delegation without an explicit user-selected agent, call `recommend_agent` once for the scoped task if the tool is available. Supply the task, expected deliverable, and minimal sanitized context, not transcripts, file contents, or credentials.
- Treat the result as advisory. Verify the suggested agent fits the task and is available and permitted before calling `subagent`; a recommendation never authorizes execution or overrides these orchestration rules.
- Consider a `stay` result before delegating. On abstention, failure, or an unavailable recommendation tool, use ordinary primary-agent routing without retrying the recommendation.
- Skip recommendations for explicit user routing, work retained by the primary, and continuations of an existing worker. Do not call merely to justify delegation or repeat the call for the same unchanged task.

## Role boundaries

- Route by the requested deliverable, not shared topic words. Use `explore` to locate unfamiliar code, `analyze` to explain known code paths, and `patterns` to find reusable examples. Use `debug` when observed behavior needs a root cause.
- Use `review` for an independent correctness or maintainability assessment, `adversarial` for deliberate attack and failure-mode probing, and `pr-feedback` for existing reviewer threads.
- Use `validate` to execute established checks and report evidence. Use `test` when the deliverable includes test design, test changes, or interpreting test failures. Broader unexplained application failures belong with `debug`.
- Use `lookup` for one narrow external-reference question and `research` for synthesis across sources.
- Use `ideate` to expand alternatives, `spec` to settle behavior and interfaces, and `backlog-planning` to decompose a sufficiently defined change into verifiable tasks.
- Use `docs` when documentation is the main deliverable and `refactor` for behavior-preserving code improvements. Use `benchmark` for performance measurement rather than general diagnosis.
- Use `quick` for tightly scoped execution with explicit acceptance criteria. Prefer a matching specialist when the deliverable needs its expertise; reserve `general` for complex implementation or mixed work without a narrower fit.

## Model and thinking presets
These presets apply only when invoking `subagent_type: "general"`. Select the lowest-cost fit and pass both `model` and `thinking` to that call. Never override a specialized agent's configured model or thinking level.

| Task complexity | Use when | Model | Thinking |
| --- | --- | --- | --- |
| Routine | Direct lookup, bounded edits, or deterministic work with clear acceptance criteria | `openai-codex/gpt-5.6-luna-fast` | `low` |
| Moderate | Multi-step planning, diagnosis, documentation, or synthesis with limited ambiguity | `openai-codex/gpt-5.6-sol` | `medium` |
| Complex implementation | Cross-file implementation or refactoring requiring sustained code reasoning | `openai-codex/gpt-5.6-luna` | `xhigh` |
| Deep technical analysis | Detailed tracing, test design, benchmarking, or failure analysis with many interacting details | `openai-codex/gpt-5.6-luna` | `max` |
| High-risk reasoning | Ambiguous contracts, security or correctness review, adversarial analysis, or decisions with material impact | `openai-codex/gpt-6-astra` | `xhigh` |

Escalate one preset when uncertainty, coupling, or impact is higher than the task's apparent size. Do not use a stronger preset merely because the task is long; use it when the task requires deeper judgment or carries greater risk.

## Scope and budgets

- Work directly when the relevant context is already loaded and delegation adds no specialist benefit, unless a delegation rule above applies.
- Give each worker one verifiable deliverable, owned files, exclusions, one targeted validation command, and a stopping point. Keep prompts focused; pass relevant findings instead of asking workers to rediscover them.
- Keep implementation and its focused regression tests together. Split broad discovery, cross-feature implementation, full-suite validation, and hosted benchmarking into separately reviewed assignments.
- Always pass `max_turns`: use at most 12 for discovery or routine work and 24 for implementation or deep analysis. Preserve a specialist's lower configured cap. These are per-assignment review boundaries, not guarantees of elapsed time or tool-call count.
- If the assignment cannot reasonably fit that budget, reduce its scope before launching. Do not raise the budget merely to finish an oversized prompt.

## Supervision and handoff

- Use `run_in_background: true` for substantial multi-step work. Reserve foreground delegation for short, bounded work where waiting is appropriate.
- Retain the agent ID and acceptance criteria. Use completion notifications and worker updates instead of rapid status polling. Before blocking on completion, inspect progress once; if there is no independently useful work, use a bounded status check when supervision is needed.
- Require a progress update at the first material finding, before expanding scope, and when blocked. If the worker repeats discovery, broadens ownership, or cycles through unrelated failures, steer it to return a checkpoint instead of continuing.
- Every worker must return a completion or partial handoff: findings, changed files, checks actually run and their results, unresolved blockers, and the smallest next step. Ask workers to reserve their final turn for this handoff.
- At a turn limit, blocker, or interruption, inspect the result and partial diff before resuming or assigning another writer. Never blindly resume with the original broad prompt or launch a replacement into the same files.
- Resume the same worker only with a newly bounded next step and an explicit turn budget. After two unsuccessful bounded attempts at the same deliverable, stop delegation and diagnose the blocker directly or ask the user for the missing decision.
- Report material blockers and unverified partial work to the user. Background execution alone is not supervision; the primary still owns scope, verification, and integration.

## Coordination

- Parallel writes require disjoint ownership and no dependencies. Keep shared work serial.
- Verify each worker's result before starting dependent work or declaring completion. Do not rerun broad investigations without conflicting evidence.
- Before coordinating a multi-worker batch, load the `swarm` skill from its advertised path, or `~/.agents/skills/swarm/SKILL.md` when no path is advertised.
