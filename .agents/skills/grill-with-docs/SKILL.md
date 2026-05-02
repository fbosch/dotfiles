---
name: grill-with-docs
description: Grill a plan or design against project domain language and architecture decisions, updating CONTEXT.md and ADRs inline as decisions crystallize. Use when the user wants to stress-test a plan against documented project language, domain glossary, architecture decisions, ADRs, or says "grill with docs".
---

Interview the user about a plan or design until each decision branch has enough clarity to act, while keeping the project's domain language and decision record current.

This extends `grill-me`: keep the same depth-first, one-question loop, but challenge answers against `CONTEXT.md`, `CONTEXT-MAP.md`, code, and ADRs.

## Reference loading

- Read [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md) before creating or updating `CONTEXT.md`.
- Read [ADR-FORMAT.md](ADR-FORMAT.md) before offering or writing an ADR.

## Domain awareness

During exploration, look for existing documentation before asking questions:

- `CONTEXT.md` at repo root for a single domain context.
- `CONTEXT-MAP.md` at repo root for multiple contexts.
- `docs/adr/` for system-wide decisions.
- Context-local `docs/adr/` directories next to context-local `CONTEXT.md` files.

Create files lazily. If no `CONTEXT.md` exists, create one only when the first term is resolved. If no ADR directory exists, create it only when the first ADR is needed.

## Turn loop

For each turn:

1. Identify the unresolved decision.
2. If code, docs, or existing artifacts can answer it, inspect those instead of asking.
3. Ask exactly one question.
4. Explain why the answer matters.
5. Provide your recommended answer and its tradeoff.
6. After the user answers, update the decision tree and move to the next highest-impact unresolved branch.

## Question ladder

Work through these in order, skipping anything already answered:

- **Outcome**: What exact result must exist when this is done?
- **Language**: Which domain terms name the important concepts, and do they match `CONTEXT.md`?
- **Users**: Who depends on this, and who can be harmed by it?
- **Constraints**: What compatibility, latency, security, UX, maintenance, or timeline constraints apply?
- **Assumptions**: What must be true for this plan to work, and what could falsify it?
- **Alternatives**: What simpler, safer, or more reversible options were rejected, and why?
- **Failure modes**: How can this fail, be abused, regress, or become hard to operate?
- **Validation**: What evidence proves the plan worked?
- **Rollout**: Can this ship incrementally, and how is it reversed?
- **Decision record**: Does any decision meet the ADR threshold?

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with existing language in `CONTEXT.md`, call it out immediately: "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term: "You're saying 'account'. Do you mean **Customer** or **User**? Those are different concepts."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios that probe edge cases and force precision about concept boundaries.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If code contradicts the stated model, surface it directly: "The code cancels entire Orders, but you said partial cancellation is possible. Which should be true?"

### Update CONTEXT.md inline

When a domain term is resolved, update `CONTEXT.md` immediately. Do not batch these updates. Only include terms meaningful to domain experts; do not add general programming concepts.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

- **Hard to reverse**: changing later has meaningful cost.
- **Surprising without context**: a future reader would wonder why it was done this way.
- **Real trade-off**: there were genuine alternatives and one was chosen for specific reasons.

If any condition is missing, skip the ADR.

## Stop conditions

Stop grilling when:

- remaining answers would not change implementation, documentation, or risk handling;
- the user asks to stop, decide, or proceed;
- one viable path remains and its assumptions and risks are explicit.

Then summarize:

- decisions made;
- domain terms added or changed;
- ADRs offered or created;
- assumptions accepted;
- unresolved risks;
- recommended next action.

## NEVER

- NEVER ask questions the repository, docs, or artifacts can answer.
- NEVER ask multiple questions at once.
- NEVER batch `CONTEXT.md` updates after a term is resolved.
- NEVER create ADRs for ephemeral reasons, obvious decisions, or reversible choices.
- NEVER add implementation details or generic programming terms to `CONTEXT.md`.
- NEVER continue just to be adversarial.
- NEVER accept vague answers without converting them into concrete constraints.
- NEVER hide your recommendation; make the default path explicit.
