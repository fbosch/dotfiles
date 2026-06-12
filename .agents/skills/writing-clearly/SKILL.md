---
name: writing-clearly
description: Write and edit substantial human-facing prose with clear, concise technical style while preserving the user's canonical voice from `~/.config/opencode/TONE.md`. Use for documentation, README prose, PR descriptions, commit-message bodies, changelog notes, issue summaries, long-form explanations, UI/help text, error messages, and copyediting drafts for clarity, concision, structure, tone, and tradeoffs.
---

# Writing Clearly

Use this skill to make prose easier to read without making it generic.

## Source of Voice

Before writing or editing final prose, read `~/.config/opencode/TONE.md` when it exists. If a repo-local `.config/opencode/TONE.md` also exists, use it only when the task explicitly asks for repo-local voice.

Treat `TONE.md` as canonical for voice. This skill supplies process and clarity checks; it must not duplicate or override the tone file. Task-specific output contracts still win.

When instructions conflict, use this priority order:

1. Factual correctness and verified evidence.
2. Explicit user constraints for this task.
3. Required output contract from a command, tool, template, or maintainer.
4. `~/.config/opencode/TONE.md`.
5. This skill's general writing guidance.

## Process

1. Identify the reader and the decision or action the prose should support.
2. Draft the smallest complete version that gives necessary context.
3. Put the point first unless suspense or narrative order is explicitly useful.
4. Replace broad claims with concrete consequences, examples, or limits.
5. Cut filler, throat-clearing, repeated caveats, and generic enthusiasm.
6. Preserve technical precision; do not simplify by making weaker or less accurate claims.
7. Run a final pass against `TONE.md`.

## Editing Rules

- Prefer active voice unless passive voice improves focus or avoids fake agency.
- Prefer positive, direct statements over negated or hedged phrasing.
- Use specific nouns and verbs; avoid vague claims like "better", "improved", or "robust" without the concrete effect.
- Keep paragraphs short; split when a paragraph changes topic or reader task.
- Use bullets when they improve scanning; avoid bullet lists that repeat the same idea.
- Explain tradeoffs and limits where they affect decisions.
- Delete obvious definitions for technical audiences.
- Keep caveats proportional; do not turn every exception into a paragraph.

## NEVER

- NEVER write praise-padding before useful criticism. Say the issue, tradeoff, or decision directly.
- NEVER use broad claims like "improves maintainability", "more robust", or "better DX" unless naming the exact cost reduced or failure mode avoided.
- NEVER open with throat-clearing like "This comprehensive guide explains..."; lead with why the reader should care or what changed.
- NEVER make prose sound polished by removing uncertainty that matters. Keep real caveats, but make them short and specific.
- NEVER preserve the user's draft wording when it hides the point; preserve intent and technical meaning instead.

## Rewrite Patterns

- Generic claim -> concrete consequence: "Improves maintainability" -> "Removes one config path, so future changes only touch the plugin setup."
- Marketing prose -> technical sensemaking: "A powerful workflow for seamless productivity" -> "A shorter path from edit to verification."
- Bloated caveat -> proportional caveat: "It is important to note that this may not be suitable in all possible cases" -> "Avoid this when the API is externally consumed."
- Vague benefit -> verification hook: "Makes debugging easier" -> "Keeps the failing command and log path in the same report."

## Output Checks

Before returning prose, verify:

- The first sentence or section makes the purpose clear.
- Each paragraph has one job.
- Claims are concrete enough to verify.
- The prose sounds practical, direct, and low-ceremony per `TONE.md`.
- No marketing tone, consultant polish, or generic enthusiasm remains.

## Interaction

For copyediting, return the revised text first. Add notes only when a choice materially changes meaning, risk, or audience fit.

For new prose, ask at most one clarifying question when audience, destination, or hard constraints are missing and guessing would change the output.
