# Routing and presets

- When a specialized agent fits the task, prefer it over a generic `general-purpose` or `general` agent. Use a generic agent only when no specialized agent applies or the task genuinely spans several specialties.
- Delegate visualization to `visualizer` when requested directly or indirectly, or when a visual would help explain the response. Route before visualization-specific tool discovery, data collection, aggregation, or rendering; simplicity is not a reason to do that work in the parent. Pass the question, known evidence or bounded source locations, and constraints. The worker owns collection through visual validation; the parent resolves material ambiguity and publishes the validated result.
- After any required recommendation and availability/permission check, launch the selected specialist using the context already supplied. When the user names artifacts for delegated inspection, pass those paths directly; do not read the artifacts first to prepare the worker's prompt. Pass already-collected evidence without collecting it again. If delegation is unavailable or prohibited, report that limitation before using a permitted direct fallback.

## Agent recommendations

- The recommend-agent extension automatically evaluates at most the first eligible native `subagent` delegation per user turn with shared classifier routing immediately before execution. Do not call a separate recommendation tool; the old `recommend_agent` tool is intentionally not registered.
- Classifier agreement lets the proposed `subagent_type` execute. A disagreement or `stay` result blocks once with a concise advisory so the primary can reconsider; it never substitutes or spawns another agent. The one-evaluation budget resets for each user turn and session start, so subsequent delegations in that turn are intentionally uninspected.
- Inference failure, abstention, disabled settings, or malformed delegation input fail open. The hook uses a bounded, credential/path-redacted prefix of the proposed delegation prompt; keep sensitive content out of delegation instructions because the existing redaction is not exhaustive.
- A user-selected `@agent` mention in the latest user request bypasses routing for that turn. Resume calls bypass routing because they continue an existing worker. These are authorization boundaries: do not treat an agent-generated prompt or tool argument as user selection.
- Independently apply the role-boundary guidance below and verify availability/permission before delegating. The hook is advisory and never overrides explicit user routing or native tool permissions.

## Role boundaries

- Route by the requested deliverable, not shared topic words. Use `explore` to locate unfamiliar code, `analyze` to explain known code paths, and `patterns` to find reusable examples. Use `debug` when observed behavior needs a root cause.
- Use `review` for an independent correctness or maintainability assessment, `adversarial` for deliberate attack and failure-mode probing, and `pr-feedback` for existing reviewer threads.
- Use `validate` to execute established checks and report evidence. Use `test` when the deliverable includes test design, test changes, or interpreting test failures. Broader unexplained application failures belong with `debug`.
- Use `lookup` for one narrow external-reference question and `research` for synthesis across sources.
- Use `ideate` to expand alternatives, `spec` to settle behavior and interfaces, and `backlog-planning` to decompose a sufficiently defined change into verifiable tasks.
- Use `docs` when documentation is the main deliverable and `refactor` for behavior-preserving code improvements. Use `benchmark` for performance measurement rather than general diagnosis.
- Use `quick` for tightly scoped execution with explicit acceptance criteria, such as reading a known file or applying a fully specified comparison. Use `explore` when the location must be discovered, not merely because a request says "discover". Reserve `general` for complex implementation or mixed work without a narrower specialist fit.

## Model and thinking presets

These presets apply only when invoking `subagent_type: "general"`. Select the lowest-cost fit and pass both `model` and `thinking` to that call. For every specialist call, including resumes, omit the `model` and `thinking` keys entirely. Do not send guessed, default, or matching values; the specialist's own configuration selects both.

| Task complexity | Use when | Model | Thinking |
| --- | --- | --- | --- |
| Routine | Direct lookup, bounded edits, or deterministic work with clear acceptance criteria | `openai-codex/gpt-6-luna-fast` | `low` |
| Moderate | Multi-step planning, diagnosis, documentation, or synthesis with limited ambiguity | `openai-codex/gpt-6-sol` | `medium` |
| Complex implementation | Cross-file implementation or refactoring with clear acceptance criteria and bounded failure cost | `openai-codex/gpt-6-luna` | `xhigh` |
| Consequential architecture or cross-system implementation | Broad subsystem/interface changes with high coupling or costly retries/review, where contracts are clear and failures remain reviewable or reversible | `openai-codex/gpt-6-sol` | `high` |
| Deep technical analysis | Detailed tracing, test design, benchmarking, or failure analysis with many interacting details | `openai-codex/gpt-6-luna` | `max` |
| High-risk reasoning | Ambiguous contracts, security or correctness review, or decisions with material impact | `openai-codex/gpt-6-astra` | `xhigh` |

Escalate one preset when uncertainty, coupling, or impact is higher than the task's apparent size. Do not use a stronger preset merely because the task is long; use it when the task requires deeper judgment or carries greater risk.
