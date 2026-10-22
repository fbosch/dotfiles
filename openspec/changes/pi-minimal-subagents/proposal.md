# Proposal

## Why

Our subagent setup combines an external runtime, specialist definitions, orchestration instructions, and custom UI/service integrations. We want to own a smaller, explicit execution contract and remove unnecessary integration code without losing the specialist workflows we use; no token, latency, or package-size improvement is claimed before measurement.

## What Changes

- **BREAKING** Replace `@gotgenes/pi-subagents` with a local extension using full in-process Pi child sessions and three focused interfaces for launch, inspect/wait, and control. Adapt local consumers together rather than preserving the package's internal service API.
- Retain Markdown specialists, model presets, routed prompt commands, foreground/background execution, and optional textual parent context. Default to fresh context and background execution; do not implement true forks.
- Resolve explicit child capability bundles, tool allowlists, required policies/provider support, and scoped on-demand skill catalogs. Fail preflight on missing requirements and preserve the resolved configuration across continuation.
- Share six execution slots across foreground and background work. Use specialist turn budgets, correlated parent questions, material updates, steering, and explicit continuation without nested delegation or a workflow engine.
- Deliver structural background completion receipts; retrieve full reports on demand without arbitrary character truncation. Return reports directly through foreground calls or explicit waits without duplicate notifications.
- Make stopping, confirmed cancellation, uncertain cleanup, execution outcome, and persistence outcome distinct. Keep idle sessions only within their parent lifetime and saved history alongside that parent.
- Replace current worker UI integrations with a bounded live widget and one native read-only worker/history overlay. Retain parent-mediated communication and confirmed cancellation controls.
- Gate runtime implementation on verifying selective child loading, supported Pi TUI APIs, and session/reload/deletion lifecycle support. Return any required change to the agreed behavior to the user before proceeding.
- Keep workspace coordination in parent instructions. Exclude automatic worktrees, restart revival, episode folding, advanced archive retrieval, and classifier-based checkpoint assessment from the runner.

## Capabilities

### New Capabilities

- `pi-subagent-execution`: Specialist resolution, launch/context semantics, scheduling, communication, budgets, continuation, cancellation, and cleanup guarantees.
- `pi-subagent-results`: Parent-scoped result delivery, transcript retrieval, persistence outcomes, and history retention.
- `pi-subagent-inspection`: Foreground progress, a bounded background widget, native worker/history inspection, and human cancellation controls.

### Modified Capabilities

- None. Existing canonical OpenSpec capabilities do not cover subagents.

## Impact

- Expected implementation area: a new local extension under `.pi/agent/extensions/`, neighboring `__tests__`, `.pi/agent/agents/`, `.pi/agent/instructions/orchestration/`, and associated settings.
- Affected integrations include `.pi/agent/extensions/routed-prompts.ts`, `prompt-ui/subagent-*`, `subagent-steering-notice.ts`, model presets/provider hooks, tool discovery, hashline/codemode support, and safety policies used by selected child capabilities.
- The existing handoff `read_session` and optional checkpoint helper remain independent; this change does not absorb them or authorize unrelated rewrites.
- Cutover must remove the old runner registration and obsolete runner-specific glue without changing unrelated extensions. No old-runtime API shim, old-worker revival, or import of old worker records is required. Existing saved session files must not be deleted or rewritten as part of cutover.
- Implementation is now authorized, starting with a reproducible baseline of the current setup. Runtime replacement remains gated on the integration checks; dependency changes still require explicit approval under repository policy.
