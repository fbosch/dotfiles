# Design

## Context

See `proposal.md` for motivation and the three capability specs for the confirmed behavior. This is a replacement of the execution runtime and its local consumers, not a compatibility wrapper around gotgenes.

The source analysis observed `@gotgenes/pi-subagents@25.0.1`, Markdown specialists, model presets, conditional orchestration instructions, routed prompt commands, and custom worker widget/transcript integration. Routed prompts and parts of `prompt-ui/subagent-*` depend on the gotgenes service. The existing handoff and checkpoint helpers are separate concerns.

The user confirmed the feature contract after comparing the current setup with [Gagan's runner](https://github.com/GaganSD/pi-extensions/tree/main/pi-subagents) and [pi-episodes](https://github.com/arthurfiorette/pi-episodes). Those references inform choices, not dependency selection. The Gagan benchmark uses a different comparator and does not establish savings against this setup. The interactive/tmux plugin was explicitly excluded as a design reference.

## Goals / Non-Goals

**Goals:**

- Own one cohesive worker lifecycle with shared state for tools, routed commands, result delivery, and human inspection.
- Preserve useful specialist workflows while reducing ambient child configuration and old-runtime-specific integration code.
- Separate a worker session, its assignments, execution capacity, pending questions, result delivery, and durable evidence so they cannot be mistaken for each other.
- Make unsafe continuation, missing capabilities, and incomplete persistence visible rather than silently degrading.

**Non-Goals:**

- A generic workflow engine, recursive delegation, automatic file ownership enforcement, or worktree manager.
- True context forks, episode folding, archive indexing, or model-powered archive questions.
- Worker execution across restart/reload, terminal panes, direct child chat, or session takeover.
- Reimplementing Pi request retries, compaction, model transports, or tool execution.
- Reproducing gotgenes' private service contract or migrating its old worker records. Preserve existing session files without rewriting them.
- Integrating classifier checkpoint assessment into runtime correctness.

## Decisions

### 1. Verify three host integrations before runtime implementation

The host API feasibility audit passed against Pi 1.3.0; see `references/feasibility.md` for source evidence, offline probes, and remaining implementation checks. The gate covers:

1. **Selective child loading.** Verify supported child-session/resource APIs can resolve the mandatory baseline and selected bundles while retaining hashline, codemode, required provider hooks, tool discovery, applicable project instructions, and safety policy enforcement. Check actual callable tools, including codemode-dispatched tools, not just catalog text. Establish which existing permission declarations are enforced and which are merely instructions.
2. **Native inspection.** Verify supported Pi APIs can implement the overlay, transcript rendering, scroll/follow behavior, cancellation confirmation, and bounded widget without importing gotgenes internals or patching Pi's private UI. Check `/subagents` command collisions and standard key handling.
3. **Session lifecycle.** Verify interrupt attribution, switch confirmation, reload teardown, parent deletion, child disposal, and event delivery ordering. Establish how a cleanup-unknown block survives extension reload and how lack of shutdown confirmation is detected without an arbitrary worker execution deadline.

The audit establishes supported implementation paths, not production acceptance. An absent host API discovered during implementation remains a blocker, not permission to weaken the spec or patch Pi. Stop and obtain a revised decision if the agreed behavior cannot be delivered through supported APIs.

### 2. One session owner and one shared scheduler

Use full in-process Pi child sessions rather than a separate agent loop or subprocess. A parent-scoped owner manages workers, their assignment state, execution reservations, pending questions, event subscriptions, and result delivery. Both foreground and background requests use the same six-slot scheduler; their distinction is how the caller receives progress and waits.

A retained session is not an execution slot. Completed eligible sessions and question-waiting sessions remain in memory without occupying capacity. A question is not considered slot-yielding until its execution segment has settled, so the runner cannot admit a seventh active execution while the worker is still running tools. Stopping execution retains capacity until shutdown is confirmed.

The parent owns workflow dependencies and shared-worktree coordination. A built-in task graph or file-lock system would add a second orchestration model and is excluded.

### 3. Resolve capabilities once and keep identity stable

Keep specialist Markdown and model presets. Extend the local configuration contract with explicit skill selection, bundle references, default budgets, and model/thinking override permissions. Exact frontmatter field names and bundle membership are implementation details to document after the feasibility audit; existing prompt bodies and applicable authoring conventions remain usable.

Central bundles describe backing extensions and their dependencies. A required baseline supplies model/provider integration and mandatory safety policies. The specialist tool allowlist remains authoritative even when an extension registers additional tools. The child receives a selected skill catalog, not the parent's entire catalog or preloaded skill bodies. Required safety instructions cannot depend on a skill being chosen.

Missing selected skills do not block startup. Keep the remaining explicit selection and record skipped names in the child prompt and assignment transcript, without loading substitute or ambient skills. Required tools, extensions, presets, and mandatory policies still fail preflight when unavailable.

Resolve and validate before starting assignment execution. Fail on missing required components; do not fall back to another model, omit a required policy, or inherit the parent's ambient extensions. Binding failures after partial setup must use the same cleanup rules as other launch failures.

Freeze the resolved role, model/thinking, tool policy, bundles, skills, and required instructions for the live session. Continuation changes the assignment and budget, not the capabilities. A changed definition affects new workers only. Configuration snapshots must not serialize credentials.

### 4. Preserve textual inheritance without implying a true fork

Default to a fresh conversation. Optional inheritance formats parent user/assistant text and compaction summaries, omitting tool-result roles and non-text blocks. Shared project instructions and the specialist's identity remain applicable regardless of inheritance.

This retains the chosen current behavior. It does not promise byte-identical prompt-cache prefixes, inherited tool evidence, image inheritance, or independence from the parent's conclusions. Use fresh specialists for independent review and explicit assignments in both modes. Do not add an extra summary-model call.

### 5. Three interfaces, distinct control operations

Provisional names are `subagent`, `subagent_result`, and `subagent_control`; final names can change together with local callers. Their responsibilities are fixed:

| Interface | Responsibility |
| --- | --- |
| Launch | One named specialist, bounded assignment, mode, permitted overrides, and optional textual inheritance |
| Inspect/wait | Current state, explicit full report retrieval, bounded transcript inspection, or waiting for a state requiring parent action |
| Control | Distinct steer, reply, continue, cancel, and release actions with state-specific validation |

Use stable worker IDs, assignment identities, and pending-question IDs. Display labels must not route actions. Enforce ownership before access or mutation. A reply consumes the current question only once; it cannot become free-form continuation if stale. Steering cannot silently revive a stopped worker. Cancelled, released, historical, or cleanup-unknown workers cannot be continued.

Routed prompt commands call a small local launch interface with the same validation and scheduling as tool calls. Do not preserve the old service symbol or split command execution into another lifecycle.

### 6. Budgets belong to assignments, not execution segments

Write explicit defaults into specialist definitions: 12 turns for routine/discovery roles and 24 for implementation/deep-analysis roles, retaining lower limits. Allow explicit per-assignment overrides and a wrap-up warning with two turns remaining.

A question pauses the same assignment and preserves its remaining budget; waiting consumes no turns. Explicit budget extension must be intentional. Continuation after completion, exhaustion, or a recoverable failure is a new bounded assignment with a fresh budget. A control receipt reports acceptance, not task success.

Use Pi's request retry and compaction. Do not automatically rerun assignments after failure or introduce a wall-clock worker deadline. A long-running or hung tool can therefore retain a slot until cancelled; elapsed time is observational, not proof of failure.

### 7. Structural receipts and explicit evidence retrieval

Separate the authoritative worker/assignment outcome from how it reaches the parent. Background completion wakes the owning parent with identity, terminal state, report availability, and runtime/pending-question metadata, not worker-written report prose. Full final reports are explicitly retrieved without arbitrary character truncation. Foreground completions and explicit waits return the full report directly.

Track delivery per assignment and recheck it at delivery time. A wait that times out, is interrupted, or returns a pending question must relinquish its claim on future completion; otherwise the later result could be lost. A wait that receives completion suppresses a duplicate automatic receipt. New continuations have new outcome identities. Do not claim durable exactly-once messaging across crashes; deduplication concerns the current parent lifecycle.

Material updates remain attributed worker output. Routine tool activity belongs in UI state. If updates become stale before delivery, identify the settled worker state rather than asking the parent to steer a finished run. Full transcripts are separate from concise final reports and are inspected only on request.

### 8. Separate execution, storage, and resumability

Keep distinct facts for execution outcome, report persistence, live-session availability, and pending question. Successful edits followed by a failed report write are completed execution with failed storage, not a failed assignment to replay. Keep available report content in memory and disclose incomplete durable history.

Store evidence with its owning parent using the host-supported layout established by the feasibility gate. Saved reports and transcripts follow parent retention and deletion. Avoid an independent expiry scheduler. Parent reopening restores read-only records, not executable workers; it must not misrepresent a previously running record as still live after a process restart.

Retain eligible live sessions until explicit release, parent teardown, reload, or exit. This deliberately removes inactivity expiry and count-based eviction, at the cost of accumulated session/extension resources. Explicit release remains available to the parent. Releasing resources does not delete evidence.

### 9. Cancellation is a transition, not an acknowledgement

For running workers, cancellation first means stopping. Confirm execution shutdown before reporting cancelled or releasing its reservation. Queued cancellation prevents execution; question-waiting cancellation invalidates the pending question. Explicit cancellation is terminal for that worker, although partial evidence remains inspectable.

Escape has separate effects according to what the parent is doing: stop foreground work it awaits, stop only an explicit wait on a background result, and leave independent background workers running. Human cancel-one/cancel-all controls require confirmation.

If shutdown cannot be confirmed, enter cleanup-unknown, retain diagnostics and the uncertain reservation, and block all new launches and continuations until Pi restarts. A reload is not a reset of this health block. The feasibility gate must establish a trustworthy confirmation mechanism and persistent process-level ownership; an arbitrary success timeout is not sufficient.

Parent switching requires confirmation for interrupted running/queued work, then cancels and releases live workers. Reload does not transfer live sessions: warn when host confirmation is supported, otherwise disclose interruption, tear down, and restore saved history only. Session teardown must settle live execution before dropping references or accepting new parent work.

### 10. Observational native UI

Use one event-driven view of the owner state for inline foreground progress, the widget, and the overlay. Do not make UI inspection a source of model turns or lifecycle mutations except confirmed control actions. Rendering elapsed time can use a local redraw timer; it must not poll worker status or the filesystem.

The widget defaults to four live rows, ordered by unanswered questions, running work, then queued work, with launch order stable within a state. A stopping worker remains visibly in transition until termination. Overflow is explicit; separate warnings keep cleanup/error conditions visible. Fit available terminal space without obscuring the editor.

`/subagents` is the primary entry. One native overlay holds the parent-scoped list, results, transcripts, and cancellation actions. Use Pi navigation/focus/scroll conventions. Read-only live transcripts follow until manual scrolling, then preserve position until an explicit follow action. Retain selection and scroll/follow state on return. Put model/budget/usage/cost details in the overlay; report missing metrics as unavailable.

Reuse supported components rather than copying gotgenes' widget or importing its private transcript renderer. No dedicated global shortcut is required. Widget click access is optional only if supported without private patches and is not an acceptance dependency.

## Risks / Trade-offs

- Selective extensions can omit hidden dependencies or policy enforcement. Mitigation: resolve centrally, validate actual child capabilities, and test codemode/tool dispatch and required provider hooks before cutover.
- Host APIs might not support switch confirmation, deletion cleanup, or live transcript behavior. Mitigation: complete the three-part feasibility gate first and return behavior changes for approval.
- Shared worktrees can still receive conflicting edits. Mitigation: keep explicit ownership rules in parent instructions and state that no runtime locking or OS sandbox is provided.
- Idle sessions can retain substantial resources. Mitigation: expose explicit release and record resource behavior during validation; do not silently add eviction or expiry.
- Full reports can be large. Mitigation: retrieve them deliberately and instruct concise handoffs rather than truncating evidence.
- Cancelling one faulty worker can disable delegation for the whole process. Mitigation: show precise diagnostics and require restart rather than risk hidden continued execution.
- Same-process execution does not isolate crashes or arbitrary extension side effects. Mitigation: keep the mandatory baseline and selected bundles narrow; do not describe tool allowlists as security sandboxes.
- More locally owned code can offset smaller prompts or fewer dependencies. Mitigation: compare maintained glue, model-visible overhead, task outcomes, and latency against the actual current setup before claiming improvement.

## Migration Plan

1. Complete and review the feasibility evidence. If a required host behavior is unavailable, stop before implementing the runner and obtain a revised contract.
2. Implement vertical slices with neighboring tests, without registering the new runner alongside the old one in production.
3. Adapt specialists, selected bundles/skills, routed prompts, orchestration instructions, and worker UI consumers to one local API. Preserve unrelated handoff/checkpoint functionality independently.
4. In a single coordinated cutover, replace the old package registration and remove obsolete runner-only service/UI/notice code and exclusions. Do not create an API shim or transform historical session files. Any package-manifest/lock update must follow repository dependency policy; do not edit generated locks manually.
5. Exercise current-contract tests, relevant `devenv test` checks, and human TUI/lifecycle acceptance scenarios before declaring replacement complete. Record unverified platform behavior explicitly.
6. If acceptance fails after a cutover trial, restore the prior tracked registration and integrations together using a scoped rollback that preserves unrelated work and saved evidence. Do not run both systems or attempt to revive historical workers through the other runner.

## Deferred implementation details

Exact tool names, frontmatter keys, bundle membership, and typed event envelopes remain implementation details. The feasibility audit selects embedded parent-session custom entries for history and process-scoped state for cleanup health. Production lifecycle and interactive acceptance checks remain incomplete. No further feature expansion is implied by resolving these details.
