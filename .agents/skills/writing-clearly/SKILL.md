---
name: writing-clearly
description: Write, edit, copyedit, or unslop human-facing prose while preserving the user's canonical voice from `~/.config/fbb/TONE.md`. Use for documentation, READMEs, PR descriptions, commit-message bodies, changelogs, issue summaries, long-form explanations, UI/help text, error messages, or requests to remove AI-generated tells, generic wording, filler, and formulaic structure.
---

# Writing Clearly

Use this skill to make prose easier to read without making it generic.

## Source of Voice

Before writing or editing final prose, read `~/.config/fbb/TONE.md` when it exists. If a repo-local tone file also exists, use it only when the task explicitly asks for repo-local voice.

Treat `TONE.md` as canonical for voice. This skill supplies process and clarity checks; it must not duplicate or override the tone file. Task-specific output contracts still win.

When instructions conflict, use this priority order:

1. Factual correctness and verified evidence.
2. Explicit user constraints for this task.
3. Required output contract from a command, tool, template, or maintainer.
4. `~/.config/fbb/TONE.md`.
5. This skill's general writing guidance.

## Process

1. Identify the reader, the decision or action the prose should support, and whether the task asks for a rewrite or a summary. A plain-language rewrite preserves supported detail; a summary may omit lower-priority detail.
2. Draft the smallest complete version that gives necessary context. Put the point first unless suspense or narrative order is explicitly useful.
3. **Scan.** Find the AI patterns below, including puffery, vague attribution, formulaic structure, empty consequence clauses, chatbot artifacts, and generic conclusions. Treat words as diagnostic signals rather than automatic replacements. Em dashes are prohibited.
4. **Rewrite.** Fix substance before style. Cut filler and replace broad claims with verified mechanisms, consequences, examples, measurements, or limits. Preserve meaning, evidence, uncertainty, constraints, and technical distinctions. If the source does not support a concrete rewrite, qualify or remove the claim instead of inventing detail.
5. **Restore voice.** Match the intended tone and recover useful stance, rhythm, emphasis, and first person already supported by the source, genre, or `TONE.md`. Do not invent personality, opinions, or deliberate messiness.
6. **Self-audit.** Ask, "What still makes this read like generic AI-generated prose?" Fix the remaining tells without weakening accuracy or violating the output contract.
7. Run a final pass against `TONE.md`.

## Substance

- State what happened or what the reader should do. Cut puffery such as "pivotal moment", "testament to", "evolving landscape", and "setting the stage".
- Replace promotional adjectives with relevant facts. "Groundbreaking", "renowned", and "powerful" need evidence or should disappear.
- Name the source of an attributed claim. Delete phrases such as "experts believe", "reports suggest", or "critics argue" when no source is available.
- Verify externally checkable details, including names, dates, numbers, quotations, links, publication details, and citations. Confirm that each source supports the exact claim attached to it. Remove or qualify details that cannot be verified.
- Bound general claims by naming the relevant actor, population, environment, condition, mechanism, or evidence. Avoid universal claims and false consensus unless the source establishes that scope.
- Name the responsible actor when passive or abstract phrasing hides ownership or accountability. "The decision emerged" becomes "The maintainers decided." Keep ordinary technical subjects when they state behavior clearly, as in "The API returns 404" or "The test fails."
- Delete superficial `-ing` clauses such as "highlighting", "ensuring", "reflecting", or "showcasing" when they merely announce a consequence. Expand them only when they carry evidence or explain causality.
- Replace formulaic challenge-and-triumph framing with the actual constraint and outcome.
- Apply the portability test to project-specific prose: if a sentence could appear unchanged in another project's documentation, rewrite it with this project's mechanism or cut it.

## Protected Detail

- Treat code blocks, inline code, identifiers, commands, file paths, URLs and link targets, quoted output, names, and numbers as protected text. Keep them unchanged unless the task explicitly requires correcting or rewriting them.

## Language

- Prefer plain words, but do not replace precise domain terms merely because they sound formal.
- Replace inflated substitutes for "is" or "has", such as "serves as", "stands as", and "boasts", unless the distinction matters.
- Preserve the source language unless the user requests translation. This includes headings, labels, and surrounding prose; keep code and other technical literals unchanged.
- Avoid reflexive corrective contrasts such as "It's not X; it's Y", "It's not that X; it's that Y", "not merely X, but Y", and "less about X than Y". Keep the contrast only when X is a plausible interpretation and distinguishing Y changes the reader's understanding. Otherwise, state Y directly.
- Avoid negative runway that lists what something is not before saying what it is. Lead with the positive claim; keep exclusions only when they define scope or prevent a likely misreading.
- Do not force ideas into groups of three or use "from X to Y" unless the endpoints form a meaningful scale.
- Repeat an established technical term instead of cycling through synonyms that could imply different concepts.
- Cut adverbs that prop up weak or unmeasured claims. Replace "significantly improves" with the measured change or the exact failure mode avoided.
- Prefer active voice when the actor matters. Keep passive voice when the actor is unknown, irrelevant, or would distract from the subject.
- Keep one idea per sentence. Split dense sentences when readers must backtrack to parse them, and remove clauses that do not support the sentence's main point.

