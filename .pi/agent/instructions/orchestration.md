---
when:
  tools:
    any:
      - subagent
---

# Subagent orchestration

Before each `subagent` call, check the arguments, not just the plan:
- The `prompt` names the actual target and includes the required result and constraints.
- `max_turns` is explicit and within the selected worker's cap; specialist calls omit `model` and `thinking`.
- Every member of an independent batch has `run_in_background: true`, even for a tiny task. Launch all members before waiting.
- A continuation uses the exact returned worker ID in `resume`, not a reconstructed ID or a fresh spawn.

- When a specialized agent fits the task, prefer it over a generic `general-purpose` or `general` agent. Use a generic agent only when no specialized agent applies or the task genuinely spans several specialties.
- Delegate visualization to `visualizer` when requested directly or indirectly, or when a visual would help explain the response. Route before visualization-specific tool discovery, data collection, aggregation, or rendering; simplicity is not a reason to do that work in the parent. Pass the question, known evidence or bounded source locations, and constraints. The worker owns collection through visual validation; the parent resolves material ambiguity and publishes the validated result.
- After any required recommendation and availability/permission check, launch the selected specialist using the context already supplied. When the user names artifacts for delegated inspection, pass those paths directly; do not read the artifacts first to prepare the worker's prompt. Pass already-collected evidence without collecting it again. If delegation is unavailable or prohibited, report that limitation before using a permitted direct fallback.

## Agent recommendations

- The recommend-agent extension automatically evaluates at most the first eligible native `subagent` delegation per user turn with shared Jev routing immediately before execution. Do not call a separate recommendation tool; the old `recommend_agent` tool is intentionally not registered.
- Jev agreement lets the proposed `subagent_type` execute. A disagreement or `stay` result blocks once with a concise advisory so the primary can reconsider; it never substitutes or spawns another agent. The one-evaluation budget resets for each user turn and session start, so subsequent delegations in that turn are intentionally uninspected.
- Inference failure, abstention, disabled settings, or malformed delegation input fail open. The hook uses a bounded, credential/path-redacted prefix of the proposed delegation prompt; keep sensitive content out of delegation instructions because the existing redaction is not exhaustive.
- At a material worker finding, scope change, or blocker, the parent may call `assess_subagent_checkpoint` with the worker ID, original assignment and acceptance criteria, current scope, and recent progress. Do not call it for routine updates or polling; an unchanged sanitized checkpoint reuses its in-memory result.
  - Material finding: evidence changes an assumption, the likely solution, risk, or feasibility. For example, the API lacks a capability the assigned design requires, or a supposedly local fix affects shared state. Finding the expected file or passing an expected test is routine progress.
  - Scope change: proposed work crosses assigned files, ownership, deliverables, dependencies, or constraints. For example, a focused bug fix requires changing a shared API, adding a dependency, or editing another worker's files. Assess before expanding; an implementation detail within the assignment does not qualify.
  - Blocker: useful progress requires a parent decision, permission, missing information, or an unavailable dependency. For example, acceptance criteria conflict, required test credentials are unavailable, or repeated attempts fail without new evidence. One failed test with an understood fix is not a blocker.
- The checkpoint tool returns a typed Jev probability distribution, confidence, and fixed advice, or an abstain/unavailable result. Treat this as fallible input: verify it against observed evidence and the assignment, and make any `steer_subagent` decision yourself. It never steers, spawns, blocks, or cancels a worker.
- The checkpoint payload is bounded and applies best-effort credential/path redaction, but redaction is not exhaustive. Do not include secrets or sensitive data. Cancellation or Jev unavailability is advisory only; continue using parent judgment rather than retrying an unchanged checkpoint.
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

## Scope and budgets

- Work directly when the relevant context is already loaded and delegation adds no specialist benefit, unless a delegation rule above applies.
- Make each worker's `prompt` self-contained: one verifiable deliverable, the named targets and paths, supplied evidence, owned files, exclusions, one targeted validation command, and a stopping point. The short `description` and inherited context do not substitute for naming the target in the prompt. Keep the assignment focused and pass relevant findings instead of asking workers to rediscover them.
- Copy the user's acceptance criteria and output requirements for this worker's task verbatim, then add its scope and budget without weakening that contract. Do not copy the parent-level orchestration workflow into every worker prompt. Clearly distinguish completed prerequisites from actions this worker must perform. Preserve required values and existing source identifiers verbatim through handoffs and the final answer; do not invent replacement labels or omit them during summarization.
- If an assigned artifact defines the procedure, put the operation order in the worker prompt: read the authorized artifact first, extract its actual rule, then act and report. Explicitly prohibit blocking or coordination tools unless that task requires them; available tools do not imply authorization. Do not guess a protocol from a task label.
- When parent and worker share a working directory, pass the user's relative paths unchanged and tell the worker to use them directly. Do not expand them into long absolute paths. If a different working directory requires an absolute path, copy a verified path rather than reconstructing one.
- For an artifact-directed synchronization task, require the worker's first tool call to read its owned artifact. Only then may it invoke the exact action and arguments specified there, copied literally. Prohibit pre-read waits and substituting a different coordination action. Keep this sequence explicit in the worker prompt, not just in the parent's plan.
- Keep implementation and its focused regression tests together. Split broad discovery, cross-feature implementation, full-suite validation, and hosted benchmarking into separately reviewed assignments.
- For bounded read/verification assignments with no synchronization requirement, include an explicit tool boundary: read the named artifact immediately, use the supplied evidence, and report; do not enter a gate, barrier, wait, or parent-observation protocol. For dependent work, state that the prerequisite is already complete and no further release signal is needed.
- When a task requests an evidence identifier, explicitly ask the worker for the identifier already present in the source, copied exactly. Do not suggest invented labels such as E1. If the source contains no identifier, report that absence rather than manufacturing one.
- Always pass `max_turns`: use at most 12 for discovery or routine work and 24 for implementation or deep analysis. Preserve a specialist's lower configured cap. These are per-assignment review boundaries, not guarantees of elapsed time or tool-call count.
- If the assignment cannot reasonably fit that budget, reduce its scope before launching. Do not raise the budget merely to finish an oversized prompt.

