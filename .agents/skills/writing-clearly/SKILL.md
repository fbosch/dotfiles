---
name: writing-clearly
description: Write, edit, copyedit, or unslop human-facing prose while preserving the user's canonical voice from `~/.config/opencode/TONE.md`. Use for documentation, READMEs, PR descriptions, commit-message bodies, changelogs, issue summaries, long-form explanations, UI/help text, error messages, or requests to remove AI-generated tells, generic wording, filler, and formulaic structure.
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
2. Draft the smallest complete version that gives necessary context. Put the point first unless suspense or narrative order is explicitly useful.
3. **Scan.** Find the AI patterns below, including puffery, vague attribution, formulaic structure, empty consequence clauses, chatbot artifacts, and generic conclusions. Treat them as diagnostic signals, not a word blacklist.
4. **Rewrite.** Fix substance before style. Cut filler and replace broad claims with verified mechanisms, consequences, examples, measurements, or limits. Preserve meaning, evidence, uncertainty, constraints, and technical distinctions. If the source does not support a concrete rewrite, qualify or remove the claim instead of inventing detail.
5. **Restore voice.** Match the intended tone and recover useful stance, rhythm, emphasis, and first person already supported by the source, genre, or `TONE.md`. Do not invent personality, opinions, or deliberate messiness.
6. **Self-audit.** Ask, "What still makes this read like generic AI-generated prose?" Fix the remaining tells without weakening accuracy or violating the output contract.
7. Run a final pass against `TONE.md`.

## Substance

- State what happened or what the reader should do. Cut puffery such as "pivotal moment", "testament to", "evolving landscape", and "setting the stage".
- Replace promotional adjectives with relevant facts. "Groundbreaking", "renowned", and "powerful" need evidence or should disappear.
- Name the source of an attributed claim. Delete phrases such as "experts believe", "reports suggest", or "critics argue" when no source is available.
- Delete superficial `-ing` clauses such as "highlighting", "ensuring", "reflecting", or "showcasing" when they merely announce a consequence. Expand them only when they carry evidence or explain causality.
- Replace formulaic challenge-and-triumph framing with the actual constraint and outcome.
- Apply the portability test to project-specific prose: if a sentence could appear unchanged in another project's documentation, rewrite it with this project's mechanism or cut it.

## Language

- Prefer plain words, but do not replace precise domain terms merely because they sound formal.
- Replace inflated substitutes for "is" or "has", such as "serves as", "stands as", and "boasts", unless the distinction matters.
- State the point directly instead of using "not just X, but Y" as artificial emphasis.
- Do not force ideas into groups of three or use "from X to Y" unless the endpoints form a meaningful scale.
- Repeat an established technical term instead of cycling through synonyms that could imply different concepts.
- Cut adverbs that prop up weak or unmeasured claims. Replace "significantly improves" with the measured change or the exact failure mode avoided.
- Prefer active voice when the actor matters. Keep passive voice when the actor is unknown, irrelevant, or would distract from the subject.
- Split sentences when readers must backtrack to parse them. Do not enforce one idea per sentence when related clauses are clearer together.

## Structure and Presentation

- Let the material determine the number and shape of sections. Avoid mechanically balanced outlines and lists that repeat the same sentence pattern.
- Use headings and bullets for navigation, not decoration. Avoid bold-label bullets that restate their own label.
- Keep paragraphs focused; split when the topic or reader task changes.
- Vary sentence rhythm when it improves readability. Do not manufacture fragments or deliberate messiness to simulate a human voice.
- Treat repeated em dashes, parenthetical asides, colons, boldface, and decorative emoji as warning signs, not banned syntax. Keep punctuation and formatting that clarify the sentence.

## Voice

- Preserve the writer's actual stance instead of flattening every claim into neutral pros and cons.
- Use first person only when the genre and source material support personal experience or judgment.
- Acknowledge mixed outcomes with specific tradeoffs, not performative reactions.
- Prefer concrete observations over statements about how something "feels". Name the behavior, instruction, or measurable result.
- Preserve useful irregularity in a draft, but never add errors, ambiguity, or clutter for artificial "soul".

## NEVER

- NEVER write praise-padding before useful criticism. Say the issue, tradeoff, or decision directly.
- NEVER open with throat-clearing like "This comprehensive guide explains..."; lead with why the reader should care or what changed.
- NEVER make prose sound polished by removing uncertainty that matters. Keep real caveats, but make them short and specific.
- NEVER preserve the user's draft wording when it hides the point; preserve intent and technical meaning instead.
- NEVER add unsupported opinions, first person, or emotional language merely to make prose sound human.
- NEVER replace one visible tell with another, such as swapping every em dash for parentheses or every paragraph for bullets.
- NEVER end with chatbot filler such as "I hope this helps", "Let me know if", or a generic optimistic conclusion.

## Rewrite Patterns

Examples illustrate rewrite shape only. Use facts from the source or verified evidence, never details from these examples.

- Generic claim -> verified consequence, or deletion when no consequence is established.
- Marketing prose -> the factual capability already present in the source, without promotional adjectives.
- Bloated caveat -> the shortest form that preserves a known condition; remove catch-all caveats with no specific condition.
- Vague benefit -> observable behavior already established by the source.
- Unsupported attribution -> a named, verifiable source or deletion.
- Empty consequence clause -> the verified mechanism without an assumed benefit: "Adds caching, improving performance" -> "Caches parsed manifests."
- Inflated identity -> direct statement: "This command serves as the primary entry point" -> "This command is the primary entry point."

## Output Checks

Before returning prose, verify:

- The first sentence or section makes the purpose clear.
- Each paragraph has one job.
- Claims are concrete enough to verify.
- The prose sounds practical, direct, and low-ceremony per `TONE.md`.
- No marketing tone, consultant polish, or generic enthusiasm remains.
- Lists, headings, punctuation, and sentence rhythm follow the material rather than a repeated template.
- No chatbot artifacts, vague attribution, synonym cycling, forced contrast, false range, or generic conclusion remains.

## Interaction

For copyediting, return the revised text first. Add notes only when a choice materially changes meaning, risk, or audience fit.

For new prose, ask at most one clarifying question when audience, destination, or hard constraints are missing and guessing would change the output.
