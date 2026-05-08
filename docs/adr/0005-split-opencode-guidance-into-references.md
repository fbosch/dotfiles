# Split OpenCode guidance into references

**Status:** accepted
**Date:** 2026-04-25

## Context

OpenCode startup context was consuming unnecessary tokens because detailed operating preferences lived directly in `/.config/opencode/AGENTS.md`, which is loaded frequently. This increased recurring prompt overhead without improving day-to-day instruction clarity. We still needed the detailed guidance available for complex work.

## Decision

Move detailed guidance out of the always-loaded `/.config/opencode/AGENTS.md` into `/.config/opencode/references/` and keep `AGENTS.md` as a compact policy index. Keep hard guardrails and high-priority defaults in `AGENTS.md`, and reference the detailed documents by path. This preserves behavior while reducing baseline token use.

## Alternatives Considered

Keep the full detailed `AGENTS.md` unchanged. Rejected because it keeps token overhead high every session. Remove detail entirely. Rejected because it loses useful nuance and consistency guidance needed for non-trivial tasks.

## Consequences

Initial context usage drops significantly while retaining access to detailed preferences through references. Instruction maintenance becomes cleaner by separating always-on policy from long-form guidance. Follow-on work may include applying the same pattern to other long always-loaded instruction files.