## Stock Phrases

Treat stock phrases as diagnostic signals, not banned strings. Delete or rewrite them when they only announce, intensify, narrate, or disguise the point; keep them when context gives them a necessary job.

- Announcement openers: "Here's the thing", "Let me be clear", and "The truth is".
- Performative emphasis: "Full stop", "Let that sink in", and "Make no mistake".
- Meta-commentary: "Plot twist", "Let me walk you through", and "As we'll see".
- Vague business jargon: "lean into", "double down", "circle back", and "deep dive".

## Structure and Presentation

- Let the material determine the number and shape of sections. Avoid mechanically balanced outlines and lists that repeat the same sentence pattern.
- Use headings and bullets for navigation, not decoration. Avoid bold-label bullets that restate their own label.
- Keep paragraphs focused; split when the topic or reader task changes.
- Preserve meaningful Markdown structure, link targets, and frontmatter unless restructuring is requested or the existing structure obstructs comprehension.
- Each paragraph or section must add evidence, explanation, a decision, or a reader action. Delete closing sentences and subsection summaries that merely restate earlier text.
- Use signposting only when it establishes scope, prerequisites, navigation, or the reader's next task. Delete document-anatomy narration such as "This section discusses" and "Below we explore".
- Cut rhetorical questions that only introduce an immediate answer. State the answer directly unless the question gives the reader a real decision or unresolved issue.
- Vary sentence rhythm when it improves readability. Do not manufacture fragments or deliberate messiness to simulate a human voice.
- Do not use em dashes. Separate the thought with a period or comma instead; do not substitute parentheses, en dashes, or hyphens merely to preserve the same interruption. Treat repeated parenthetical asides, colons, boldface, and decorative emoji as warning signs, not banned syntax.

## Voice

- Have opinions when the evidence supports a judgment. React to the facts instead of flattening every topic into a neutral inventory of pros and cons, while preserving the writer's actual stance.
- Use first person only when the genre and source material support personal experience or judgment.
- Preserve supported authorial, regional, and culturally grounded language. Change an expression when it obstructs the intended reader, not merely because a generic alternative sounds more polished.
- Preserve negative and mixed findings when the evidence is negative or mixed. Do not append optimism, reassurance, or false balance as a conversational default.
- Prefer concrete observations over statements about how something "feels". Name the behavior, instruction, or measurable result.
- Preserve useful irregularity in a draft, but never add errors, ambiguity, or clutter for artificial "soul".

## Jargon

Treat these abstract metaphor nouns as AI-pattern warnings when a concrete term would say what actually happens: "substrate", "wedge", "vector", "locus", "vantage", "nexus", "primitive" as a noun, "harness" as a metaphor, "surface" as in "API surface", "bedrock", "scaffolding" as a metaphor, "modality", "paradigm", "gold-plating", "ratchet" as a metaphor, "evacuate" for moving code, "endgame", "north star", and "flywheel".

Use the mechanism's real name or a plain replacement. For example, "substrate" becomes "base", "wedge in" becomes "add", "vector" becomes "way" or "method", "gold-plating" becomes "more than the job needs", "ratchet" becomes the mechanism's name or "a limit that only tightens", "evacuate" becomes "move out", and "endgame" becomes "the last phase". Keep a listed term only when it has a precise, established meaning for the intended reader.

## NEVER

- NEVER write praise-padding before useful criticism. Say the issue, tradeoff, or decision directly.
- NEVER open with throat-clearing like "This comprehensive guide explains..."; lead with why the reader should care or what changed.
- NEVER make prose sound polished by removing uncertainty that matters. Keep real caveats, but make them short and specific.
- NEVER preserve the user's draft wording when it hides the point; preserve intent and technical meaning instead.
- NEVER add unsupported opinions, first person, or emotional language merely to make prose sound human.
- NEVER accept a premise or change a factual conclusion merely to sound supportive. Acknowledge the concern when useful, then state whether the premise is supported, contradicted, or uncertain.
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
- Each paragraph or section advances the prose instead of restating it.
- Claims have a defensible scope, and externally checkable details have been verified.
- Each citation supports the exact claim attached to it.
- The prose sounds practical, direct, and low-ceremony per `TONE.md`.
- No marketing tone, consultant polish, or generic enthusiasm remains.
- Stock phrases and business jargon remain only where they do more than announce, intensify, narrate, or disguise the point.
- No unsupported agreement, optimism, reassurance, or false balance remains.
- No em dashes remain, and listed jargon has been replaced unless it carries a precise domain meaning.
- Lists, headings, punctuation, and sentence rhythm follow the material rather than a repeated template.
- Actors and ownership are explicit when accountability matters; no negative runway or self-answering rhetorical setup remains.
- No chatbot artifacts, vague attribution, synonym cycling, forced contrast, false range, or generic conclusion remains.

## Interaction

For copyediting, return the revised text first. Add notes only when a choice materially changes meaning, risk, or audience fit.

For new prose, ask at most one clarifying question when audience, destination, or hard constraints are missing and guessing would change the output. Use the request and surrounding material only to resolve meaning and scope. Rewrite the supplied prose rather than answering it or introducing new claims.