## Supervision and handoff

- Use `run_in_background: true` for substantial work and every independent multi-worker batch. Foreground delegation is only for a single bounded task or a strictly sequential dependency with no peer synchronization; a small task that must coordinate with another worker cannot run in the foreground.
- Retain the agent ID and acceptance criteria. Use completion notifications and worker updates instead of rapid status polling. Before blocking on completion, inspect progress once; if there is no independently useful work, use a bounded status check when supervision is needed.
- Copy worker IDs verbatim from successful spawn results into result, steering, and resume calls. If a lookup says "not found", compare the supplied ID with the original spawn result before retrying or replacing the worker; a mistyped ID is not evidence that the worker disappeared.
- Supervise through native result, notification, and steering tools. Do not read private session logs or transcript files to reconstruct worker state. Do not initiate an unrelated coordination protocol just to check progress.
- Worker-to-worker synchronization does not make the parent a participant in that protocol. Collect status and reports with `get_subagent_result` and notifications. Use a protocol-specific observer or control tool only when the task explicitly assigns that role to the parent or a worker report establishes the required parent action and prerequisites; a tool's name is not sufficient evidence.
- Require a progress update at the first material finding, before expanding scope, and when blocked. If the worker repeats discovery, broadens ownership, or cycles through unrelated failures, steer it to return a checkpoint instead of continuing.
- Every worker must return a completion or partial handoff: findings, changed files, checks actually run and their results, unresolved blockers, and the smallest next step. Ask workers to reserve their final turn for this handoff.
- When integrating a diagnosis or review, retain the decisive source expression or observed value alongside its file/line reference and explanation. Do not compress an evidence-backed finding into a conclusion that loses the exact code or data establishing it.
- A failed resume or lookup is not permission to spawn a replacement. Check the ID against the original result, correct any transcription error, and retry that same worker. If the task requires continuity and the original worker truly cannot be recovered, report the blocker instead of silently substituting another worker.
- Treat tool-returned identifiers as opaque strings: never abbreviate, normalize, reorder, or regenerate any segment. Before sending an identifier, compare the full value character-for-character with the original tool result. An unavailable-record message for a different string is a caller error, not a missing worker.
- At a turn limit, blocker, or interruption, inspect the result and partial diff before resuming or assigning another writer. Never blindly resume with the original broad prompt or launch a replacement into the same files.
- Resume the same worker only with a newly bounded next step and an explicit turn budget. After two unsuccessful bounded attempts at the same deliverable, stop delegation and diagnose the blocker directly or ask the user for the missing decision.
- In a resume, explicitly state the newly authorized phase and which temporary restrictions from the completed phase it supersedes. Preserve persistent safety and ownership constraints; do not frame a current-phase exclusion as a permanent ban on a later user-authorized phase.
- Resumes and correction requests must retain the full output contract. Require the corrected report to include the checked values and source identifiers, not just a bare confirmation or status; earlier context is not a substitute for the required final evidence.
- Preserve exact-value evidence at its original handoff. Do not transcribe completed file contents into a resume prompt unless the next phase needs those values; collect new phase evidence separately and compose the final answer from the original reports. If later summaries differ, resolve the discrepancy against the original report rather than treating the latest repetition as authoritative.
- Report material blockers and unverified partial work to the user. Background execution alone is not supervision; the primary still owns scope, verification, and integration.

## Coordination

- Parallel writes require disjoint ownership and no dependencies. Keep shared work serial.
- For independent workers, explicitly set `run_in_background: true` on every `subagent` call and launch the whole batch before waiting for results. Batching foreground calls is not a substitute for explicit background execution.
- For dependent work, wait for the prerequisite's completed report, then pass its exact evidence to the dependent worker. Require that worker to apply the actual validation rule to the supplied evidence and return the checked values, criterion, and outcome. Do not substitute a guessed check for the task's acceptance criteria.
- A fulfilled prerequisite is not proof that the dependent task passed. If a worker rejects verification, omits required evidence, or contradicts the proposed conclusion, keep the result unresolved. Resume that worker with the specific discrepancy and required output; do not declare success from the parent's inference alone.
- Scope downstream workers to their own artifacts and explicitly exclude completed upstream work. Supply the prerequisite evidence in the prompt instead of asking them to reread it. Reopening upstream artifacts requires a specific discrepancy and a deliberate scope decision.
- Structure a downstream assignment as: `Read only: <downstream paths>. Already completed: <prerequisite evidence>. Do not read: <upstream paths>. Check: <rule to apply>. Return: <exact checked values and outcome>.` Name upstream exclusions explicitly; do not rely on "no other files". Keep the parent workflow out of the worker prompt so it cannot be mistaken for an instruction to repeat discovery.
- Verify each worker's result before starting dependent work or declaring completion. Do not rerun broad investigations without conflicting evidence.
- Before coordinating a multi-worker batch, load the `swarm` skill from its advertised path, or pass the literal `~/.agents/skills/swarm/SKILL.md` to `read` when no path is advertised. Never invent a home directory or replace `~` with a guessed absolute path.
